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

test('pack:all packs core then tools into .pack/, and packed tools runs `culm --help` with exit 0 from a temp install', () => {
  const root = join(import.meta.dirname, '../..')
  const tmp = mkdtempSync(join(tmpdir(), 'culm-packall-'))
  try {
    run('npm', ['run', 'pack:all'], root)
    const tars = readdirSync(join(root, '.pack')).filter(f =>
      f.endsWith('.tgz'),
    )
    const core = tars.find(f => f.startsWith('culmjs-core-'))
    const tools = tars.find(f => f.startsWith('culmjs-tools-'))
    assert.ok(core && tools, `missing tarballs in .pack: ${tars.join()}`)
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}')
    run(
      'npm',
      [
        'install',
        join(root, '.pack', core),
        join(root, '.pack', tools),
        '--offline',
        '--no-audit',
        '--no-fund',
      ],
      tmp,
    )
    const out = run('npx', ['culm', '--help'], tmp)
    assert.match(out, /culm/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(join(root, '.pack'), { recursive: true, force: true })
    rmSync(join(root, 'packages/core/dist'), { recursive: true, force: true })
    rmSync(join(root, 'packages/tools/dist'), { recursive: true, force: true })
  }
})
