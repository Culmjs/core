// Offline once the benchmark-only Astro and Playwright packages have been installed.
// Run from the repo root with: node --conditions=source --import tsx scripts/benchmark-astro-speed.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { cpus, platform, release as osRelease } from 'node:os'
import { join, resolve } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'
import * as release from '@culmjs/core'
import { transformSync } from 'esbuild'
import { node, siteWith, text } from '../packages/core/__tests__/kit.ts'
import { scenes } from '../packages/tools/__tests__/fixtures/motion-scenes.ts'
import { contours } from '../packages/core/src/registry/gpuBuiltins.ts'
import { candidateCompiler } from './gpu-flash/compiler.ts'

const root = resolve('.superpowers/astro-speed')
const require = createRequire(join(root, 'package.json'))
const { chromium } = require('playwright-core')
const variants = {}
const astroInputs = {}
const profiles = {
  local: { width: 1280, height: 800, cpu: 1, latency: 0 },
  mobile: {
    width: 392,
    height: 800,
    cpu: 4,
    latency: 150,
    downKbps: 1600,
    upKbps: 750,
  },
}
const count = Number(process.env.BENCH_ROUNDS || 9)
const observationMs = Number(process.env.BENCH_WINDOW_MS || 2400)
const output = process.env.BENCH_OUTPUT || join(root, 'results.json')
const candidate = await candidateCompiler()
const custom = {
  name: 'survey_contours',
  source: contours.source,
  settings: contours.settings,
}
const poster =
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#999"/><path d="M0 24Q36 12 96 48M0 62Q44 54 96 76" fill="none" stroke="#9c9c9c"/></svg>'
const brotli = data =>
  brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
const size = data => Buffer.byteLength(data)
const assets = (html, js = '') => ({
  '/': html,
  ...(js ? { '/_culm/gpu.js': js } : {}),
})

const hero = () => ({
  ...node('hero', 'box', [
    text('heading', '', {
      props: { level: 'h1', runs: [{ text: 'Reading the tide' }] },
    }),
    text('caption', 'An illustrated field survey of the riverbank.'),
  ]),
  style: { base: { bg: '#999999', height: { n: 320, unit: 'px' } } },
})
const plainDoc = siteWith([
  hero(),
  text(
    'note',
    'The river marks change slowly. Return tomorrow for the next observation.',
  ),
  {
    ...node('disclosure', 'details', [
      text('inside', 'Observations recorded at low tide.'),
    ]),
    props: { summary: 'About these notes' },
  },
])
const mixedDoc = await scenes.mixed()
mixedDoc.pages[0].root.children.unshift(hero())
for (const [name, core, fixture, effect] of [
  ['culm-static', release, plainDoc, null],
  ['culm-trusted', release, plainDoc, 'contours'],
  ['culm-checked', candidate, plainDoc, custom.name],
  ['culm-mixed-trusted', release, mixedDoc, 'contours'],
  ['culm-mixed-checked', candidate, mixedDoc, custom.name],
  ['culm-trusted-poster', release, plainDoc, 'contours'],
  ['culm-checked-poster', candidate, plainDoc, custom.name],
]) {
  const doc = structuredClone(fixture)
  if (effect) {
    doc.pages[0].root.children[0].motion = {
      gpu: effect,
      trigger: 'enter-view',
      settings: { speed: 0.25 },
    }
    if (name.endsWith('-poster'))
      doc.pages[0].root.children[0].motion.poster = 'survey.svg'
    if (effect === custom.name) doc.customEffects = [custom]
  }
  const compiled = core.compilePage(doc, 'home', {
    registry: core.createRegistry({ gpu: { enabled: true } }),
    links: { page: s => s, file: id => `/assets/${id}` },
    availableMedia: new Set(['/assets/survey.svg']),
  })
  assert.ok(compiled.ok, JSON.stringify(compiled.problems))
  assert.ok(
    compiled.problems.every(
      p =>
        effect === custom.name &&
        ['gpuHostScript', 'sharedScripts'].includes(p.path),
    ),
    JSON.stringify(compiled.problems),
  )
  variants[name] = assets(compiled.html, compiled.assets?.[0]?.content)
  if (name.endsWith('-poster')) variants[name]['/assets/survey.svg'] = poster
}

