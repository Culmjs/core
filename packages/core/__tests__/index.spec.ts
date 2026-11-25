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
  'GPU_HOST_INTEGRITY',
  'GPU_HOST_PATH',
  'GPU_HOST_SCRIPT',
  'GPU_LOADER_SCRIPT',
  'ICON_LICENCES',
  'ICON_NAME_RE',
  'KINDS',
  'LOOK_FAMILIES',
  'MAX_DEPTH',
  'MAX_NODES',
  'MEASURE_PROFILE',
  'MigrationError',
  'OPEN_SCRIPT',
  'PROBE_SCRIPT',
  'READ_CAP',
  'SCHEMA_VERSION',
  'SHADER_LIMITS',
  'STATES_SCRIPT',
  'THRESHOLDS',
  'TIMELINE_SCRIPT',
  'apply',
  'applySetting',
  'buildIdentity',
  'buildReport',
  'catalogue',
  'checkBudgets',
  'checkDeclaration',
  'checkLook',
  'checkRows',
  'checkShader',
  'checkSiteFont',
  'checkSiteStyles',
  'compareReports',
  'compilePage',
  'compileSite',
  'compileSubtree',
  'count',
  'createRegistry',
  'createdRoots',
  'defaultSiteStyles',
  'diffSites',
  'emptySite',
  'escapeHtml',
  'expand',
  'find',
  'findingKey',
  'fontSlug',
  'hostGpu',
  'hostMotion',
  'hostStates',
  'insert',
  'insertBlock',
  'isAsInserted',
  'isRequired',
  'kindSpec',
  'lowerMotion',
  'memoryStore',
  'migrate',
  'move',
  'pageOutline',
  'pageScriptPolicy',
  'parentOf',
  'plan',
  'policyMeta',
  'previewMigration',
  'readNode',
  'readSettings',
  'remove',
  'replace',
  'restore',
  'rowsOf',
  'runChecks',
  'search',
  'siteIcon',
  'siteOutline',
  'textRangeFor',
  'treeKey',
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
    'measureNodes',
    'outlineOf',
    'WIDTH_OF',
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
  assert.equal(core.insert.length, 4)
  assert.equal(core.move.length, 5)
  // and they still take a tree and give a tree, not an operation result
  const leaf = (id: string) => ({ id, kind: 'box', name: id, slot: {} })
  const root = { ...leaf('r'), children: [leaf('a'), leaf('b')] } as never
  const ids = (n: { children?: { id: string }[] }) =>
    (n.children ?? []).map(c => c.id)
  const moved = core.move(root, 'b', 'r', 0)
  assert.deepEqual(ids(moved), ['b', 'a'])
  const inserted = core.insert(root, 'r', 1, leaf('x') as never)
  assert.deepEqual(ids(inserted), ['a', 'x', 'b'])
  const removed = core.remove(root, 'a')
  assert.deepEqual(ids(removed), ['b'])
  for (const t of [moved, inserted, removed]) assert.equal('ok' in t, false)
  assert.deepEqual(ids(root), ['a', 'b'])
})
