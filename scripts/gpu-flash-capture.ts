/** Offline, single-step PEAT inputs. No HTTP listener, page timer or demo.
 * The only bypass is a test-only substitution in the control's local worker. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { candidateCompiler } from './gpu-flash/compiler.ts'
import { node, siteWith, text } from '../packages/core/__tests__/kit.ts'
import { openBrowser } from '../packages/tools/src/measure/browser.ts'
import { renderGpuWorker } from './gen-scripts.ts'

const root = '.superpowers/gpu-flash/size-1'
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
        style: { base: { bg: '#000000', height: { n: 768, unit: 'px' } } },
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
const clamp = 'u_O=K==2?'
assert.equal(worker.split(clamp).length, 2)
const b = await openBrowser()
assert.ok(b.ok, JSON.stringify(b))
await mkdir(root, { recursive: true })
const tmp = await mkdtemp(join(tmpdir(), 'culm-field-'))
const scene = join(tmp, 'static.html')
// No executable in the on-disk fixture. CDP explicitly starts the priced host.
await writeFile(scene, compiled.html.replace(/<script>[^]*?<\/script>/g, ''))
const toolchain = {
  browser: b.browser.version,
  workerBodySha256: sha(worker),
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
      assert.ok((await p.goto(pathToFileURL(scene).href, 10000)).ok)
      const code =
        variant === 'control' ? worker.replace(clamp, 'u_O=true?') : worker
      const observer =
        "const get=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(...args){const g=get.apply(this,args),ext=g.getExtension('WEBGL_debug_renderer_info');postMessage({gl:g.getParameter(g.VERSION),renderer:ext&&g.getParameter(ext.UNMASKED_RENDERER_WEBGL)});return g};"
      await p.evaluate(`(()=>{
        const raf=requestAnimationFrame.bind(window);let tick,worker,template,resolve,reject;
        window.requestAnimationFrame=f=>{tick=f;return 1};
        window.Blob=class extends Blob{constructor(parts,opts){
          if(opts?.type==='text/javascript'){
            if(parts.length!==1||parts[0]!==${JSON.stringify(worker)})throw Error('embedded worker drift');
            parts=[${JSON.stringify(observer)},${JSON.stringify(code)}]
          }super(parts,opts)}};
        window.Worker=class extends Worker{constructor(...args){super(...args);worker=this;
          this.addEventListener('error',e=>reject(Error(e.message)));this.addEventListener('message',e=>{
            if(typeof e.data==='object'){e.stopImmediatePropagation();window.driver=e.data}
            else if(e.data===1)setTimeout(resolve,0);else reject(Error('bad frame '+e.data))})
          }postMessage(msg,...args){template=msg;super.postMessage(msg,...args)}};
        const wait=f=>new Promise((r,j)=>{resolve=r;reject=j;f()});
        window.prepare=async()=>{
          // Allocation, real fallback seeding, acknowledgement, reveal and quality
          // warm-up all run through the compiled host, at fixed simulation time 0.
          for(let n=0;n<123;n++)await wait(()=>tick(100));
          const owner=document.querySelector('[data-gpu-painted]');
          if(!owner||template[0]!==1024||template[1]!==768||template[2].length!==1||
            template[2][0].slice(0,4).join()!=='0,0,1024,768')throw Error('not one full-size presented owner');
          for(const child of owner.children)child.style.visibility='hidden';
        };
        window.step=async n=>{const submitted=performance.now();
          const msg=template.slice();msg[3]=n/30;
          await wait(()=>worker.postMessage(msg));
          const ack=performance.now();await new Promise(r=>raf(()=>raf(r)));
          return {submitted,ack,paint:performance.now()}}})()`)
      await p.evaluate(compiled.assets![0].content)
      await p.evaluate('prepare()')
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
      let remainder = 0
      const log = frames.map((f, i) => {
        const fields = hashes[i].split(',').map(v => v.trim())
        assert.equal(Number(fields[2]), i)
        const code = colors.get(fields.at(-1)!)
        assert.notEqual(code, undefined, 'nonuniform captured frame ' + i)
        if (i) remainder += (0.25 * 0.033 * 255 * 1.055) / 2.4
        const steps = Math.floor(remainder)
        remainder -= steps
        const expected =
          previous +
          Math.max(-steps, Math.min(steps, f.requestedCode - previous))
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
        fixtureWorkerBodySha256: sha(code),
        instrumentedBlobSha256: sha(observer + code),
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
  await rm(tmp, { recursive: true, force: true })
}
