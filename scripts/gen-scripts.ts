// Writes packages/core/src/scripts/scriptsMin.ts: the shipped page scripts, minified from their readable sources.
// Run `npm run gen:scripts` after changing a script source. esbuild comes with tsx.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSync, transformSync } from 'esbuild'
import { shareScriptKeys } from './share-script-keys.ts'
import {
  CONTOURS_ID,
  CONTOURS_SOURCE,
} from '../packages/core/src/registry/gpuBuiltins.ts'
import {
  BASE_SOURCE,
  EMAIL_SOURCE,
  OPEN_SOURCE,
} from '../packages/core/src/scripts/base.ts'

const dir = new URL('../packages/core/src/scripts/', import.meta.url)

/** A self-contained typed entry, minified for ES2017 and invoked with fixed arguments. */
function shipHost(
  file = 'statesHost',
  name = 'hostStates',
  args = 'document,window',
  arrow = false,
): string {
  const src = readFileSync(new URL(`${file}.ts`, dir), 'utf8')
  const code = transformSync(src, {
    loader: 'ts',
    minify: true,
    target: 'es2017',
  }).code.trim()
  const fn = arrow
    ? code.replace(
        new RegExp(`^export function ${name}\\(([^)]*)\\)\\{`),
        '($1)=>{',
      )
    : code.replace(`export function ${name}`, 'function')
  return shareScriptKeys(
    `(${fn})(${args})`,
    arrow ? ['args', 'defaults', 'vars'] : ['defaults', 'vars'],
  )
}

/** A leading `;` (how a script joins the one before it) is kept. */
function minify(src: string): string {
  const lead = src.startsWith(';') ? ';' : ''
  return (
    lead +
    transformSync(src.slice(lead.length), { minify: true, target: 'es2017' })
      .code.trim()
      .replace(/;$/, '')
  )
}

/** One priced artifact, including the invocation and its text/layout dependencies. */
export function renderTimeline(playbackOnly = false): string {
  // Specialize lexical constants in the build input, never an ambient
  // global that could alter the directly imported editor host.
  const src = readFileSync(new URL('motionHost.ts', dir), 'utf8')
  const declaration = 'const interactive = true,'
  const abortDecl = 'abortable = true'
  if (src.split(declaration).length !== 2 || src.split(abortDecl).length !== 2)
    throw Error('Missing or ambiguous timeline profile declaration')
  const shipped = src.replace(abortDecl, 'abortable = false')
  return shareScriptKeys(
    bundle(
      (playbackOnly
        ? shipped.replace(declaration, 'const interactive = false,')
        : shipped) + '\nhostMotion(document,window)',
      undefined,
      'ts',
    ),
  )
}

function bundle(
  contents: string,
  define?: Record<string, string>,
  loader: 'js' | 'ts' = 'js',
) {
  return buildSync({
    stdin: {
      contents,
      loader,
      resolveDir: fileURLToPath(dir),
    },
    define,
    bundle: true,
    format: 'iife',
    target: 'es2017',
    minify: true,
    write: false,
  }).outputFiles[0].text.trim()
}

// Release selection is build-owned. Both artifacts are independently priced
// complete bundles; this is not a runtime switch or a compiler option.
export const RELEASE_CHECKED: boolean = true
export function renderGpuWorker(checked = RELEASE_CHECKED): string {
  if (!checked) {
    return bundle(
      `import {acquire} from './gpuTrustedWorker.ts';onmessage=acquire`,
      {
        CONTOURS: JSON.stringify(CONTOURS_SOURCE),
      },
    )
  }
  const src = readFileSync(new URL('gpuWorker.ts', dir), 'utf8')
  const worker = bundle(
    src.replace('export const acquire =', 'onmessage ='),
    undefined,
    'ts',
  )
  return shareScriptKeys(worker, ['args', 'defaults', 'vars'], true)
}

