import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

export const IMAGE_PROVIDERS = [
  'gemini',
  'openai',
  'higgsfield',
  'http',
] as const
export type ImageProviderName = (typeof IMAGE_PROVIDERS)[number]

export type ImageConfig = {
  provider?: ImageProviderName
  model?: string
  endpoint?: string
}

export type ImageAspect =
  '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '21:9'

export type ImageStyle = 'photo' | 'illustration' | 'diagram' | '3d' | 'flat'

export type ImageRequest = {
  prompt: string
  aspect: ImageAspect
  style?: ImageStyle
  transparent?: boolean
  seed?: number
  model?: string
}

export type ImageReply = {
  bytes: Uint8Array
  ext: 'png' | 'webp' | 'jpg'
  width?: number
  height?: number
  provider: string
  model: string
}

export type ImageProvider = (req: ImageRequest) => Promise<ImageReply>

export type ProviderEnv = {
  env?: Record<string, string | undefined>
  fetchFn?: typeof fetch
  execFn?: (
    cmd: string,
    args: string[],
    opts: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>
  hasBinary?: (name: string) => boolean
}

const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 120_000

const stylePrompt = (req: ImageRequest): string =>
  req.style ? `${req.prompt} (${req.style} style)` : req.prompt

const openAiSize = (aspect: ImageAspect): string => {
  switch (aspect) {
    case '16:9':
    case '3:2':
    case '4:3':
    case '21:9':
      return '1536x1024'
    case '9:16':
    case '3:4':
      return '1024x1536'
    default:
      return '1024x1024'
  }
}

function binaryOnPath(
  name: string,
  env: Record<string, string | undefined>,
): boolean {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    try {
      accessSync(join(dir, name), constants.X_OK)
      return true
    } catch {
      // continue scanning PATH
    }
  }
  return false
}

const runExec = (cmd: string, args: string[], opts: { timeout: number }) =>
  new Promise<{ stdout: string; stderr: string }>((ok, no) => {
    execFile(cmd, args, { timeout: opts.timeout }, (err, stdout, stderr) => {
      if (err) no(new Error(stderr?.trim() || err.message))
      else ok({ stdout: String(stdout), stderr: String(stderr) })
    })
  })

