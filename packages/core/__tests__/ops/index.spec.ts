import assert from 'node:assert/strict'
import { test } from 'node:test'
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

test('the ops entry exports exactly the eleven public values', () => {
  assert.deepEqual(Object.keys(ops).sort(), [
    'READ_CAP',
    'apply',
    'catalogue',
    'diffSites',
    'memoryStore',
    'pageOutline',
    'plan',
    'readNode',
    'restore',
    'search',
    'siteOutline',
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
