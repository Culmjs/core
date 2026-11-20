import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const core = join(import.meta.dirname, '../../packages/core')
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' })

test('packed core installs offline and every sub-path imports', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'culm-pack-'))
  try {
    const app = join(tmp, 'app')
    mkdirSync(app)
    run('npm', ['pack', '--pack-destination', tmp], core)
    const name = readdirSync(tmp).find(f => f.endsWith('.tgz'))
    assert.ok(name, 'npm pack produced no tarball')
    const tarball = join(tmp, name)
    writeFileSync(join(app, 'package.json'), '{"type":"module"}')
    run(
      'npm',
      ['install', tarball, '--offline', '--no-audit', '--no-fund'],
      app,
    )

    const { exports } = JSON.parse(
      readFileSync(join(core, 'package.json'), 'utf8'),
    )
    for (const key of Object.keys(exports)) {
      const spec = '@culmjs/core' + key.slice(1)
      run('node', ['-e', `await import(${JSON.stringify(spec)})`], app)
    }

    const files = run('tar', ['-tzf', tarball], tmp).split('\n').filter(Boolean)
    assert.deepEqual(
      files.filter(
        f => f.includes('/src/') || (f.endsWith('.ts') && !f.endsWith('.d.ts')),
      ),
      [],
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    // a stale dist would satisfy a run that forgot --conditions=source
    rmSync(join(core, 'dist'), { recursive: true, force: true })
  }
})
