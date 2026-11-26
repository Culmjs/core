import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Problem } from '@culmjs/core'
import { isObj } from '../shared.ts'
import {
  makeImageProvider,
  type ImageAspect,
  type ImageConfig,
  type ImageProvider,
  type ImageRequest,
  type ImageStyle,
} from './providers.ts'

export const ASPECTS: readonly ImageAspect[] = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '21:9',
]
export const IMAGE_STYLES: readonly ImageStyle[] = [
  'photo',
  'illustration',
  'diagram',
  '3d',
  'flat',
]
export const MAX_GENERATED_IMAGES = 8
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export type ParsedGenerate =
  { ok: true; req: ImageRequest } | { ok: false; message: string }

/** Parse string or object `generate` shorthand into a validated `ImageRequest`. */
export function parseGenerateSpec(
  raw: unknown,
  aspectFallback?: unknown,
): ParsedGenerate {
  const o = typeof raw === 'string' ? { prompt: raw } : isObj(raw) ? raw : null
  if (!o)
    return {
      ok: false,
      message:
        'generate must be a prompt string or { prompt, aspect?, style? }.',
    }
  const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : ''
  if (!prompt || prompt.length > 1000)
    return {
      ok: false,
      message: 'generate.prompt must be 1 to 1000 characters.',
    }
  const rawAspect =
    o.aspect ?? (typeof aspectFallback === 'string' ? aspectFallback : '16:9')
  if (
    typeof rawAspect !== 'string' ||
    !ASPECTS.includes(rawAspect as ImageAspect)
  )
    return {
      ok: false,
      message: `aspect must be one of ${ASPECTS.join(', ')}.`,
    }
  if (
    o.style !== undefined &&
    (typeof o.style !== 'string' ||
      !IMAGE_STYLES.includes(o.style as ImageStyle))
  )
    return {
      ok: false,
      message: `style must be one of ${IMAGE_STYLES.join(', ')}.`,
    }
  if (o.transparent !== undefined && typeof o.transparent !== 'boolean')
    return { ok: false, message: 'transparent must be true or false.' }
  if (
    o.seed !== undefined &&
    (!Number.isInteger(o.seed) || (o.seed as number) < 0)
  )
    return { ok: false, message: 'seed must be a non-negative integer.' }
  if (
    o.model !== undefined &&
    (typeof o.model !== 'string' || !o.model.trim() || o.model.length > 80)
  )
    return { ok: false, message: 'model must be a short model name.' }
  return {
    ok: true,
    req: {
      prompt,
      aspect: rawAspect as ImageAspect,
      ...(o.style !== undefined ? { style: o.style as ImageStyle } : {}),
      ...(o.transparent !== undefined ? { transparent: o.transparent } : {}),
      ...(o.seed !== undefined ? { seed: o.seed as number } : {}),
      ...(o.model !== undefined ? { model: (o.model as string).trim() } : {}),
    },
  }
}

/** Deterministic `gen/<slug>-<hash10>` stem from the canonical generation request. */
export function genAssetStem(
  req: ImageRequest,
  modelOverride?: string,
): string {
  const words = req.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
    .slice(0, 28)
    .replace(/-+$/, '')
  const slug = words || 'image'
  const canonical = JSON.stringify({
    v: 1,
    prompt: req.prompt,
    aspect: req.aspect,
    style: req.style ?? null,
    transparent: req.transparent ?? false,
    seed: req.seed ?? null,
    model: req.model ?? modelOverride ?? null,
  })
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 10)
  return `gen/${slug}-${hash}`
}

/** Numeric CSS aspect ratio for `'16:9'` etc. */
export function aspectNumber(a: ImageAspect): number {
  const [w, h] = a.split(':').map(Number)
  return Math.round((w! / h!) * 1000) / 1000
}