// A separate authored baseline: same trusted slow-moving contour math but just one
// known hero, no arbitrary shader input, limiter, history, or Culm host. No hydration.
// Use the same initial quarter resolution, viewport, speed and 60-fast/8-slow windows.
const astroNativeJs = transformSync(
  `
const el=document.querySelector('main h1').parentElement;
if(!matchMedia('(prefers-reduced-motion:reduce)').matches&&!navigator.connection?.saveData)
new IntersectionObserver((entries,io)=>{if(!entries.some(e=>e.isIntersecting))return;io.disconnect();start()},{rootMargin:'200px'}).observe(el)
function start(){
 const canvas=document.createElement('canvas'),main=document.querySelector('main');
 canvas.ariaHidden='true';canvas.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:-1;image-rendering:pixelated';canvas.hidden=true;
 const gl=canvas.getContext('webgl2',{antialias:false,depth:false});if(!gl)return;
 const prog=gl.createProgram();
 for(const [type,src] of [[gl.VERTEX_SHADER,'void main(){gl_Position=vec4(vec2((gl_VertexID<<1)&2,gl_VertexID&2)*2.-1.,0.,1.);}'],[gl.FRAGMENT_SHADER,${JSON.stringify('precision highp float;uniform vec4 r;uniform float u_time,u_set_speed;out vec4 c;' + contours.source + '\nvoid main(){c=shade((gl_FragCoord.xy-r.xy)/r.zw);}')}]]){const s=gl.createShader(type);gl.shaderSource(s,'#version 300 es\\n'+src);gl.compileShader(s);gl.attachShader(prog,s);gl.deleteShader(s)}
 gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))return;gl.useProgram(prog);gl.enable(gl.SCISSOR_TEST);
 const u=k=>gl.getUniformLocation(prog,k),r=u('r'),t=u('u_time');gl.uniform1f(u('u_set_speed'),.25);
 main.style.isolation='isolate';main.prepend(canvas);let scale=.25,fast=0,slow=0,last=0,elapsed=0;
 function frame(now){const dt=last?now-last:0;last=now;elapsed+=Math.min(dt,33)/1000;
 if(dt){fast=dt<=16.7?fast+1:0;slow=dt>25?slow+1:0;if(fast===60){scale=Math.min(1,scale*2);fast=0}if(slow===8){if(scale===.25){canvas.hidden=true;el.style.backgroundColor='';el.removeAttribute('data-gpu-painted');return}scale/=2;slow=0}}
 const W=document.documentElement.clientWidth,H=document.documentElement.clientHeight,ratio=Math.min(Math.min(devicePixelRatio,2)*scale,2048/Math.max(W,H),Math.sqrt(1048576/(W*H)));
 const w=Math.floor(W*ratio),h=Math.floor(H*ratio);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
 const b=el.getBoundingClientRect(),rect=[Math.ceil(b.left*w/W),Math.ceil((H-b.bottom)*h/H),Math.floor(b.width*w/W),Math.floor(b.height*h/H)];
 gl.viewport(0,0,w,h);gl.scissor(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT);gl.scissor(...rect);gl.uniform4fv(r,rect);gl.uniform1f(t,elapsed);gl.drawArrays(gl.TRIANGLES,0,3);gl.finish();
 canvas.hidden=false;el.style.backgroundColor='transparent';if(!el.hasAttribute('data-gpu-painted'))el.setAttribute('data-gpu-painted','');requestAnimationFrame(frame)}
 requestAnimationFrame(frame)
}`,
  { target: 'es2017', minify: true },
).code.trim()
const split = s => ({
  head: s.match(/<head>([\s\S]*?)<\/head>/)[1],
  body: s.match(/<body>([\s\S]*?)<\/body>/)[1],
  htmlAttrs: s.match(/<html([^>]*)>/)[1],
})
const plain = split(variants['culm-static']['/'])
for (const name of ['astro-static', 'astro-native']) {
  const head = plain.head.replace(
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    '',
  )
  const body = plain.body.replace(/<script>[\s\S]*?<\/script>/g, '')
  assert.ok(!body.includes('<script'))
  astroInputs[name] = {
    head,
    body:
      body +
      (name === 'astro-native'
        ? `<script defer src="/contours.js"></script>`
        : ''),
    htmlAttrs: plain.htmlAttrs,
  }
}
for (const [name, original] of [
  ['astro-checked', 'culm-checked'],
  ['astro-mixed-checked', 'culm-mixed-checked'],
])
  astroInputs[name] = split(variants[original]['/'])
