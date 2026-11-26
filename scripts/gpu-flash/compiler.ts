/** Offline review harness: build the *same compiler* with the candidate's
 * generated module in memory. Never overwrite scriptsMin or raise a budget.
 * No profile switch exists in public compilePage or in a delivered page. */
import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { render } from '../gen-scripts.ts'
import type * as Core from '@culmjs/core'

export async function candidateCompiler(): Promise<typeof Core> {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'candidate-generated-scripts',
        setup(b) {
          b.onLoad({ filter: /[/\\]scriptsMin\.ts$/ }, () => ({
            contents: render(true),
            loader: 'ts',
          }))
        },
      },
    ],
  })
  const dir = await mkdtemp(join(tmpdir(), 'culm-review-'))
  try {
    const file = join(dir, 'core.mjs')
    await writeFile(file, result.outputFiles[0].contents)
    return await import(pathToFileURL(file).href)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
