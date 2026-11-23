import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import * as ops from '../../src/ops/index.ts'
import type {
  Allow,
  ApplyResult,
  ChangeRequest,
  NodeRef,
  Note,
  Op,
  PlanResult,
  SiteDiff,
  SiteStore,
  TreeRef,
} from '../../src/index.ts'

test('the ops entry exports exactly the thirteen public values', () => {
  assert.deepEqual(Object.keys(ops).sort(), [
    'READ_CAP',
    'apply',
    'catalogue',
    'createdRoots',
    'diffSites',
    'memoryStore',
    'pageOutline',
    'plan',
    'readNode',
    'restore',
    'search',
    'siteOutline',
    'treeKey',
  ])
})

// Type-level: each public type is importable from the package root and usable.
export type PublicTypes = [
  Op,
  TreeRef,
  NodeRef,
  Note,
  ChangeRequest,
  PlanResult,
  ApplyResult,
  Allow,
  SiteStore,
  SiteDiff,
]

// The type-level list above cannot fail on a type that is exported and not listed. The entry's own text can.
test('the ops entry exports exactly the ten public types', () => {
  const text = readFileSync(
    new URL('../../src/ops/index.ts', import.meta.url),
    'utf8',
  )
  const names = [...text.matchAll(/export type \{([^}]*)\}/g)]
    .flatMap(m => m[1].split(','))
    .map(n => n.trim())
    .filter(Boolean)
    .sort()
  assert.deepEqual(names, [
    'Allow',
    'ApplyResult',
    'ChangeRequest',
    'NodeRef',
    'Note',
    'Op',
    'PlanResult',
    'SiteDiff',
    'SiteStore',
    'TreeRef',
  ])
  assert.equal(
    /export type \w+\s*=/.test(text),
    false,
    'no other type declaration',
  )
})