/** Verify image magic bytes (`png`, `webp`, `jpg`) and extract natural dimensions. */
export function inspectImageBytes(
  bytes: Uint8Array,
): { ext: 'png' | 'webp' | 'jpg'; width: number; height: number } | null {
  if (bytes.length < 12 || bytes.length > MAX_IMAGE_BYTES) return null
  const b = Buffer.from(bytes)
  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width/height at offsets 16..24
  if (
    b.length >= 24 &&
    b.readUInt32BE(0) === 0x89504e47 &&
    b.readUInt32BE(4) === 0x0d0a1a0a &&
    b.toString('ascii', 12, 16) === 'IHDR'
  ) {
    const width = b.readUInt32BE(16)
    const height = b.readUInt32BE(20)
    if (width > 0 && height > 0) return { ext: 'png', width, height }
  }
  // WEBP: RIFF....WEBP
  if (
    b.length >= 25 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = b.toString('ascii', 12, 16)
    if (chunk === 'VP8X' && b.length >= 30) {
      const width = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16))
      const height = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16))
      return { ext: 'webp', width, height }
    }
    if (chunk === 'VP8L' && b.length >= 25) {
      const bits = b.readUInt32LE(21)
      const width = (bits & 0x3fff) + 1
      const height = ((bits >> 14) & 0x3fff) + 1
      return { ext: 'webp', width, height }
    }
    if (chunk === 'VP8 ' && b.length >= 30) {
      const width = b.readUInt16LE(26) & 0x3fff
      const height = b.readUInt16LE(28) & 0x3fff
      if (width > 0 && height > 0) return { ext: 'webp', width, height }
    }
    return { ext: 'webp', width: 0, height: 0 }
  }
  // JPEG: FF D8 FF ... SOF0..SOF3
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) break
      const marker = b[i + 1]!
      if (marker === 0xd9 || marker === 0xda) break
      const len = b.readUInt16BE(i + 2)
      if (len < 2 || i + 2 + len > b.length) break
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7)
      ) {
        const height = b.readUInt16BE(i + 5)
        const width = b.readUInt16BE(i + 7)
        if (width > 0 && height > 0) return { ext: 'jpg', width, height }
      }
      i += 2 + len
    }
    return { ext: 'jpg', width: 0, height: 0 }
  }
  return null
}

type WantGen = {
  stem: string
  req: ImageRequest
  op: number
  path: string
}

const inv = (message: string, op: number, path?: string): Problem => ({
  code: 'INVALID_OPERATION',
  message,
  op,
  ...(path ? { path } : {}),
})

function scanDeclBg(
  decl: unknown,
  op: number,
  path: string,
  config: ImageConfig | undefined,
  wants: Map<string, WantGen>,
  problems: Problem[],
): void {
  if (
    !isObj(decl) ||
    !isObj(decl.bgImage) ||
    decl.bgImage.generate === undefined
  )
    return
  const p = parseGenerateSpec(decl.bgImage.generate, decl.bgImage.aspect)
  if (!p.ok) {
    problems.push(inv(p.message, op, `${path}.bgImage.generate`))
    return
  }
  const stem = genAssetStem(p.req, config?.model)
  if (!wants.has(stem))
    wants.set(stem, { stem, req: p.req, op, path: `${path}.bgImage` })
}

function scanNodeGen(
  node: unknown,
  op: number,
  path: string,
  config: ImageConfig | undefined,
  wants: Map<string, WantGen>,
  problems: Problem[],
  depth = 0,
): void {
  if (!isObj(node) || depth > 64) return
  if (isObj(node.props) && node.props.generate !== undefined) {
    const p = parseGenerateSpec(node.props.generate, node.props.aspect)
    if (!p.ok) {
      problems.push(inv(p.message, op, `${path}.props.generate`))
    } else {
      const stem = genAssetStem(p.req, config?.model)
      if (!wants.has(stem))
        wants.set(stem, { stem, req: p.req, op, path: `${path}.props` })
    }
  }
  if (isObj(node.style)) {
    for (const [k, d] of Object.entries(node.style))
      scanDeclBg(d, op, `${path}.style.${k}`, config, wants, problems)
  }
  if (Array.isArray(node.children))
    node.children.forEach((c, i) =>
      scanNodeGen(
        c,
        op,
        `${path}.children.${i}`,
        config,
        wants,
        problems,
        depth + 1,
      ),
    )
}

