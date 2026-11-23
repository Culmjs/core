import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compilePage } from '../../src/compile/index.ts'
import { emptySite } from '../../src/document/index.ts'
import type { SiteDocument } from '../../src/document/index.ts'
import { catalogue } from '../../src/ops/catalogue.ts'
import { plan } from '../../src/ops/plan.ts'
import { RECIPES } from '../../src/ops/recipes.ts'
import { LOOK, sampleRegistry } from '../kit.ts'

const SITE_COLOURS = new Set(['brand', 'ink', 'bg', 'muted', 'line'])
const registry = sampleRegistry()
const links = { page: (s: string) => s, file: (s: string) => s, form: () => '' }

const run = (doc: SiteDocument, ids: string[], key: string) => {
  const ops = ids.flatMap(
    id => structuredClone(RECIPES.find(r => r.id === id)!.ops) as never[],
  )
  return plan(doc, registry, { site: 's', baseRevision: 0, key, ops } as never)
}

/** Every value held by a colour field, anywhere in the batch. */
function colours(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach(x => colours(x, out))
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (['color', 'bg', 'from', 'to', 'fill', 'underlineColor'].includes(k))
        if (typeof x === 'string' && x !== 'none') out.push(x)
      colours(x, out)
    }
  return out
}

test('the six recipes are hero, split, cta-band, buttons, divider and card', () => {
  assert.deepEqual(
    RECIPES.map(r => r.id),
    ['hero', 'split', 'cta-band', 'buttons', 'divider', 'card'],
  )
  for (const r of RECIPES) assert.ok(r.guide.length <= 60, r.id)
})

for (const r of RECIPES)
  test(`${r.id} is accepted by plan on emptySite, compiles within every ceiling and uses only site colours`, () => {
    const p = run(emptySite('S', LOOK), [r.id], 'k')
    assert.ok(p.ok, p.ok ? '' : JSON.stringify(p.problems))
    const c = compilePage(p.doc, 'home', {
      registry,
      mode: 'live',
      links,
    } as never)
    assert.ok(c.ok, c.ok ? '' : JSON.stringify(c.problems))
    assert.deepEqual(c.ok && c.problems, [])
    const used = colours(r.ops)
    assert.ok(used.length > 0)
    for (const x of used) assert.ok(SITE_COLOURS.has(x), x)
    assert.doesNotMatch(JSON.stringify(r.ops), /#[0-9a-fA-F]{3}/)
  })

for (const r of RECIPES.filter(x => x.id !== 'card'))
  test(`${r.id} applied twice in one site is accepted`, () => {
    const p = run(emptySite('S', LOOK), [r.id, r.id], 'k')
    assert.ok(p.ok, p.ok ? '' : JSON.stringify(p.problems))
  })

test('badge-card ends with makeComponent, and the site then lists the component', () => {
  const r = RECIPES.find(x => x.id === 'card')!
  assert.equal(r.ops.at(-1)!.op, 'makeComponent')
  const p = run(emptySite('S', LOOK), ['card'], 'k')
  assert.ok(p.ok, p.ok ? '' : JSON.stringify(p.problems))
  assert.equal(p.doc.components.length, 1)
})

test('each recipe as the catalogue serves it is accepted by plan on a site whose first page is not home', () => {
  for (const r of RECIPES) {
    const doc = emptySite('S', LOOK)
    doc.pages[0]!.id = 'start'
    doc.pages[0]!.root.id = 'startroot'
    const site = { doc, revision: 0 } as never
    const got = catalogue(registry, { what: 'recipes', id: r.id, site })
    assert.ok(got.ok, r.id)
    const ops = (got as unknown as { ops: unknown[] }).ops
    const p = plan(doc, registry, {
      site: 's',
      baseRevision: 0,
      key: 'k',
      ops,
    } as never)
    assert.ok(p.ok, `${r.id}: ${p.ok ? '' : JSON.stringify(p.problems)}`)
  }
})