async function readStreamCapped(
  res: Response,
  max = MAX_BYTES,
): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array(await res.arrayBuffer())
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const r = await reader.read()
    if (r.done) break
    total += r.value.length
    if (total > max) {
      await reader.cancel()
      throw new Error(`image response exceeded ${max} bytes`)
    }
    chunks.push(r.value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

const decodeBase64 = (b64: string): Uint8Array =>
  new Uint8Array(Buffer.from(b64, 'base64'))

const extFromMime = (mime: string | undefined): 'png' | 'webp' | 'jpg' =>
  mime?.includes('webp')
    ? 'webp'
    : mime?.includes('jpeg') || mime?.includes('jpg')
      ? 'jpg'
      : 'png'

export function resolveProviderName(
  config: ImageConfig | undefined,
  pe: ProviderEnv = {},
): ImageProviderName | undefined {
  const env = pe.env ?? process.env
  const chosen = config?.provider ?? env.CULM_IMAGE_PROVIDER
  if (chosen && IMAGE_PROVIDERS.includes(chosen as ImageProviderName))
    return chosen as ImageProviderName
  if (config?.endpoint || env.CULM_IMAGE_ENDPOINT) return 'http'
  // a project opts in with an `images` key (or the env names a provider or endpoint); a stray API key alone never spends money
  if (!config) return undefined
  if (env.GEMINI_API_KEY) return 'gemini'
  if (env.OPENAI_API_KEY) return 'openai'
  if ((pe.hasBinary ?? (n => binaryOnPath(n, env)))('higgsfield'))
    return 'higgsfield'
  return undefined
}

export function makeImageProvider(
  config: ImageConfig | undefined,
  pe: ProviderEnv = {},
): ImageProvider | undefined {
  const env = pe.env ?? process.env
  const name = resolveProviderName(config, pe)
  if (!name) return undefined
  const f = pe.fetchFn ?? fetch

  switch (name) {
    case 'openai': {
      const key = env.OPENAI_API_KEY
      if (!key) return undefined
      return async req => {
        const model = req.model ?? config?.model ?? 'gpt-image-1'
        const ext: 'png' | 'webp' = req.transparent ? 'png' : 'webp'
        const res = await f('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            prompt: stylePrompt(req),
            size: openAiSize(req.aspect),
            output_format: ext,
            ...(req.transparent ? { background: 'transparent' } : {}),
          }),
        })
        if (!res.ok) throw new Error(`OpenAI images answered ${res.status}`)
        const json = (await res.json()) as {
          data?: { b64_json?: string; url?: string }[]
        }
        const b64 = json.data?.[0]?.b64_json
        if (!b64) throw new Error('OpenAI images returned no image bytes')
        return { bytes: decodeBase64(b64), ext, provider: 'openai', model }
      }
    }

    case 'gemini': {
      const key = env.GEMINI_API_KEY
      if (!key) return undefined
      return async req => {
        const model = req.model ?? config?.model ?? 'imagen-3.0-generate-002'
        const isPredict = model.startsWith('imagen-')
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${isPredict ? 'predict' : 'generateContent'}`
        const body = isPredict
          ? {
              instances: [{ prompt: stylePrompt(req) }],
              parameters: {
                sampleCount: 1,
                aspectRatio: req.aspect,
                ...(req.seed !== undefined ? { seed: req.seed } : {}),
              },
            }
          : {
              contents: [{ parts: [{ text: stylePrompt(req) }] }],
              generationConfig: {
                responseModalities: ['IMAGE'],
                imageConfig: { aspectRatio: req.aspect },
              },
            }
        const res = await f(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(`Gemini images answered ${res.status}`)
        const json = (await res.json()) as {
          predictions?: { bytesBase64Encoded?: string; mimeType?: string }[]
          candidates?: {
            content?: {
              parts?: { inlineData?: { data?: string; mimeType?: string } }[]
            }
          }[]
        }
        const pred = json.predictions?.[0]
        if (pred?.bytesBase64Encoded)
          return {
            bytes: decodeBase64(pred.bytesBase64Encoded),
            ext: extFromMime(pred.mimeType),
            provider: 'gemini',
            model,
          }
        const inline = json.candidates?.[0]?.content?.parts?.find(
          p => p.inlineData?.data,
        )?.inlineData
        if (inline?.data)
          return {
            bytes: decodeBase64(inline.data),
            ext: extFromMime(inline.mimeType),
            provider: 'gemini',
            model,
          }
        throw new Error('Gemini images returned no image bytes')
      }
    }

    case 'higgsfield': {
      const exec = pe.execFn ?? runExec
      return async req => {
        const model = req.model ?? config?.model ?? 'gpt-image-2'
        const work = await mkdtemp(join(tmpdir(), 'culm-hf-'))
        try {
          const outPath = join(work, 'out.png')
          await exec(
            'higgsfield',
            [
              'generate',
              '--prompt',
              stylePrompt(req),
              '--aspect',
              req.aspect,
              '--model',
              model,
              '--out',
              outPath,
              ...(req.transparent ? ['--transparent'] : []),
              ...(req.seed !== undefined ? ['--seed', String(req.seed)] : []),
            ],
            { timeout: TIMEOUT_MS },
          )
          const files = (await readdir(work)).sort()
          const picked =
            files.find(n => n === 'out.png') ??
            files.find(n => /\.(png|webp|jpe?g)$/i.test(n))
          if (!picked) throw new Error('higgsfield produced no image file')
          const bytes = new Uint8Array(await readFile(join(work, picked)))
          const ext = picked.toLowerCase().endsWith('.webp')
            ? 'webp'
            : picked.toLowerCase().endsWith('.jpg') ||
                picked.toLowerCase().endsWith('.jpeg')
              ? 'jpg'
              : 'png'
          return { bytes, ext, provider: 'higgsfield', model }
        } finally {
          await rm(work, { recursive: true, force: true }).catch(() => {})
        }
      }
    }

    case 'http': {
      const endpoint = config?.endpoint ?? env.CULM_IMAGE_ENDPOINT
      if (!endpoint) return undefined
      return async req => {
        const model = req.model ?? config?.model ?? 'default'
        const res = await f(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...req, model }),
        })
        if (!res.ok) throw new Error(`Image endpoint answered ${res.status}`)
        const ct = res.headers.get('content-type') ?? ''
        if (ct.startsWith('image/')) {
          const bytes = await readStreamCapped(res)
          return { bytes, ext: extFromMime(ct), provider: 'http', model }
        }
        const json = (await res.json()) as {
          b64_json?: string
          imageBase64?: string
          mimeType?: string
          ext?: string
        }
        const b64 = json.b64_json ?? json.imageBase64
        if (!b64) throw new Error('Image endpoint returned no image data')
        const ext =
          json.ext === 'webp' || json.ext === 'jpg' || json.ext === 'png'
            ? json.ext
            : extFromMime(json.mimeType)
        return { bytes: decodeBase64(b64), ext, provider: 'http', model }
      }
    }
  }
}