/** Collect every `generate` request across `ops`. */
export function collectImageRequests(
  ops: unknown[],
  config?: ImageConfig,
): { wants: Map<string, WantGen>; problems: Problem[] } {
  const wants = new Map<string, WantGen>()
  const problems: Problem[] = []
  ops.forEach((op, i) => {
    if (!isObj(op)) return
    if (op.op === 'add')
      scanNodeGen(op.node, i, 'node', config, wants, problems)
    else if (
      op.op === 'setProps' &&
      isObj(op.props) &&
      op.props.generate !== undefined
    ) {
      const p = parseGenerateSpec(op.props.generate, op.props.aspect)
      if (!p.ok) problems.push(inv(p.message, i, 'props.generate'))
      else {
        const stem = genAssetStem(p.req, config?.model)
        if (!wants.has(stem))
          wants.set(stem, { stem, req: p.req, op: i, path: 'props' })
      }
    } else if (op.op === 'setStyle') {
      scanDeclBg(op.decl, i, 'decl', config, wants, problems)
    }
  })
  return { wants, problems }
}

export type ResolvedAsset = {
  assetId: string
  width?: number
  height?: number
}

function rewriteProps(
  props: Record<string, unknown>,
  resolved: ReadonlyMap<string, ResolvedAsset>,
  config?: ImageConfig,
): { props: Record<string, unknown>; aspect?: number } {
  if (props.generate === undefined) return { props }
  const p = parseGenerateSpec(props.generate, props.aspect)
  const next = { ...props }
  delete next.generate
  delete next.aspect
  if (!p.ok) return { props: next }
  const stem = genAssetStem(p.req, config?.model)
  const hit = resolved.get(stem)
  next.assetId = hit?.assetId ?? `${stem}.${p.req.transparent ? 'png' : 'webp'}`
  if (hit?.width && next.width === undefined) next.width = hit.width
  if (hit?.height && next.height === undefined) next.height = hit.height
  return { props: next, aspect: aspectNumber(p.req.aspect) }
}

function rewriteDecl(
  decl: unknown,
  resolved: ReadonlyMap<string, ResolvedAsset>,
  config?: ImageConfig,
): unknown {
  if (
    !isObj(decl) ||
    !isObj(decl.bgImage) ||
    decl.bgImage.generate === undefined
  )
    return decl
  const p = parseGenerateSpec(decl.bgImage.generate, decl.bgImage.aspect)
  if (!p.ok) return decl
  const stem = genAssetStem(p.req, config?.model)
  const hit = resolved.get(stem)
  return {
    ...decl,
    bgImage: hit?.assetId ?? `${stem}.${p.req.transparent ? 'png' : 'webp'}`,
  }
}

function rewriteNode(
  node: unknown,
  resolved: ReadonlyMap<string, ResolvedAsset>,
  config?: ImageConfig,
  depth = 0,
): unknown {
  if (!isObj(node) || depth > 64) return node
  let next: Record<string, unknown> = node
  if (isObj(node.props) && node.props.generate !== undefined) {
    const rw = rewriteProps(node.props, resolved, config)
    const baseStyle =
      isObj(node.style) && isObj(node.style.base) ? node.style.base : undefined
    const needAspect =
      rw.aspect !== undefined &&
      node.kind === 'image' &&
      baseStyle?.aspect === undefined
    next = {
      ...next,
      props: rw.props,
      ...(needAspect
        ? {
            style: {
              ...(isObj(node.style) ? node.style : {}),
              base: { ...(baseStyle ?? {}), aspect: rw.aspect },
            },
          }
        : {}),
    }
  }
  if (isObj(next.style)) {
    let changed = false
    const styleCopy: Record<string, unknown> = { ...next.style }
    for (const [k, d] of Object.entries(next.style)) {
      const rd = rewriteDecl(d, resolved, config)
      if (rd !== d) {
        styleCopy[k] = rd
        changed = true
      }
    }
    if (changed) next = { ...next, style: styleCopy }
  }
  if (Array.isArray(next.children)) {
    const kids = next.children.map(c =>
      rewriteNode(c, resolved, config, depth + 1),
    )
    next = { ...next, children: kids }
  }
  return next
}

