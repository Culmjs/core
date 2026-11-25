import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CustomEffect } from '@culmjs/core'

export const mist: CustomEffect = {
  name: 'mist',
  source:
    '// mist\r\nvec4 shade(vec2 uv){\r\nreturn vec4(u_set_tint,1.0);\r\n}',
  settings: { tint: { type: 'color', default: '#abcdef' } },
}
export const invalid = mist.source.replace('u_set_tint', 'u_field')
export const motion = { trigger: 'enter-view', gpu: 'mist' } as const
export const define = { op: 'addCustomEffect', effect: mist } as const
export const attach = {
  op: 'setMotion',
  tree: { page: 'home' },
  id: 'hero',
  motion,
} as const

export async function gpuFolder(dir: string, declared = false) {
  await writeFile(join(dir, 'culm.json'), '{"features":{"gpu":true}}')
  const page = join(dir, 'pages/home.json')
  await writeFile(
    page,
    (await readFile(page, 'utf8')).replace('"homeroot"', '"hero"'),
  )
  if (!declared) return
  const site = join(dir, 'site.json')
  await writeFile(
    site,
    (await readFile(site, 'utf8')).replace(
      '"pages":',
      '"customEffects":["effects/mist.json"],\n  "pages":',
    ),
  )
  await mkdir(join(dir, 'effects'))
  await writeFile(join(dir, 'effects/mist.frag'), mist.source)
  await writeFile(
    join(dir, 'effects/mist.json'),
    '// keep this comment\n' +
      JSON.stringify(
        { name: mist.name, settings: mist.settings, sourceFile: 'mist.frag' },
        null,
        2,
      ),
  )
}

export async function attachedGpuFolder(dir: string) {
  await gpuFolder(dir, true)
  const path = join(dir, 'pages/home.json')
  const html = await readFile(path, 'utf8')
  await writeFile(
    path,
    html.replace(
      '"id": "hero"',
      `"id": "hero", "motion": ${JSON.stringify(motion)}`,
    ),
  )
}
