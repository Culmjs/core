import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node } from '../../src/document/index.ts'
import { buildReport, compareReports } from '../../src/measure/report.ts'
import { findingKey } from '../../src/measure/checks.ts'
import type { Cell, Finding, Report } from '../../src/measure/types.ts'
import { node, siteWith } from '../kit.ts'

const cell = (width = 1280): Cell => ({
  page: 'home',
  width,
  theme: 'light',
  dir: 'ltr',
})
const finding = (
  nodes: string[],
  width = 1280,
  check = 'overflow',
): Finding => {
  const f = {
    ...cell(width),
    check,
    class: 2 as const,
    revision: 1,
    nodes,
    state: 'default' as const,
    fonts: true,
    assets: true,
    observed: 5,
    expected: 'x',
    message: 'm',
    key: '',
  }
  return { ...f, key: findingKey(f) }
}
const report = (
  findings: Finding[],
  measured: Cell[] = [cell(1280), cell(390)],
  incomplete: Report['incomplete'] = [],
): Report => ({
  revision: 1,
  build: 'b',
  profile: 1,
  browser: 'c',
  findings,
  measured,
  incomplete,
  blocked: [],
  skipped: [],
})
const doc = (children: Node[]) => siteWith(children)
const status = (before: Report, after: Report, d = doc([node('a', 'box')])) =>
  compareReports(before, after, d).was[0].status

test('a finding whose page, width, theme or direction is absent from `after` is unchecked', () => {
  const f = finding(['a'])
  assert.equal(status(report([f]), report([], [cell(390)])), 'unchecked')
  assert.equal(
    status(report([f]), report([], [{ ...cell(), theme: 'dark' }])),
    'unchecked',
  )
  assert.equal(
    status(report([f]), report([], [{ ...cell(), dir: 'rtl' }])),
    'unchecked',
  )
  assert.equal(
    status(report([f]), report([], [{ ...cell(), page: 'other' }])),
    'unchecked',
  )
})

test('a finding whose cell is incomplete in `after` is unchecked', () => {
  const f = finding(['a'])
  const problem = { code: 'MEASUREMENT_INCOMPLETE' as const, message: 'm' }
  assert.equal(
    status(report([f]), report([], undefined, [{ page: 'home', problem }])),
    'unchecked',
  )
  assert.equal(
    status(
      report([f]),
      report([], undefined, [{ page: 'home', width: 1280, problem }]),
    ),
    'unchecked',
  )
  assert.equal(
    status(
      report([f]),
      report([], undefined, [{ page: 'home', width: 390, problem }]),
    ),
    'fixed',
  )
})

test('a finding whose node was removed is unobservable, never fixed', () => {
  const r = compareReports(
    report([finding(['gone'])]),
    report([]),
    doc([node('a', 'box')]),
  )
  assert.equal(r.was[0].status, 'unobservable')
  // several nodes: unobservable only when none is left to observe
  assert.equal(status(report([finding(['gone', 'a'])]), report([])), 'fixed')
  assert.equal(
    status(report([finding(['gone', 'gone2'])]), report([])),
    'unobservable',
  )
})

test('a finding whose node is hidden at that width is unobservable', () => {
  const hidden = { ...node('a', 'box'), hide: { phone: true as const } }
  const d = doc([hidden])
  const after = report([])
  assert.equal(status(report([finding(['a'], 390)]), after, d), 'unobservable')
  assert.equal(status(report([finding(['a'], 1280)]), after, d), 'fixed')
  // hidden through an ancestor, and through a style layer
  const parent = {
    ...node('p', 'column', [node('a', 'box')]),
    style: { phone: { hidden: true } },
  } as Node
  assert.equal(
    status(report([finding(['a'], 390)]), after, doc([parent])),
    'unobservable',
  )
})

test('a finding with the same key in `after` is present', () => {
  const f = finding(['a'])
  assert.equal(status(report([f]), report([{ ...f }])), 'present')
})

test('otherwise it is fixed', () => {
  assert.equal(status(report([finding(['a'])]), report([])), 'fixed')
})

test('findings of `after` with no matching key in `before` are added', () => {
  const old = finding(['a'])
  const fresh = finding(['a'], 1280, 'overlap')
  const r = compareReports(
    report([old]),
    report([old, fresh]),
    doc([node('a', 'box')]),
  )
  assert.deepEqual(r.added, [fresh])
  assert.equal(r.was[0].status, 'present')
})

test('buildReport records the identity, the profile version, the browser build, and MEASUREMENT_INCOMPLETE for a page that did not load', () => {
  const problem = {
    code: 'MEASUREMENT_INCOMPLETE' as const,
    message: 'no load',
  }
  const f = finding(['a'])
  const r = buildReport(
    7,
    'sha',
    {
      version: 1,
      widths: [1280],
      themes: ['light'],
      directions: ['ltr'],
      browser: 'Chrome/1',
    },
    [
      {
        page: 'home',
        findings: [f],
        measured: [cell()],
        incomplete: [],
        blocked: ['http://x'],
        skipped: [],
      },
      {
        page: 'about',
        findings: [],
        measured: [],
        incomplete: [{ page: 'about', problem }],
        blocked: [],
        skipped: ['state:tab=second'],
      },
    ],
  )
  assert.equal(r.revision, 7)
  assert.equal(r.build, 'sha')
  assert.equal(r.profile, 1)
  assert.equal(r.browser, 'Chrome/1')
  assert.deepEqual(r.findings, [f])
  assert.deepEqual(r.measured, [cell()])
  assert.equal(r.incomplete[0].problem.code, 'MEASUREMENT_INCOMPLETE')
  assert.deepEqual(r.blocked, ['http://x'])
  assert.deepEqual(r.skipped, ['state:tab=second'])
})

test('a header node finding present in `after` is present; a node-less finding follows its key', () => {
  const d = doc([node('a', 'box')])
  d.header = { ...d.header, children: [node('hd', 'box')] }
  const h = finding(['hd'])
  assert.equal(status(report([h]), report([{ ...h }]), d), 'present')
  const s = finding([], 1280, 'h-scroll')
  assert.equal(status(report([s]), report([{ ...s }])), 'present')
  assert.equal(status(report([s]), report([])), 'fixed')
})
