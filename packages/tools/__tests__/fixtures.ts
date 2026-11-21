import { after } from 'node:test'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const made: string[] = []
// Registered when a test file imports this module: every copy goes when that file's tests are done.
after(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

/** A fresh temporary folder holding a copy of the fixture site; removed after the tests of the file. */
export async function copyFixture(name: 'site-basic'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `culm-${name}-`))
  made.push(dir)
  await cp(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name),
    dir,
    {
      recursive: true,
    },
  )
  return dir
}