await mkdir(join(root, 'src/pages'), { recursive: true })
await mkdir(join(root, 'public/_culm'), { recursive: true })
await writeFile(join(root, 'public/contours.js'), astroNativeJs)
await writeFile(
  join(root, 'public/_culm/gpu.js'),
  variants['culm-checked']['/_culm/gpu.js'],
)
await writeFile(join(root, 'pages.json'), JSON.stringify(astroInputs))
await writeFile(
  join(root, 'src/pages/[bench].astro'),
  `---
import routes from '../../pages.json';
export function getStaticPaths(){return Object.entries(routes).map(([bench,data])=>({params:{bench},props:{data}}))}
const {data} = Astro.props;
---
<!doctype html><html lang="en"><head><Fragment set:html={data.head}/></head><body><Fragment set:html={data.body}/></body></html>`,
)
execFileSync(
  process.execPath,
  [
    require
      .resolve('astro/package.json')
      .replace(/package\.json$/, 'bin/astro.mjs'),
    'build',
  ],
  {
    cwd: root,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: 'pipe',
  },
)
for (const name of Object.keys(astroInputs)) {
  const html = await readFile(join(root, 'dist', name, 'index.html'), 'utf8')
  const body = split(html).body.trim()
  assert.equal(
    body,
    astroInputs[name].body.trim(),
    `Astro changed ${name}'s body`,
  )
  variants[name] = assets(
    html,
    name.includes('checked')
      ? await readFile(join(root, 'dist/_culm/gpu.js'), 'utf8')
      : '',
  )
  if (name === 'astro-native')
    variants[name]['/contours.js'] = await readFile(
      join(root, 'dist/contours.js'),
      'utf8',
    )
}

const servers = {},
  origins = {},
  bytes = {}