/** Rewrite any `generate` image shorthands in `ops` to `assetId` strings (used by both `previewOps` and `fetchImagesFor`). */
export function rewriteImageOps(
  ops: unknown[],
  resolved: ReadonlyMap<string, ResolvedAsset>,
  config?: ImageConfig,
): unknown[] {
  return ops.map(op => {
    if (!isObj(op)) return op
    if (op.op === 'add')
      return { ...op, node: rewriteNode(op.node, resolved, config) }
    if (
      op.op === 'setProps' &&
      isObj(op.props) &&
      op.props.generate !== undefined
    )
      return { ...op, props: rewriteProps(op.props, resolved, config).props }
    if (op.op === 'setStyle')
      return { ...op, decl: rewriteDecl(op.decl, resolved, config) }
    return op
  })
}

const plainDir = async (p: string): Promise<boolean | undefined> => {
  try {
    const s = await lstat(p)
    return s.isDirectory() && !s.isSymbolicLink()
  } catch {
    return undefined
  }
}

async function ensureGenDir(dir: string): Promise<string> {
  let at = dir
  for (const part of ['assets', 'gen']) {
    at = join(at, part)
    if ((await plainDir(at)) === false)
      throw new Error(`${part}/ is not a plain folder`)
    await mkdir(at, { recursive: true })
    if ((await plainDir(at)) !== true)
      throw new Error(`${part}/ is not a plain folder`)
  }
  return at
}

