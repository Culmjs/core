import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../../..')
const pkg = JSON.parse(
  readFileSync(join(root, 'packages/tools/package.json'), 'utf8'),
)

test('the two dependencies are pinned to exact versions, and playwright is not one', () => {
  assert.deepEqual(pkg.dependencies, {
    '@modelcontextprotocol/sdk': '1.32.2',
    'jsonc-parser': '3.3.1',
  })
  assert.equal(pkg.devDependencies?.playwright, undefined)
  assert.equal(pkg.peerDependencies?.playwright, undefined)
})

const lint = (code: string, file = 'packages/tools/src/probe.ts') => {
  let out = ''
  try {
    out = execFileSync(
      'npx',
      ['eslint', '--stdin', '--stdin-filename', file, '--format', 'json'],
      { cwd: root, input: code, encoding: 'utf8', stdio: 'pipe' },
    )
  } catch (e) {
    out = (e as { stdout: string }).stdout
  }
  const messages: { ruleId: string | null }[] = JSON.parse(out)[0].messages
  return messages.map(m => m.ruleId)
}

test('tools src imports nothing by a relative path into another package', () => {
  assert.ok(
    lint(
      `import { x } from '../../core/src/index.ts'\nexport { x }\n`,
    ).includes('no-restricted-imports'),
  )
  const ok = lint(
    `import { readFileSync } from 'node:fs'\nimport { parse } from 'jsonc-parser'\nimport { applyOps } from '@culmjs/core/ops'\nexport { readFileSync, parse, applyOps }\n`,
  )
  assert.ok(!ok.includes('no-restricted-imports'))
})

test('the boundary also refuses ./../.. paths and dynamic imports, and allows an inner folder named core', () => {
  const bad = (code: string, file?: string) =>
    lint(code, file).some(
      r => r === 'no-restricted-imports' || r === 'no-restricted-syntax',
    )
  assert.ok(
    bad(`import { x } from './../../core/src/index.ts'\nexport { x }\n`),
  )
  assert.ok(bad(`export const m = import('../../core/src/index.ts')\n`))
  assert.ok(
    bad(
      `import { x } from '../../../core/src/index.ts'\nexport { x }\n`,
      'packages/tools/src/a/probe.ts',
    ),
  )
  assert.ok(
    !bad(
      `import { x } from '../core/helper.ts'\nexport { x }\n`,
      'packages/tools/src/a/probe.ts',
    ),
  )
  assert.ok(
    !bad(
      `import { x } from '../../core/helper.ts'\nexport { x }\n`,
      'packages/tools/src/a/b/probe.ts',
    ),
  )
})
