import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { attachedGpuFolder } from '../../packages/tools/__tests__/fixtures/shader.ts'

const core = join(import.meta.dirname, '../../packages/core')
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' })
const callPublic = `import * as root from '@culmjs/core';import * as scripts from '@culmjs/core/scripts';import {publicCall} from './gpu-public-call.mjs';publicCall(root,scripts)`
test('public source GPU entry follows the fixed release loader', () => {
  run(
    'node',
    [
      '--conditions=@culmjs/source',
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      callPublic,
    ],
    import.meta.dirname,
  )
})

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
      [
        'install',
        tarball,
        '--offline',
        '--no-audit',
        '--no-fund',
        '--cache',
        join(tmp, 'cache'),
      ],
      app,
    )

    const { exports } = JSON.parse(
      readFileSync(join(core, 'package.json'), 'utf8'),
    )
    for (const key of Object.keys(exports)) {
      const spec = '@culmjs/core' + key.slice(1)
      run('node', ['-e', `await import(${JSON.stringify(spec)})`], app)
    }
    cpSync(
      join(import.meta.dirname, 'gpu-public-call.mjs'),
      join(app, 'gpu-public-call.mjs'),
    )
    run('node', ['--input-type=module', '-e', callPublic], app)

    const files = run('tar', ['-tzf', tarball], tmp).split('\n').filter(Boolean)
    assert.deepEqual(
      files.filter(
        f => f.includes('/src/') || (f.endsWith('.ts') && !f.endsWith('.d.ts')),
      ),
      [],
    )
    assert.ok(files.includes('package/LICENSE'), 'missing LICENSE')
    assert.ok(files.includes('package/README.md'), 'missing README.md')
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
    // a stale dist would satisfy a run that forgot --conditions=@culmjs/source
    rmSync(join(core, 'dist'), { recursive: true, force: true, maxRetries: 3 })
  }
})

test('pack:all installs core, starter and tools; packed CLI initializes a project and builds the GPU delivery files', async () => {
  const root = join(import.meta.dirname, '../..')
  const tmp = mkdtempSync(join(tmpdir(), 'culm-packall-'))
  const packDir = join(tmp, 'pack')
  const app = join(tmp, 'app')
  mkdirSync(packDir)
  mkdirSync(app)
  try {
    for (const ws of ['packages/core', 'packages/starter', 'packages/tools'])
      run(
        'npm',
        ['pack', '--workspace=' + ws, '--pack-destination', packDir],
        root,
      )
    const tars = readdirSync(packDir).filter(f => f.endsWith('.tgz'))
    const core = tars.find(f => f.startsWith('culmjs-core-'))
    const tools = tars.find(f => f.startsWith('culmjs-tools-'))
    const starter = tars.find(f => f.startsWith('culmjs-starter-'))
    assert.ok(
      core && starter && tools,
      `missing tarballs in packDir: ${tars.join()}`,
    )
    for (const tar of [core, starter, tools]) {
      const files = run('tar', ['-tzf', join(packDir, tar)], tmp)
        .split('\n')
        .filter(Boolean)
      assert.ok(files.includes('package/LICENSE'), `${tar} missing LICENSE`)
      assert.ok(files.includes('package/README.md'), `${tar} missing README.md`)
    }
    writeFileSync(join(app, 'package.json'), '{"type":"module"}')
    run(
      'npm',
      [
        'install',
        join(packDir, core),
        join(packDir, starter),
        join(packDir, tools),
        '--prefer-offline',
        '--no-audit',
        '--no-fund',
        '--cache',
        join(tmp, 'cache'),
      ],
      app,
    )
    run(
      'node',
      [
        '-e',
        "await import('@culmjs/core'); await import('@culmjs/starter'); await import('@culmjs/tools')",
      ],
      app,
    )
    const out = run('npx', ['culm', '--help'], app)
    assert.match(out, /culm/)
    const made = run('npx', ['culm', 'init', 'my-site', '--from', packDir], app)
    assert.match(made, /Wrote/)
    const pkg = JSON.parse(
      readFileSync(join(app, 'my-site/package.json'), 'utf8'),
    )
    assert.match(
      pkg.dependencies['@culmjs/starter'],
      /^file:.*culmjs-starter-.*\.tgz$/,
    )
    for (const f of [
      'culm.json',
      'site.json',
      'pages/home.json',
      'culm.schema.json',
      '.gitignore',
    ])
      readFileSync(join(app, 'my-site', f))
    const fixture = join(tmp, 'gpu')
    cpSync(
      join(root, 'packages/tools/__tests__/fixtures/site-basic'),
      fixture,
      { recursive: true },
    )
    await attachedGpuFolder(fixture)
    run(
      'node',
      [join(app, 'node_modules/@culmjs/tools/bin/culm.js'), 'build'],
      fixture,
    )
    const dist = join(fixture, 'dist')
    const host = readFileSync(join(dist, '_culm/gpu.js'))
    const hash = `sha256-${createHash('sha256').update(host).digest('base64')}`
    assert.ok(readFileSync(join(dist, 'index.html'), 'utf8').includes(hash))
    assert.ok(
      readFileSync(join(dist, '_headers'), 'utf8').includes(`'${hash}'`),
    )
    const m = JSON.parse(readFileSync(join(dist, 'culm-manifest.json'), 'utf8'))
    assert.deepEqual(
      m.scripts.find((s: { name: string }) => s.name === 'gpuHost'),
      { name: 'gpuHost', bytes: host.length, pages: ['home'] },
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
    for (const pkg of ['core', 'starter', 'tools'])
      rmSync(join(root, 'packages', pkg, 'dist'), {
        recursive: true,
        force: true,
        maxRetries: 3,
      })
  }
})
