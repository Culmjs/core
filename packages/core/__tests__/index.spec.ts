import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as core from '../src/index.ts'

// The compatibility promise: a new public name is a decision, so it must be added here on purpose.
const PUBLIC_NAMES = [
  'API_VERSION',
  'BASE_SCRIPT',
  'BUDGETS',
  'CODES',
  'EMAIL_SCRIPT',
  'FONTS',
  'KINDS',
  'LOOK_FAMILIES',
  'MAX_DEPTH',
  'MAX_NODES',
  'MigrationError',
  'OPEN_SCRIPT',
  'SCHEMA_VERSION',
  'STATES_SCRIPT',
  'applySetting',
  'checkBudgets',
  'checkDeclaration',
  'checkLook',
  'checkRows',
  'checkSiteStyles',
  'compilePage',
  'compileSite',
  'compileSubtree',
  'count',
  'createRegistry',
  'defaultSiteStyles',
  'emptySite',
  'escapeHtml',
  'expand',
  'find',
  'hostStates',
  'insert',
  'insertBlock',
  'kindSpec',
  'migrate',
  'move',
  'parentOf',
  'previewMigration',
  'readSettings',
  'remove',
  'replace',
  'rowsOf',
  'validateSite',
  'walk',
  'writeHtml',
]

test('the package entry exports exactly the public names', () => {
  assert.deepEqual(Object.keys(core).sort(), PUBLIC_NAMES)
})

test('internal helpers are not reachable from the entry', () => {
  for (const n of [
    'cyclicComponents',
    'unrollInstances',
    'paths',
    'overrideProblem',
    'stateAttrs',
    'triggerTargets',
    'linkProps',
    'mailParts',
    'toElements',
    'compileStyles',
    'urlOk',
    'isObj',
  ])
    assert.equal(n in core, false, n)
})

test('the entry compiles a site made only from what it exports', () => {
  const look = {
    id: 'plain',
    name: 'Plain',
    family: 'Minimal',
    brand: '#2255aa',
    ink: '#111111',
    bg: '#ffffff',
    headingFont: 'sys:serif' as const,
    bodyFont: 'sys:sans' as const,
    corners: 4,
    dark: 'auto' as const,
  }
  const doc = core.emptySite('Ada', look)
  const r = core.compilePage(doc, 'home', { registry: core.createRegistry() })
  assert.ok(r.ok)
  assert.deepEqual(r.problems, [])
})
