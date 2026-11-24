import { pathToFileURL } from 'node:url'
import { BUDGETS, byteLength } from '../packages/core/src/compile/budgets.ts'

export function priceGpu({
  inline,
  lazyJs,
  wasm,
  encodedWasm,
}: {
  inline: string[]
  lazyJs: string
  wasm: Uint8Array
  encodedWasm: string
}) {
  const hostJs = byteLength(lazyJs)
  const sharedJs = byteLength(inline.join(';')) + hostJs
  return {
    sharedJs,
    hostJs,
    wasmBytes: wasm.byteLength,
    wasmTransportBytes: byteLength(encodedWasm),
    remainingJs: BUDGETS.sharedScripts - sharedJs,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { makePage } = await import('./gpu-spike/pages.ts')
  const { observe } = await import('./gpu-spike/observe.ts')
  const pages = {
    control: await makePage('control'),
    shader: await makePage('shader'),
    wasm: await makePage('wasm'),
    mixed: await makePage('mixed'),
  }
  console.table(
    Object.fromEntries(
      Object.entries(pages).map(([name, page]) => [
        name,
        {
          compiled: page.compiledBytes,
          inline: byteLength(page.inline.join(';')),
          ...priceGpu(page),
          glsl: page.glslBytes,
          inert: page.dataBytes,
          addedHtml: page.addedHtmlBytes,
        },
      ]),
    ),
  )
  await observe(pages)
}
