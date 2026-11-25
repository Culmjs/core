/** Offline, single-step PEAT inputs. No HTTP listener, page timer or demo.
 * The only bypass is a test-only substitution in the control's local worker. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { candidateCompiler } from './gpu-flash/compiler.ts'
import { node, siteWith, text } from '../packages/core/__tests__/kit.ts'
import { openBrowser } from '../packages/tools/src/measure/browser.ts'
import { renderGpuWorker } from './gen-scripts.ts'
import { limitChannel } from '../packages/core/src/scripts/gpuLimiter.ts'

const root = '.superpowers/gpu-flash'
const sha = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex')
const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr || String(r.error))
  return r.stdout.trim()
}
const fileHash = async (file: string) => {
  const h = createHash('sha256')
  for await (const part of createReadStream(file)) h.update(part)
  return h.digest('hex')
}
const source =
  'vec4 shade(vec2 uv){return vec4(vec3(float(int(u_time*30.0+0.5)/3%2)),1.0);}'
const { compilePage, createRegistry } = await candidateCompiler()
const compiled = compilePage(
  siteWith(
    [
      {
        ...node('hero', 'box', [text('caption', 'Luminance fixture')]),
        motion: { trigger: 'enter-view', gpu: 'luminance' },
      },
    ],
    { customEffects: [{ name: 'luminance', source, settings: {} }] },
  ),
  'home',
  {
    registry: createRegistry({ gpu: { enabled: true } }),
  },
)
assert.ok(compiled.ok, JSON.stringify(compiled.problems))
const payload = JSON.parse(
  compiled.html.match(/id="culm-gpu">([^<]+)<\/script>/)![1],
)
assert.equal(payload.definitions[0].source, source)
const worker = renderGpuWorker(true)
const clamp = 'a+clamp(b-a,-D,D)'
assert.equal(worker.split(clamp).length, 2)
const b = await openBrowser()
assert.ok(b.ok, JSON.stringify(b))
await mkdir(root, { recursive: true })
const toolchain = {
  browser: b.browser.version,
  worker: sha(worker),
  host: sha(compiled.assets![0].content),
  ffmpeg: run('ffmpeg', ['-version']).split('\n')[0],
  ffprobe: run('ffprobe', ['-version']).split('\n')[0],
}
try {
  for (const variant of ['control', 'limited']) {
    const dir = join(root, variant)
    await mkdir(dir, { recursive: true })
    const p = await b.browser.newPage()
    try {
      await p.unblock()
      await p.setViewport(1024, 768, 1)
      await p.setScheme('light')
      await p.setReducedMotion(false)
      // No dynamic effect in navigable markup. The worker cannot run a frame
      // before a CDP command transfers a surface and submits its checked binding.
      const code = variant === 'control' ? worker.replace(clamp, 'b') : worker
      await p.evaluate(`(()=>{
        document.body.style.cssText='margin:0;background:black';
        const c=document.createElement('canvas');c.width=1024;c.height=768;
        c.style.cssText='display:block;width:100vw;height:100vh';document.body.append(c);
        const surface=c.transferControlToOffscreen();
        const observer="const get=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(...args){const g=get.apply(this,args),ext=g.getExtension('WEBGL_debug_renderer_info');postMessage({gl:g.getParameter(g.VERSION),renderer:ext&&g.getParameter(ext.UNMASKED_RENDERER_WEBGL)});return g};";
        const worker=new Worker(URL.createObjectURL(new Blob([observer,${JSON.stringify(code)}],{type:'text/javascript'})));
        let resolve,reject;worker.onerror=e=>reject(Error(e.message));worker.onmessage=e=>{if(typeof e.data==='object')window.driver=e.data;else if(e.data===1)resolve();else reject(Error('bad frame '+e.data))};
        window.step=async n=>{const submitted=performance.now();
          await new Promise((r,j)=>{resolve=r;reject=j;
            worker.postMessage([1024,768,[[0,0,1024,768,0,[0,0,0],n>0]],n/30,n?undefined:surface,n?undefined:${JSON.stringify([[payload.definitions[0].source, payload.regions[0].settings, false]])},0,0,0],n?[]:[surface])});
          const ack=performance.now();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          return {submitted,ack,paint:performance.now()}}})()`)
      const frames = []
      const start = performance.now()
      for (let n = 0; n < 180; n++) {
        const timing = await p.evaluate<object>(`step(${n})`)
        const png = await p.screenshot()
        const filename = `${String(n).padStart(3, '0')}.png`
        await writeFile(join(dir, filename), png)
        frames.push({
          n,
          requestedMs: (n * 1000) / 30,
          displayedPts: n,
          requestedCode: (Math.floor(n / 3) % 2) * 255,
          ...timing,
          capturedWallMs: performance.now() - start,
          filename,
          sha256: sha(png),
        })
      }
      assert.deepEqual(p.errors, [])
      const clip = join(dir, 'clip.avi')
      const encode = [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        '30',
        '-start_number',
        '0',
        '-i',
        join(dir, '%03d.png'),
        '-frames:v',
        '180',
        '-an',
        '-c:v',
        'rawvideo',
        '-pix_fmt',
        'bgr24',
        clip,
      ]
      run('ffmpeg', encode)
      const probe = JSON.parse(
        run('ffprobe', [
          '-v',
          'error',
          '-count_frames',
          '-show_streams',
          '-of',
          'json',
          clip,
        ]),
      ).streams[0]
      assert.deepEqual(
        [
          probe.codec_name,
          probe.pix_fmt,
          probe.width,
          probe.height,
          probe.r_frame_rate,
          probe.nb_read_frames,
        ],
        ['rawvideo', 'bgr24', 1024, 768, '30/1', '180'],
      )
      // Identify every decoded full-screen frame, not one sampled texel.
      const hashes = run('ffmpeg', [
        '-v',
        'error',
        '-i',
        clip,
        '-pix_fmt',
        'bgr24',
        '-f',
        'framehash',
        '-hash',
        'sha256',
        '-',
      ])
        .split('\n')
        .filter(s => /^\d+,/.test(s))
      const colors = new Map(
        Array.from({ length: 256 }, (_, i) => [
          sha(Buffer.alloc(1024 * 768 * 3, i)),
          i,
        ]),
      )
      let previous = 0
      const log = frames.map((f, i) => {
        const fields = hashes[i].split(',').map(v => v.trim())
        assert.equal(Number(fields[2]), i)
        const code = colors.get(fields.at(-1)!)
        assert.notEqual(code, undefined, 'nonuniform captured frame ' + i)
        const a = previous / 255
        const linear = limitChannel(
          a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4,
          f.requestedCode / 255,
          i ? 1000 / 30 : 0,
          0.25,
        )
        const expected = Math.round(
          255 *
            (linear <= 0.0031308
              ? 12.92 * linear
              : 1.055 * linear ** (1 / 2.4) - 0.055),
        )
        assert.equal(
          code,
          variant === 'control' ? f.requestedCode : expected,
          variant + ' frame ' + i,
        )
        previous = code!
        return { ...f, displayedCode: code }
      })
      assert.ok(new Set(log.map(f => f.displayedCode)).size > 1)
      const summary = {
        ...toolchain,
        driver: await p.evaluate('driver'),
        variant,
        shader: source,
        fixtureWorker: sha(code),
        argv: encode,
        clipSha256: await fileHash(clip),
        probe,
        frames: 180,
        dropped: 0,
        duplicatePts: 0,
        identicalAdjacentPixels: log.filter(
          (f, i) => i && f.displayedCode === log[i - 1].displayedCode,
        ).length,
      }
      await writeFile(
        join(dir, 'frames.json'),
        JSON.stringify(log, null, 2) + '\n',
      )
      await writeFile(
        join(dir, 'summary.json'),
        JSON.stringify(summary, null, 2) + '\n',
      )
      console.log(JSON.stringify(summary))
    } finally {
      await p.close()
    }
  }
} finally {
  await b.browser.close()
}
