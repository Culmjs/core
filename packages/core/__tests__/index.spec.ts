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
  'FRAMEWORK_VERSION',
  'KINDS',
  'LOOK_FAMILIES',
  'MAX_DEPTH',
  'MAX_NODES',
  'MigrationError',
  'OPEN_SCRIPT',
  'READ_CAP',
  'SCHEMA_VERSION',
  'STATES_SCRIPT',
  'apply',
  'applySetting',
  'buildIdentity',
  'catalogue',
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
  'diffSites',
  'emptySite',
  'escapeHtml',
  'expand',
  'find',
  'hostStates',
  'insert',
  'insertBlock',
  'kindSpec',
  'memoryStore',
  'migrate',
  'move',
  'pageOutline',
  'parentOf',
  'plan',
  'previewMigration',
  'readNode',
  'readSettings',
  'remove',
  'replace',
  'restore',
  'rowsOf',
  'search',
  'siteOutline',
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
    'add',
    'setText',
    'nextIds',
    'paged',
    'canonicalJson',
    'sha256',
    'hiddenBy',
    'OPERATIONS',
    'OP_NAMES',
    'diffAll',
    'why',
    'lostRequired',
    'MAX_OPS',
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

test('the stage 1 names remove, move, insert and insertBlock are still the stage 1 functions', () => {
  assert.equal(core.insertBlock.length, 4)
  assert.equal(core.remove.length, 2)
})
