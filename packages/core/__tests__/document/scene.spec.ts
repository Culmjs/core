import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compileFrame,
  createRegistry,
  validateSite,
  type Node,
} from '../../src/index.ts'
import {
  arcPath,
  expandMarks,
  lowerSceneGeometry,
  MAX_MARKS,
  splinePath,
  wavePath,
} from '../../src/document/scene.ts'
import { runChecks } from '../../src/measure/index.ts'
import { LOOK } from '../kit.ts'
import { col, n, reg, site } from '../validate/helpers.ts'

const shape = (props: object, more: object = {}): Node =>
  n({ id: 's', kind: 'shape', name: 'S', slot: {}, props, ...more })

test('splinePath, arcPath and wavePath emit valid deterministic SVG paths', () => {
  const s1 = splinePath(
    [
      [0, 50],
      [40, 10],
      [80, 90],
      [120, 40],
    ],
    false,
    0.5,
  )
  assert.match(s1, /^M0 50C/)
  assert.equal(
    splinePath(
      [
        [0, 50],
        [40, 10],
        [80, 90],
      ],
      true,
    ).endsWith('Z'),
    true,
  )
  const ring = arcPath(50, 50, 40, 0, 180, 20)
  assert.match(ring, /^M50 10A40 40/)
  assert.match(arcPath(50, 50, 40, 0, 360, 15), /A15 15/)
  const w = wavePath(400, 120, { y: 60, amp: 20, freq: 2, closeBottom: true })
  assert.match(w, /^M0 60C/)
  assert.ok(w.endsWith('L400 120L0 120Z'))
})

test('marks + repeat expand deterministically and enforce MAX_MARKS (256)', () => {
  const res = expandMarks(
    [
      {
        circle: [20, 20, 4],
        fill: 'brand',
        repeat: { count: 4, step: [15, 0], opacity: [1, 0.25] },
      },
    ],
    [100, 100],
  )
  assert.equal(res.over, false)
  assert.equal(res.count, 4)
  assert.equal(res.primitives.length, 4)
  assert.equal((res.primitives[3] as { opacity?: number }).opacity, 0.25)

  const doc = site(
    col(
      shape({
        geometry: { type: 'scene', view: [200, 200] },
        marks: Array.from({ length: 5 }, () => ({
          circle: [10, 10, 2],
          repeat: { count: 60 },
        })),
      }),
    ),
  )
  const probs = validateSite(doc, reg)
  assert.ok(probs.some(p => p.code === 'RESOURCE_LIMIT_EXCEEDED'))
  assert.equal(MAX_MARKS, 256)
})

test('chart, diagram, contours and stamp validate and compile deterministically', () => {
  const bar = shape({
    geometry: {
      type: 'chart',
      chart: 'bar',
      legend: true,
      labels: ['Jan', 'Feb', 'Mar'],
      series: [
        { name: 'A', values: [12, 24, 18], color: 'brand' },
        { name: 'B', values: [8, 16, 22], color: 'accent' },
      ],
    },
  })
  const line = shape({
    geometry: {
      type: 'chart',
      chart: 'area',
      series: [{ values: [10, 30, 25, 45] }],
    },
  })
  const donut = shape({
    geometry: {
      type: 'chart',
      chart: 'donut',
      labels: ['Core', 'Tools'],
      series: [{ values: [70, 30] }],
    },
  })
  const diag = shape({
    geometry: {
      type: 'diagram',
      dir: 'LR',
      nodes: [
        { id: 'a', label: 'Input', sub: 'JSON', fill: 'bg' },
        { id: 'b', label: 'Compile', fill: 'brand' },
      ],
      edges: [['a', 'b', 'plan']],
    },
  })
  const topo = shape({
    geometry: { type: 'contours', seed: 42, bands: 8, view: [300, 180] },
  })
  const seal = shape({
    geometry: {
      type: 'stamp',
      text: 'CULM · CHECKED · STATIC',
      center: '01',
      teeth: 20,
    },
  })

  for (const node of [bar, line, donut, diag, topo, seal]) {
    assert.deepEqual(validateSite(site(col(node)), reg), [])
    const svg = compileFrame(
      { node, width: 480, height: 260, look: LOOK, format: 'svg' },
      { registry: reg },
    )
    assert.equal(svg.ok, true, JSON.stringify(svg))
    if (svg.ok) {
      assert.match(svg.svg!, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
      assert.equal(svg.svg!.includes('var(--s-'), false)
    }
  }

  // Contours determinism across repeated calls
  const c1 = lowerSceneGeometry({ type: 'contours', seed: 99, bands: 6 })
  const c2 = lowerSceneGeometry({ type: 'contours', seed: 99, bands: 6 })
  assert.deepEqual(c1, c2)

  // Diagram rejects unknown edge endpoint with allowed node ids
  const badDiag = validateSite(
    site(
      col(
        shape({
          geometry: {
            type: 'diagram',
            nodes: [{ id: 'start', label: 'Start' }],
            edges: [['start', 'missing']],
          },
        }),
      ),
    ),
    reg,
  )
  assert.equal(badDiag.length, 1)
  assert.match(badDiag[0]!.message, /unknown node; allowed: start/)
})

test('radial gradients, multi-stop gradients, blur/grain filters and raw-colour mark checks', () => {
  const radialNode = shape({
    geometry: { type: 'scene', view: [200, 200] },
    blur: 2,
    grain: 0.4,
    marks: [
      {
        rect: [0, 0, 200, 200, 16],
        fill: {
          radial: [0.3, 0.3, 0.8],
          stops: [
            { color: 'accent', at: 0, alpha: 0.9 },
            { color: 'brand', at: 55 },
            { color: 'deep', at: 100 },
          ],
        },
      },
      { label: 'BAD HEX', at: [100, 100], fill: '#ff00aa' },
    ],
  })
  const doc = site(col(radialNode))
  assert.deepEqual(validateSite(doc, reg), [])

  const svg = compileFrame(
    {
      node: radialNode,
      width: 200,
      height: 200,
      look: { ...LOOK, accent: '#f59e0b' },
      format: 'svg',
      dark: true,
    },
    { registry: reg },
  )
  assert.equal(svg.ok, true)
  if (svg.ok) {
    assert.match(svg.svg!, /<radialgradient/i)
    assert.match(svg.svg!, /<fegaussianblur/i)
    assert.match(svg.svg!, /<feturbulence/i)
    assert.match(svg.svg!, /BAD HEX/)
  }

  // Document-level raw-colour finding triggers for #hex inside marks
  const findings = runChecks({
    revision: 0,
    page: 'home',
    dir: 'ltr',
    layouts: [],
    contrast: [],
    doc,
    registry: createRegistry(),
    loaded: { fonts: true, assets: true },
    problems: [],
  })
  assert.ok(
    findings.some(f => f.check === 'raw-colour' && f.nodes.includes('s')),
  )
})

test('compileFrame rejects SVG on layout containers and validates frame dimensions', () => {
  const badDims = compileFrame(
    { node: shape({ geometry: { type: 'ellipse' } }), width: 4, height: 200 },
    { registry: reg },
  )
  assert.equal(badDims.ok, false)

  const badSvg = compileFrame(
    {
      node: n({ id: 'b', kind: 'box', name: 'B', slot: {} }),
      width: 400,
      height: 300,
      format: 'svg',
    },
    { registry: reg },
  )
  assert.equal(badSvg.ok, false)
})