async function writeAtomicBytes(
  path: string,
  bytes: Uint8Array | string,
): Promise<void> {
  const tmp = `${path}.fetch-${randomUUID()}`
  try {
    await writeFile(tmp, bytes, { flag: 'wx' })
    await rename(tmp, path)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

export type ImageResolution =
  | {
      ok: true
      ops: unknown[]
      /** True when `generate()` will call the provider and write files. */
      pending: boolean
      generate: () => Promise<Problem[]>
      /** The ops with the generated files' sizes filled in; call after `generate()`. */
      final: () => unknown[]
    }
  | { ok: false; problems: Problem[] }

/**
 * Check every `generate` image request in `ops` without calling the provider: reuse cached files in `assets/gen/`,
 * rewrite each request to its deterministic `gen/<stem>.<ext>` path, and refuse what cannot run (offline, over the cap, no provider).
 * `generate()` then calls the provider (bounded concurrency 2, max 8 new images), verifies magic bytes and stores each file atomically beside `.json` provenance.
 */
export async function resolveImagesFor(
  dir: string,
  ops: unknown[],
  heldGenerated: ReadonlyMap<string, ResolvedAsset>,
  options: {
    config?: ImageConfig
    provider?: ImageProvider
    offline?: boolean
  } = {},
): Promise<ImageResolution> {
  const { wants, problems } = collectImageRequests(ops, options.config)
  if (problems.length) return { ok: false, problems }
  const none = (o: unknown[]): ImageResolution => ({
    ok: true,
    ops: o,
    pending: false,
    generate: async () => [],
    final: () => o,
  })
  if (!wants.size) return none(ops)

  const resolved = new Map<string, ResolvedAsset>()
  const missing: WantGen[] = []
  for (const w of wants.values()) {
    const hit = heldGenerated.get(w.stem)
    if (hit) resolved.set(w.stem, hit)
    else missing.push(w)
  }
  if (!missing.length)
    return none(rewriteImageOps(ops, resolved, options.config))

  if (options.offline)
    return {
      ok: false,
      problems: [
        {
          code: 'FETCH_FAILED',
          message: 'Generated image is not held locally for replay.',
          op: missing[0]!.op,
        },
      ],
    }

  if (missing.length > MAX_GENERATED_IMAGES)
    return {
      ok: false,
      problems: [
        {
          code: 'RESOURCE_LIMIT_EXCEEDED',
          message: `A batch generates at most ${MAX_GENERATED_IMAGES} new images; this one asks for ${missing.length}.`,
          op: missing[0]!.op,
        },
      ],
    }

  const provider = options.provider ?? makeImageProvider(options.config)
  if (!provider)
    return {
      ok: false,
      problems: [
        {
          code: 'UNSUPPORTED_CAPABILITY',
          message:
            'No image generator is configured. Set GEMINI_API_KEY, OPENAI_API_KEY, install higgsfield CLI, or configure "images" in culm.json — or use a procedural shape/scene.',
          op: missing[0]!.op,
        },
      ],
    }

  const generated: {
    want: WantGen
    ext: 'png' | 'webp' | 'jpg'
    width: number
    height: number
    bytes: Uint8Array
    provider: string
    model: string
  }[] = []

  const generate = async (): Promise<Problem[]> => {
    // Run up to 2 generations concurrently; fail before writing anything on disk.
    for (let i = 0; i < missing.length; i += 2) {
      const chunk = missing.slice(i, i + 2)
      try {
        const results = await Promise.all(
          chunk.map(async w => {
            const reply = await provider(w.req)
            const info = inspectImageBytes(reply.bytes)
            if (!info)
              throw new Error(
                'provider returned bytes that are not a valid PNG, WebP, or JPEG image',
              )
            const want = w.req.transparent ? 'png' : 'webp'
            if (info.ext !== want)
              throw new Error(
                `provider returned ${info.ext} but ${want} was expected (transparent images are png, others webp, fixed before generation); retry, or ${info.ext === 'png' ? 'set transparent: true' : 'use a provider that returns ' + want}`,
              )
            return {
              want: w,
              ext: info.ext,
              width: reply.width ?? info.width,
              height: reply.height ?? info.height,
              bytes: reply.bytes,
              provider: reply.provider,
              model: reply.model,
            }
          }),
        )
        generated.push(...results)
      } catch (e) {
        return [
          {
            code: 'FETCH_FAILED',
            message: `Could not generate image "${chunk[0]!.req.prompt.slice(0, 60)}": ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
            op: chunk[0]!.op,
          },
        ]
      }
    }

    try {
      await ensureGenDir(dir)
      for (const g of generated) {
        const fileStem = g.want.stem.slice('gen/'.length)
        // the name is the one the ops already carry, so it cannot depend on what the provider sends
        const ext = g.want.req.transparent ? 'png' : 'webp'
        const relAsset = `${g.want.stem}.${ext}`
        const absAsset = join(dir, 'assets', 'gen', `${fileStem}.${ext}`)
        const absMeta = join(dir, 'assets', 'gen', `${fileStem}.json`)
        const sha256 = createHash('sha256').update(g.bytes).digest('hex')
        await writeAtomicBytes(absAsset, g.bytes)
        await writeAtomicBytes(
          absMeta,
          JSON.stringify(
            {
              prompt: g.want.req.prompt,
              aspect: g.want.req.aspect,
              ...(g.want.req.style ? { style: g.want.req.style } : {}),
              ...(g.want.req.transparent ? { transparent: true } : {}),
              ...(g.want.req.seed !== undefined
                ? { seed: g.want.req.seed }
                : {}),
              provider: g.provider,
              model: g.model,
              width: g.width,
              height: g.height,
              sha256,
              createdAt: new Date().toISOString(),
            },
            null,
            2,
          ) + '\n',
        )
        resolved.set(g.want.stem, {
          assetId: relAsset,
          ...(g.width > 0 ? { width: g.width } : {}),
          ...(g.height > 0 ? { height: g.height } : {}),
        })
      }
    } catch (e) {
      return [
        {
          code: 'FETCH_FAILED',
          message: `Could not store generated image: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
          op: generated[0]?.want.op ?? 0,
        },
      ]
    }
    return []
  }

  return {
    ok: true,
    ops: rewriteImageOps(ops, resolved, options.config),
    pending: true,
    generate,
    final: () => rewriteImageOps(ops, resolved, options.config),
  }
}

/** `resolveImagesFor` followed by `generate()`: the ops with every image fetched (the CLI `render` path). */
export async function fetchImagesFor(
  dir: string,
  ops: unknown[],
  heldGenerated: ReadonlyMap<string, ResolvedAsset>,
  options: Parameters<typeof resolveImagesFor>[3] = {},
): Promise<{ ok: true; ops: unknown[] } | { ok: false; problems: Problem[] }> {
  const r = await resolveImagesFor(dir, ops, heldGenerated, options)
  if (!r.ok) return r
  const problems = await r.generate()
  return problems.length
    ? { ok: false, problems }
    : { ok: true, ops: r.final() }
}