let browser
try {
  for (const [name, files] of Object.entries(variants)) {
    const compressed = Object.fromEntries(
      Object.entries(files).map(([path, str]) => [path, brotli(str)]),
    )
    const inline = [
      ...files['/'].matchAll(/<script>([\s\S]*?)<\/script>/g),
    ].map(m => m[1])
    bytes[name] = {
      rawHtml: size(files['/']),
      rawJs:
        inline.reduce((n, s) => n + size(s), 0) +
        Object.entries(files)
          .filter(([k]) => k.endsWith('.js'))
          .reduce((n, [, s]) => n + size(s), 0),
      brHtml: compressed['/'].length,
      brExternal: Object.entries(compressed)
        .filter(([k]) => k !== '/')
        .reduce((n, [, b]) => n + b.length, 0),
    }
    const server = createServer((req, res) => {
      const path = req.url.split('?')[0]
      if (!Object.hasOwn(compressed, path))
        return res.writeHead(path === '/favicon.ico' ? 204 : 404).end()
      const b = compressed[path]
      res
        .writeHead(200, {
          'Content-Type':
            path === '/'
              ? 'text/html; charset=utf-8'
              : path.endsWith('.svg')
                ? 'image/svg+xml'
                : 'text/javascript',
          'Content-Encoding': 'br',
          'Content-Length': b.length,
          'Cache-Control': 'no-store',
        })
        .end(b)
    })
    servers[name] = server
    await new Promise((ok, fail) =>
      server.once('error', fail).listen(0, '127.0.0.1', ok),
    )
    origins[name] = 'http://127.0.0.1:' + server.address().port
  }
  browser = await chromium.launch({
    ...(process.env.CULM_CHROME
      ? { executablePath: process.env.CULM_CHROME }
      : {}),
    headless: true,
    args: [
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      ...(process.env.BENCH_SOFTWARE_GL
        ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : []),
    ],
  })
  const metaPage = await browser.newPage()
  const renderer = await metaPage.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
  })
  await metaPage.close()
  const result = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    date: new Date().toISOString(),
    astro: require('astro/package.json').version,
    playwright: require('playwright-core/package.json').version,
    chrome: browser.version(),
    node: process.version,
    platform: `${platform()} ${osRelease()}`,
    cpu: cpus()[0].model,
    renderer,
    profiles,
    bytes,
    count,
    observationMs,
    runs: [],
  }
  const save = () => writeFile(output, JSON.stringify(result, null, 2) + '\n')
  const names = (
    process.env.BENCH_VARIANTS?.split(',') ||
    Object.keys(variants).filter(n => !n.endsWith('-poster'))
  ).sort()
  const profileNames = process.env.BENCH_PROFILES?.split(',') || [
    'local',
    'mobile',
  ]
  for (let round = -1; round < count; round++) {
    const ordered = names.map(
      (_, i) =>
        names[
          ((round % 2 === 0 ? i : -i) + round + 2 * names.length) % names.length
        ],
    )
    for (const profile of round % 2
      ? [...profileNames].reverse()
      : profileNames) {
      const p = profiles[profile]
      for (const name of ordered) {
        const ctx = await browser.newContext({
          viewport: { width: p.width, height: p.height },
          deviceScaleFactor: 1,
          reducedMotion: 'no-preference',
        })
        try {
          // Instrumentation is out-of-band and identical across variants. Keep the
          // native frame clock and record actual worker acknowledgements, not submits.
          await ctx.addInitScript(() => {
            const m = (window.__bench = {
              lcp: null,
              lcpElement: null,
              firstActive: null,
              acks: [],
              raf: [],
              sizes: [],
              longMs: 0,
              cls: 0,
              hostStarts: 0,
              errors: [],
            })
            for (const typ of [
              'largest-contentful-paint',
              'longtask',
              'layout-shift',
            ]) {
              new PerformanceObserver(list => {
                for (const e of list.getEntries()) {
                  if (typ === 'largest-contentful-paint') {
                    m.lcp = e.startTime
                    m.lcpElement = e.element?.tagName
                  } else if (typ === 'longtask') m.longMs += e.duration
                  else if (!e.hadRecentInput) m.cls += e.value
                }
              }).observe({ type: typ, buffered: true })
            }
            new MutationObserver(records => {
              if (
                m.firstActive === null &&
                records.some(r => r.target.hasAttribute('data-gpu-painted'))
              )
                m.firstActive = performance.now()
            }).observe(document, {
              subtree: true,
              attributes: true,
              attributeFilter: ['data-gpu-painted'],
            })
            const sizeSeen = (w, h) => {
              const d = `${w}x${h}`
              if (d !== m.sizes.at(-1)) m.sizes.push(d)
            }
            window.Worker = class extends Worker {
              constructor(...args) {
                super(...args)
                m.hostStarts++
                this.addEventListener('message', e => {
                  if (e.data === 1) m.acks.push(performance.now())
                })
              }
              postMessage(msg, ...rest) {
                if (Array.isArray(msg) && typeof msg[0] === 'number')
                  sizeSeen(msg[0], msg[1])
                return super.postMessage(msg, ...rest)
              }
            }
            const finish = WebGL2RenderingContext.prototype.finish
            WebGL2RenderingContext.prototype.finish = function () {
              const ret = finish.call(this)
              m.acks.push(performance.now())
              sizeSeen(this.drawingBufferWidth, this.drawingBufferHeight)
              return ret
            }
            const loop = t => {
              m.raf.push(t)
              requestAnimationFrame(loop)
            }
            requestAnimationFrame(loop)
            window.addEventListener('error', e => m.errors.push(e.message))
          })
          const page = await ctx.newPage()
          const cdp = await ctx.newCDPSession(page)
          await cdp.send('Network.enable')
          await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
          if (p.latency)
            await cdp.send('Network.emulateNetworkConditions', {
              offline: false,
              latency: p.latency,
              downloadThroughput: (p.downKbps * 1000) / 8,
              uploadThroughput: (p.upKbps * 1000) / 8,
              connectionType: 'cellular4g',
            })
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu })
          const bad = []
          page.on('requestfailed', r =>
            bad.push([r.url(), r.failure()?.errorText]),
          )
          await page.goto(origins[name], { waitUntil: 'load', timeout: 20000 })
          const row = await page.evaluate(async ms => {
            await new Promise(r =>
              setTimeout(r, Math.max(0, ms - performance.now())),
            )
            const b = window.__bench,
              nav = performance.getEntriesByType('navigation')[0],
              res = performance
                .getEntriesByType('resource')
                .filter(e => /\.(js|svg)$/.test(e.name))
            const end = performance.now(),
              start = 600
            const stats = a => {
              const s = a.filter(t => t >= start && t <= ms),
                d = s
                  .slice(1)
                  .map((t, i) => t - s[i])
                  .sort((a, b) => a - b)
              return {
                n: s.length,
                fps: (s.length * 1000) / (ms - start),
                p95ms: d.length ? d[Math.ceil(d.length * 0.95) - 1] : null,
              }
            }
            const heading = document.querySelector('h1'),
              rect = heading.getBoundingClientRect()
            return {
              lcp: b.lcp,
              lcpElement: b.lcpElement,
              fcp: performance.getEntriesByName('first-contentful-paint')[0]
                ?.startTime,
              ttfb: nav.responseStart,
              load: nav.loadEventEnd,
              firstActive: b.firstActive,
              activeAtEnd: !!document.querySelector('[data-gpu-painted]'),
              raf: stats(b.raf),
              ack: stats(b.acks),
              sizes: b.sizes,
              hostStarts: b.hostStarts,
              longMs: b.longMs,
              cls: b.cls,
              content: [
                heading.textContent,
                rect.x,
                rect.y,
                rect.width,
                rect.height,
              ],
              wire:
                nav.encodedBodySize +
                res.reduce((n, r) => n + r.encodedBodySize, 0),
              requests: 1 + res.length,
              resources: res.map(e => [
                new URL(e.name).pathname,
                e.startTime,
                e.responseEnd,
                e.encodedBodySize,
              ]),
              end,
              errors: b.errors,
            }
          }, observationMs)
          assert.equal(row.content[0], 'Reading the tide')
          assert.ok(
            row.fcp > 0 && row.lcp > 0,
            JSON.stringify({ name, profile, row }),
          )
          assert.deepEqual(bad, [])
          assert.deepEqual(row.errors, [])
          if (name.endsWith('-static')) assert.equal(row.hostStarts, 0)
          if (round >= 0)
            result.runs.push({ name, profile, round: round + 1, ...row })
        } finally {
          await ctx.close()
        }
      }
    }
    await save()
    console.log(
      `${round < 0 ? 'warm-up' : `round ${round + 1}/${count}`} (${result.runs.length} measured cold contexts)`,
    )
  }
  console.log(output)
} finally {
  if (browser) await browser.close()
  for (const s of Object.values(servers)) s.close()
}
