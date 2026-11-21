import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SiteDocument } from '@culmjs/core'
import { memoryStore } from '@culmjs/core/ops'
import { copyFixture } from '../fixtures.ts'
import { openProject } from '../../src/folder/project.ts'
import { openBrowser } from '../../src/measure/browser.ts'
import {
  ids,
  measureSince,
  runMeasure,
  skippedStates,
} from '../../src/measure/run.ts'

const INSTALL = 'npx playwright install chromium'

test('a missing Chromium executable gives MEASUREMENT_INCOMPLETE that names the install command', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'culm-none-'))
  try {
    const r = await openBrowser({
      env: { PLAYWRIGHT_BROWSERS_PATH: empty, PATH: empty },
      home: empty,
      system: [],
    })
    assert.equal(r.ok, false)
    assert.ok(!r.ok)
    assert.equal(r.problems.length, 1)
    assert.equal(r.problems[0]!.code, 'MEASUREMENT_INCOMPLETE')
    assert.ok(r.problems[0]!.message.includes(INSTALL), r.problems[0]!.message)
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
  const named = await openBrowser({ executable: '/nonexistent/chrome' })
  assert.ok(!named.ok)
  assert.equal(named.problems[0]!.code, 'MEASUREMENT_INCOMPLETE')
  assert.ok(named.problems[0]!.message.includes(INSTALL))
})

test('a run with no browser is a report that says every page is incomplete', async () => {
  const p = await openProject(await copyFixture('site-basic'))
  const doc = p.loaded.doc!
  const r = await runMeasure({
    doc,
    registry: p.registry,
    data: p.loaded.data,
    revision: 3,
    executable: '/nonexistent/chrome',
  })
  assert.equal(r.revision, 3)
  assert.match(r.build, /^[0-9a-f]{64}$/)
  assert.deepEqual(r.findings, [])
  assert.deepEqual(r.measured, [])
  assert.deepEqual(r.incomplete.map(i => i.page).sort(), [
    'about',
    'home',
    'menu',
  ])
  for (const i of r.incomplete) {
    assert.equal(i.problem.code, 'MEASUREMENT_INCOMPLETE')
    assert.ok(i.problem.message.includes(INSTALL))
  }
})

test('measureSince with a revision the store does not hold is UNSUPPORTED_CAPABILITY', async () => {
  const p = await openProject(await copyFixture('site-basic'))
  const store = memoryStore({ site: p.loaded.doc! })
  for (const since of [5, -1]) {
    const r = await measureSince({
      store,
      site: 'site',
      since,
      registry: p.registry,
      data: p.loaded.data,
      executable: '/nonexistent/chrome',
    })
    assert.ok(!r.ok, `since ${since}`)
    assert.equal(r.problems.length, 1)
    assert.equal(r.problems[0]!.code, 'UNSUPPORTED_CAPABILITY')
  }
  const none = await measureSince({
    store,
    site: 'nope',
    since: 0,
    registry: p.registry,
    data: p.loaded.data,
  })
  assert.ok(!none.ok)
  assert.equal(none.problems[0]!.code, 'INVALID_DOCUMENT')
})

test('a document that is not a site is incomplete, never a throw', async () => {
  const p = await openProject(await copyFixture('site-basic'))
  const broken = {
    ...p.loaded.doc!,
    pages: undefined,
  } as unknown as SiteDocument
  const r = await runMeasure({
    doc: broken,
    registry: p.registry,
    data: p.loaded.data,
    revision: 1,
    executable: '/nonexistent/chrome',
  })
  assert.deepEqual(r.findings, [])
  assert.equal(r.incomplete.length, 1)
  assert.equal(r.incomplete[0]!.problem.code, 'MEASUREMENT_INCOMPLETE')
})

test('skippedStates lists the non-initial states of the page, header, footer and the components they draw, and no others', async () => {
  const p = await openProject(await copyFixture('site-basic'))
  const doc = structuredClone(p.loaded.doc!)
  const st = (name: string) => [{ name, values: ['a', 'b'], initial: 'a' }]
  doc.pages.find(x => x.id === 'home')!.root.state = st('page')
  doc.header.state = st('head')
  doc.footer.state = st('foot')
  const used = doc.components[0]!
  used.root.state = st('used')
  doc.components.push({
    ...structuredClone(used),
    id: 'unused',
    root: {
      ...structuredClone(used.root),
      id: 'unusedroot',
      state: st('unused'),
    },
  })
  assert.deepEqual(skippedStates(doc, 'home').sort(), [
    'state:foot=b',
    'state:head=b',
    'state:page=b',
    'state:used=b',
  ])
  assert.deepEqual(skippedStates(doc, 'about').sort(), [
    'state:foot=b',
    'state:head=b',
    'state:used=b',
  ])
})

test('ids names the pages a broken run was asked for, else the readable page ids, else one empty id', () => {
  const doc = { pages: [{ id: 'a' }, { id: 5 }, { id: 'b' }] } as never
  assert.deepEqual(ids({ pages: ['x'], doc } as never), ['x'])
  assert.deepEqual(ids({ doc } as never), ['a', 'b'])
  assert.deepEqual(ids({ doc: {} } as never), [''])
})
