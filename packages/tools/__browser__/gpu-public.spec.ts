import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import {
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { compileSite, createRegistry, GPU_HOST_INTEGRITY } from '@culmjs/core'
import { node, siteWith, text } from '../../core/__tests__/kit.ts'
import { openBrowser } from '../src/measure/browser.ts'

test('source and installed defaults deploy the same SRI host: contours and limited custom paint together under CSP', async t => {
  const root = resolve(import.meta.dirname, '../../..')
  const tmp = await mkdtemp(join(tmpdir(), 'culm-public-'))
  t.after(() => rm(tmp, { recursive: true, force: true }))
  // Isolate prepack output from other tests and any developer build in dist/.
  const copy = join(tmp, 'repo/packages/core'),
    app = join(tmp, 'consumer')
  await mkdir(copy, { recursive: true })
  await mkdir(app)
  await writeFile(join(app, 'package.json'), '{"private":true,"type":"module"}')
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
    [
      'install',
      '--prefix',
      app,
      '--offline',
      '--no-audit',
      '--no-fund',
      join(app, tar),
    ],
    { cwd: app, stdio: 'pipe' },
  )
  const installed = join(app, 'node_modules/@culmjs/core')
  assert.equal(
    await realpath(installed),
    join(await realpath(app), 'node_modules/@culmjs/core'),
  )
  const doc = siteWith(
    ['contours', 'red'].map((gpu, i) => ({
      ...node('hero' + i, 'box', [text('caption' + i, 'Field notes')]),
      style: {
        base: { height: { n: 160, unit: 'px' }, bg: i ? '#383838' : '#123456' },
      },
      motion: { gpu, trigger: 'enter-view' },
    })),
    {
      customEffects: [
        {
          name: 'red',
          source: 'vec4 shade(vec2 uv){return vec4(1,0,0,1);}',
          settings: {},
        },
      ],
    },
  )
  const site = compileSite(doc, {
    registry: createRegistry({ gpu: { enabled: true } }),
  })
  assert.deepEqual(site.problems, [])
  const packed = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
    import {compileSite,createRegistry} from '@culmjs/core';import {readFileSync} from 'node:fs';
    console.log(JSON.stringify(compileSite(JSON.parse(readFileSync(0,'utf8')), {registry:createRegistry({gpu:{enabled:true}})})))
  `,
      ],
      { cwd: app, input: JSON.stringify(doc), encoding: 'utf8' },
    ),
  )
  assert.deepEqual(packed.files, site.files)
  const emitted = (path: string) =>
    site.files.find(f => f.path === path)!.content
  const policy = emitted('_headers')
    .split('Content-Security-Policy: ')[1]
    .trim()
  assert.ok(policy.includes(`'${GPU_HOST_INTEGRITY}'`))
  let requests = 0
  const server = createServer((req, res) => {
    if (req.url === '/_culm/gpu.js') {
      requests++
      res
        .setHeader('content-type', 'text/javascript')
        .end(emitted('_culm/gpu.js'))
    } else if (req.url === '/scene')
      res
        .setHeader('content-type', 'text/html')
        .setHeader('content-security-policy', policy)
        .end(emitted('index.html').replace(/<script>[^]*?<\/script>/g, ''))
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
          `(async()=>{for(let i=0;i<200;i++){if(document.querySelectorAll('[data-gpu-painted]').length===2)return true;await new Promise(r=>setTimeout(r,10))}return false})()`,
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
      // Sample composited pixels in the two exposed backgrounds. The reviewed
      // builtin is immediately greyscale; red must move away from its grey
      // seed without presenting the unrestricted red target.
      await p.evaluate('new Promise(r=>setTimeout(r,180))')
      const png = Buffer.from(await p.screenshot()).toString('base64')
      const [builtin, custom] = await p.evaluate<number[][]>(`(async()=>{
        const img=await createImageBitmap(new Blob([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))]));
        const ctx=new OffscreenCanvas(img.width,img.height).getContext('2d');ctx.drawImage(img,0,0);
        return [120,280].map(y=>Array.from(ctx.getImageData(80,y,1,1).data))
      })()`)
      assert.deepEqual(builtin, [builtin[0], builtin[0], builtin[0], 255])
      assert.ok(builtin[0] >= 100 && builtin[0] <= 205)
      assert.ok(custom[0] > 56 && custom[0] < 255 && custom[1] < 56)
      assert.deepEqual(custom.slice(2), [custom[1], 255])
      assert.deepEqual(p.errors, [])
    } finally {
      await p.close()
    }
  }
})