export function renderGpuHost(checked = RELEASE_CHECKED): string {
  if (!checked) {
    return bundle(
      `import {hostGpu} from './gpuTrustedHost.ts';hostGpu(document,window)`,
      {
        WORKER_SOURCE: JSON.stringify(renderGpuWorker(false)),
        EFFECT_ID: JSON.stringify(CONTOURS_ID),
        CHECKED_GEOMETRY: 'false',
      },
    )
  }
  const worker = renderGpuWorker(true)
  const placeholder = '__CULM_WORKER_PLACEHOLDER__'
  const src =
    readFileSync(new URL('gpuHost.ts', dir), 'utf8').replace(
      'export function hostGpu',
      'function hostGpu',
    ) + '\nhostGpu(document,window)'
  const pre = shareScriptKeys(
    bundle(src, { WORKER_SOURCE: JSON.stringify(placeholder) }, 'ts'),
    ['args', 'defaults', 'vars'],
    false,
  )
  if (worker.includes('`') || worker.includes('${'))
    throw Error('Unexpected template delimiter in worker source')
  const tpl = '`' + worker.replace(/\\/g, '\\\\') + '`'
  if (new Function(`return ${tpl}`)() !== worker)
    throw Error('Embedded worker template round-trip mismatch')
  return pre.replace(JSON.stringify(placeholder), () => tpl)
}

export function render(checked = RELEASE_CHECKED): string {
  const hash = (s: string) =>
    `sha256-${createHash('sha256').update(s).digest('base64')}`
  const GPU_HOST_SCRIPT = renderGpuHost(checked)
  const GPU_HOST_INTEGRITY = hash(GPU_HOST_SCRIPT)
  const GPU_HOST_PATH = '_culm/gpu.js'
  const GPU_LOADER_SCRIPT = shipHost(
    'gpuLoader',
    'loadGpu',
    `document,window,"/${GPU_HOST_PATH}","${GPU_HOST_INTEGRITY}"`,
    true,
  )
  const scripts = {
    BASE_SCRIPT: minify(BASE_SOURCE),
    OPEN_SCRIPT: minify(OPEN_SOURCE),
    EMAIL_SCRIPT: minify(EMAIL_SOURCE),
    STATES_SCRIPT: shipHost(),
    TIMELINE_SCRIPT: renderTimeline(),
    PLAYBACK_TIMELINE_SCRIPT: renderTimeline(true),
    GPU_HOST_PATH,
    GPU_HOST_SCRIPT,
    GPU_HOST_INTEGRITY,
    GPU_LOADER_SCRIPT,
  }
  // 0..31 preserve full/no-timeline selections. 32..47 are playback-only:
  // bits 0..2 as before, bit 3 for the GPU. Hash the exact joined script.
  const hashes = Array.from({ length: 48 }, (_, i) =>
    hash(
      [
        scripts.BASE_SCRIPT +
          (i & 1 ? scripts.OPEN_SCRIPT : '') +
          (i & 2 ? scripts.EMAIL_SCRIPT : ''),
        ...(i & 4 ? [scripts.STATES_SCRIPT] : []),
        ...(i >= 32
          ? [scripts.PLAYBACK_TIMELINE_SCRIPT]
          : i & 8
            ? [scripts.TIMELINE_SCRIPT]
            : []),
        ...((i >= 32 ? i & 8 : i & 16) ? [GPU_LOADER_SCRIPT] : []),
      ].join(';'),
    ),
  )
  const body = Object.entries(scripts)
    .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)}\n`)
    .join('')
  return `// Generated by scripts/gen-scripts.ts. Do not edit; run \`npm run gen:scripts\`.\nexport const GPU_CHECKED = ${checked}\n${body}export const INLINE_HASHES = ${JSON.stringify(hashes)}\nexport const SCRIPTS_DIGEST = ${JSON.stringify(createHash('sha256').update(body).digest('hex'))}\n`
}

const measureDir = new URL('../packages/core/src/measure/', import.meta.url)

/** measureNodes (typed, in probe.ts) as PROBE_SCRIPT: the function minified for ES2018, a function expression `(document, window, width) => raw`. */
export function renderProbe(): string {
  const src = readFileSync(new URL('probe.ts', measureDir), 'utf8')
  // measureNodes must end at the first line that is a lone `}` (the function's last line)
  const from = src.indexOf('export function measureNodes')
  const fn = transformSync(src.slice(from, src.indexOf('\n}\n', from) + 3), {
    loader: 'ts',
    minify: true,
    target: 'es2018', // object spread stays inline; es2017 would put a helper outside the function
  })
    .code.trim()
    .replace(/^export function measureNodes/, 'function')
  return `// Generated by scripts/gen-scripts.ts. Do not edit; run \`npm run gen:scripts\`.\nexport const PROBE_SCRIPT = ${JSON.stringify(`(${fn})`)}\n`
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  writeFileSync(new URL('scriptsMin.ts', dir), render())
  writeFileSync(new URL('probeMin.ts', measureDir), renderProbe())
}
