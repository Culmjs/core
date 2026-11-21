import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { copyFixture } from '../__tests__/fixtures.ts'
import { serve } from '../__tests__/mcp/serve.ts'
import { fileHashes } from '../src/build/bundle.ts'
import { readAsset } from '../src/folder/files.ts'
import { openProject } from '../src/folder/project.ts'
import { runMeasure } from '../src/measure/run.ts'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'
const IMG = `{ "id": "loafpic", "kind": "image", "name": "Loaf", "props": { "assetId": "loaf.svg", "alt": "A loaf" } },`

test('MCP measure on a folder with an image and a catalogue font equals culm check: same build, nothing of the site blocked', async () => {
  const dir = await copyFixture('site-basic')
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'assets/loaf.svg'), SVG)
  await mkdir(join(dir, 'fonts'))
  await writeFile(join(dir, 'fonts/roboto.woff2'), 'not a real font')
  const about = join(dir, 'pages/about.json')
  await writeFile(
    about,
    (await readFile(about, 'utf8')).replace(
      '"children": [',
      `"children": [\n${IMG}`,
    ),
  )
  const site = join(dir, 'site.json')
  await writeFile(
    site,
    (await readFile(site, 'utf8'))
      .replace('"headingFont": "sys:serif"', '"headingFont": "cat:roboto"')
      .replace('"fonts": ["sys:serif"', '"fonts": ["cat:roboto"'),
  )

  const project = await openProject(dir)
  assert.deepEqual(project.loaded.problems, [])
  const checked = await runMeasure({
    doc: project.loaded.doc!,
    registry: project.registry,
    data: project.loaded.data,
    revision: 0,
    files: await fileHashes(dir),
    assets: p => readAsset(dir, p),
  })
  assert.deepEqual(checked.blocked, [])

  const { call } = await serve(dir)
  const r = await call('measure')
  assert.equal(r.error, false, JSON.stringify(r.json))
  assert.deepEqual(r.json.blocked, [])
  assert.equal(r.json.build, checked.build)
  assert.equal(r.json.findings.length, checked.findings.length)
  assert.equal(
    JSON.stringify(r.json.findings).includes('"assets":false'),
    false,
  )
})
