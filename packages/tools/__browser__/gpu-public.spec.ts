import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { compilePage, createRegistry, GPU_HOST_INTEGRITY } from '@culmjs/core'
import { node, siteWith, text } from '../../core/__tests__/kit.ts'
import { openBrowser } from '../src/measure/browser.ts'

test('source and installed tarball public calls start one real trusted release asset under page CSP', async t => {
  const root = resolve(import.meta.dirname, '../../..')
  const tmp = await mkdtemp(join(tmpdir(), 'culm-public-'))
  t.after(() => rm(tmp, { recursive: true, force: true }))
  // Isolate prepack output from other tests and any developer build in dist/.
  const copy = join(tmp, 'repo/packages/core'),
    app = join(tmp, 'consumer')
  await mkdir(copy, { recursive: true })
  await mkdir(app)
  await symlink(
    join(root, 'node_modules'),
    join(tmp, 'repo/node_modules'),
    'dir',
  )
  await cp(join(root, 'tsconfig.json'), join(tmp, 'repo/tsconfig.json'))
  for (const file of ['src', 'package.json', 'tsconfig.build.json'])
    await cp(join(root, 'packages/core', file), join(copy, file), {
      recursive: true,
    })
  const tar = execFileSync(
    'npm',
    ['pack', '--pack-destination', app, '--silent'],
    { cwd: copy, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .at(-1)!
  execFileSync(
    'npm',
    ['install', '--offline', '--no-audit', '--no-fund', join(app, tar)],
    { cwd: app, stdio: 'pipe' },
  )
  const c = compilePage(
    siteWith([
      {
        ...node('hero', 'box', [text('caption', 'Field notes')]),
        style: { base: { height: { n: 160, unit: 'px' }, bg: '#999999' } },
        motion: { gpu: 'contours', trigger: 'enter-view' },
      },
    ]),
    'home',
    { registry: createRegistry({ gpu: { enabled: true } }) },
  )
  assert.ok(c.ok)
  let requests = 0
  const server = createServer((req, res) => {
    if (req.url === '/_culm/gpu.js') {
      requests++
      res.setHeader('content-type', 'text/javascript').end(c.assets![0].content)
    } else if (req.url === '/scene')
      res
        .setHeader('content-type', 'text/html')
        .end(c.html.replace(/<script>[^]*?<\/script>/g, ''))
    else res.setHeader('content-type', 'text/html').end('<main>Plain</main>')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise<void>(r => server.close(() => r())))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const b = await openBrowser()
  assert.ok(b.ok)
  t.after(() => b.browser.close())
  for (const [resolveDir, conditions] of [
    [root, ['source']],
    [app, []],
  ] as const) {
    const code = (
      await build({
        stdin: {
          resolveDir,
          contents: `import {hostGpu} from '@culmjs/core';import {hostGpu as boot} from '@culmjs/core/scripts';hostGpu(document,window);boot(document,window)`,
        },
        conditions: [...conditions],
        bundle: true,
        write: false,
        format: 'iife',
      })
    ).outputFiles[0].text
    const p = await b.browser.newPage()
    try {
      requests = 0
      await p.unblock()
      await p.setViewport(320, 400)
      await p.setReducedMotion(true)
      assert.ok((await p.goto(origin, 10000)).ok)
      await p.evaluate(code)
      assert.ok((await p.goto(origin + '/scene', 10000)).ok)
      await p.evaluate(code)
      assert.equal(requests, 0)
      await p.setReducedMotion(false)
      assert.ok(
        await p.evaluate(
          `(async()=>{for(let i=0;i<200;i++){if(document.querySelector('[data-gpu-painted]'))return true;await new Promise(r=>setTimeout(r,10))}return false})()`,
        ),
      )
      await p.evaluate(code)
      assert.deepEqual(
        await p.evaluate(
          `[document.querySelectorAll('canvas').length,document.querySelector('script[src]').integrity]`,
        ),
        [1, GPU_HOST_INTEGRITY],
      )
      assert.equal(requests, 1)
      assert.deepEqual(p.errors, [])
    } finally {
      await p.close()
    }
  }
})
