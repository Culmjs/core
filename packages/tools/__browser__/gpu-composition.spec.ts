import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { candidateCompiler } from '../../../scripts/gpu-flash/compiler.ts'
import { node, siteWith, text } from '../../core/__tests__/kit.ts'
import { openBrowser, type Page } from '../src/measure/browser.ts'
import { contours } from '../../core/src/registry/gpuBuiltins.ts'

const { compilePage, createRegistry } = await candidateCompiler()
const setup = async (
  t: TestContext,
  source: string,
  poster = false,
  width = 320,
) => {
  const dir = await mkdtemp(join(tmpdir(), 'culm-compose-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const svg = join(dir, 'survey.svg')
  await writeFile(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#999"/><path d="M0 24Q36 12 96 48M0 62Q44 54 96 76" fill="none" stroke="#9c9c9c"/></svg>',
  )
  const c = compilePage(
    siteWith(
      [0, 1].map(i => ({
        ...node('hero' + i, 'box', [
          text('heading' + i, '', {
            props: { level: 'h1', runs: [{ text: 'Reading the tide' }] },
          }),
          text('caption' + i, 'An illustrated field survey of the riverbank.'),
        ]),
        style: {
          base: {
            bg: i ? '#efefef' : '#999999',
            height: { n: 320, unit: 'px' },
          },
        },
        motion: {
          gpu: i ? 'other_survey' : 'survey_contours',
          trigger: 'enter-view',
          settings: { speed: i ? 0 : 0.25 },
          ...(poster && { poster: 'survey.svg' }),
        },
      })),
      {
        customEffects: ['survey_contours', 'other_survey'].map(name => ({
          name,
          source,
          settings: contours.settings,
        })),
      },
    ),
    'home',
    {
      registry: createRegistry({ gpu: { enabled: true } }),
      links: { page: s => s, file: () => svg },
    },
  )
  assert.ok(c.ok, JSON.stringify(c.problems))
  const file = join(dir, 'scene.html')
  await writeFile(file, c.html.replace(/<script>[^]*?<\/script>/g, ''))
  const b = await openBrowser()
  assert.ok(b.ok)
  t.after(() => b.browser.close())
  const p = await b.browser.newPage()
  t.after(() => p.close())
  await p.unblock()
  await p.setViewport(width, 800)
  await p.setReducedMotion(false)
  assert.ok((await p.goto(pathToFileURL(file).href, 10000)).ok)
  await p.evaluate(`(()=>{
    window.owners=[...document.querySelectorAll('[data-gpu-run]')];
    const raf=requestAnimationFrame;window.paint=()=>new Promise(r=>raf(()=>raf(r)));
    let next,at=100,ack;window.requestAnimationFrame=f=>{next=f;return 1};
    window.workerCount=0;window.work=[];window.draws=[];window.held=false;
    window.Worker=class extends Worker{constructor(...a){super(...a);workerCount++;
      this.addEventListener('message',e=>{if(e.data!==1)throw Error('GL failed: '+e.data);if(ack)setTimeout(ack,0)})}
      postMessage(msg,...a){work.push(msg[0]);draws.push(msg[2].length);super.postMessage(msg,...a)}
      set onmessage(f){super.onmessage=e=>{if(held)window.release=()=>f(e);else f(e)}}};
    window.ticks=async(n,dt=1000/60)=>{for(let i=0;i<n;i++){
      const prev=work.length,cb=next;next=null;if(!cb)return;
      const done=new Promise(r=>ack=r);cb(at+=dt);if(work.length>prev)await done
    }}
  })()`)
  return {
    p,
    start: () => p.evaluate(c.assets![0].content),
    tick: (n: number, dt = 1000 / 60) => p.evaluate(`ticks(${n},${dt})`),
  }
}
type Point = [number, number]
async function samples(p: Page, points: Point[]) {
  await p.evaluate('paint()')
  const png = Buffer.from(await p.screenshot()).toString('base64')
  return p.evaluate<number[]>(
    `(async()=>{const pic=await createImageBitmap(new Blob([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))]));const c=new OffscreenCanvas(pic.width,pic.height).getContext('2d');c.drawImage(pic,0,0);const d=c.getImageData(0,0,pic.width,pic.height).data;return ${JSON.stringify(points)}.map(([x,y])=>d[4*(x+y*pic.width)])})()`,
  )
}
const marked = `owners.map(e=>e.hasAttribute('data-gpu-painted'))`
const alternating =
  'vec4 shade(vec2 uv){return vec4(vec3(float(int(uv.x*u_resolution.x)%2)),0.0);}'
const middle = 'vec4 shade(vec2 uv){return vec4(vec3(0.5),0.0);}'
test('overlapping foreground layers stay static; a clipped background does not seed an opaque padding fringe', async t => {
  const { p, start, tick } = await setup(t, middle)
  await p.evaluate(
    `owners[0].children[1].style.marginTop='-35px';owners[0].children[1].style.background='#000';owners[1].style.padding='30px';owners[1].style.backgroundClip='content-box';document.querySelector('main').style.backgroundColor='#112233'`,
  )
  const pt: Point[] = [[15, 470]]
  const stat = await samples(p, pt)
  assert.equal(stat[0], 17)
  await start()
  await tick(3)
  assert.deepEqual(await p.evaluate(marked), [false, true])
  assert.ok(Math.abs((await samples(p, pt))[0] - stat[0]) <= 1)
})
for (const hz of [30, 60, 120])
  test(`stationary half-white foreground and actual antialiased glyphs at ${hz} Hz`, async t => {
    const { p, start, tick } = await setup(
      t,
      'vec4 shade(vec2 uv){return vec4(float(u_set_speed>0.0));}',
    )
    await p.evaluate(
      `owners[0].style.backgroundColor='#000';const h=owners[0].querySelector('h1');h.style.cssText='font:32px/52px Arial;color:white;background:rgba(255,255,255,.5);margin:0;width:320px;height:52px';`,
    )
    const row: Point[] = Array.from({ length: 320 * 48 }, (_, i) => [
      i % 320,
      Math.floor(i / 320),
    ])
    const mask = await samples(p, row)
    const idx = mask
      .map((v, i) => (v > 135 && v < 230 ? i : -1))
      .filter(i => i >= 0)
    assert.ok(idx.length > 30)
    const pts: Point[] = [
      [318, 3],
      [40, 190],
      ...idx.slice(0, 160).map(i => row[i]),
      [318, 600],
    ]
    const stat = await samples(p, pts)
    assert.equal(stat[0], 128)
    await start()
    await tick(1)
    let prev = stat,
      maxJump = 0
    const frames = []
    for (let n = 0; n < (hz === 30 ? 7 : hz === 60 ? 18 : 36); n++) {
      await tick(1, 1000 / hz)
      const now = await samples(p, pts)
      maxJump = Math.max(maxJump, ...now.map((c, i) => Math.abs(c - prev[i])))
      frames.push(now[0])
      prev = now
    }
    assert.ok(maxJump <= 1, JSON.stringify({ hz, maxJump, frames }))
    assert.ok(
      prev[0] > stat[0] &&
        prev[1] > stat[1] &&
        prev.slice(2, -1).some((c, i) => c > stat[i + 2]) &&
        prev.at(-1)! < stat.at(-1)!,
    )
    t.diagnostic(
      JSON.stringify({
        hz,
        maxJump,
        half: frames,
        bare: prev[1],
        aa: prev[2],
        aaStart: stat[2],
        bright: [stat.at(-1), prev.at(-1)],
      }),
    )
  })
test('actual lit neighbours survive a shader resolution decrease on the same screen grid', async t => {
  const { p, start, tick } = await setup(t, alternating)
  const pts: Point[] = [
    [24, 160],
    [25, 160],
    [26, 160],
    [27, 160],
  ]
  await start()
  await tick(850, 1000 / 61)
  const before = await samples(p, pts)
  assert.deepEqual(before, [0, 255, 0, 255])
  await tick(8, 32)
  const pre = await samples(p, pts)
  await tick(1, 32)
  const post = await samples(p, pts)
  assert.equal(await p.evaluate('work.at(-1)'), 160)
  assert.deepEqual(pre, before)
  assert.ok(
    pre.every((v, i) => Math.abs(v - post[i]) <= 1),
    JSON.stringify({ pre, post }),
  )
  await tick(15, 16)
  const later = await samples(p, pts)
  assert.notDeepEqual(later, post)
  assert.ok(later[1] < post[1] && later[2] > post[2])
  t.diagnostic(JSON.stringify({ before, pre, post, later }))
})
test('same-box changed fallback while the first frame is pending is not uncovered by that ACK', async t => {
  const { p, start, tick } = await setup(t, middle)
  await p.evaluate('window.held=true')
  await start()
  await tick(1)
  await p.evaluate(
    `owners[0].style.backgroundColor='rgb(12,12,12)';held=false;release()`,
  )
  await tick(1)
  assert.deepEqual(await p.evaluate(marked), [false, true])
  assert.equal((await samples(p, [[40, 160]]))[0], 12)
  await tick(6)
  const newer = (await samples(p, [[40, 160]]))[0]
  assert.ok(newer > 12 && newer <= 16, String(newer))
  await p.evaluate(
    `Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));`,
  )
  await p.evaluate(
    `delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));held=true`,
  )
  await tick(1, 60000)
  await p.evaluate(
    `owners[0].style.backgroundImage='linear-gradient(90deg,#111 50%,#eee 50%)';held=false;release()`,
  )
  await tick(1)
  assert.deepEqual(await p.evaluate(marked), [false, true])
  assert.deepEqual(
    await samples(p, [
      [40, 160],
      [250, 160],
    ]),
    [17, 238],
  )
})
test('blocked patterned owners submit no empty frames and never share a neighbour’s slow flag', async t => {
  const { p, start, tick } = await setup(t, middle, true)
  await p.evaluate(`owners.forEach(e=>e.style.boxShadow='0 1px 2px #000')`)
  await start()
  await tick(4, 120)
  assert.equal(await p.evaluate('workerCount'), 0)
  await p.evaluate(`owners[1].style.boxShadow='';`)
  await p.evaluate(`new Promise(r=>setTimeout(r,530))`)
  await tick(10, 120)
  assert.ok(await p.evaluate('draws.length>0 && draws.every(n=>n===1)'))
  assert.ok(
    await p.evaluate(
      `Object.keys(localStorage).length===1 && Object.keys(localStorage)[0].includes('other_survey') && !document.querySelector('canvas')`,
    ),
  )
})
for (const scheme of ['light', 'dark'] as const)
  test(`survey SVG begins moving toward the real contour in ${scheme}; independent patterned owner retains readable text`, async t => {
    const { p, start, tick } = await setup(t, contours.source, true, 392)
    await p.setScheme(scheme)
    await p.evaluate(
      `owners[1].style.backgroundImage='linear-gradient(90deg,#111 50%,#eee 50%)';owners[1].querySelector('h1').style.cssText='margin:0;font:32px/52px Arial;color:#fff;background:rgba(255,255,255,.5)'`,
    )
    const pts: Point[] = [
      ...Array.from({ length: 40 }, (_, i): Point => [4 + 9 * i, 170]),
      [30, 490],
      [300, 490],
      [30, 323],
      [300, 323],
    ]
    const stat = await samples(p, pts)
    const expected = (x: number, y: number, s: number) =>
      Math.round(
        255 *
          (0.6 +
            0.2 *
              Math.sin(
                ((Math.floor((x + 0.5) * s) + 0.5) / (392 * s)) * 24 +
                  Math.sin(
                    ((Math.floor((320 - y - 0.5) * s) + 0.5) / (320 * s)) * 9,
                  ),
              )),
      )
    const target = pts.slice(0, 40).map(([x, y]) => expected(x, y, 0.25))
    await start()
    await tick(1)
    assert.deepEqual(await samples(p, pts), stat)
    let first: number[] | undefined,
      firstFrame = 0,
      markedFrame = 0,
      firstWall = 0,
      markWall = 0
    const wall = performance.now()
    for (let n = 1; n <= 18; n++) {
      await tick(1)
      if (!markedFrame && (await p.evaluate<boolean[]>(marked))[0]) {
        markedFrame = n
        markWall = performance.now() - wall
      }
      const s = await samples(p, pts)
      if (
        !first &&
        target.some((v, i) => Math.abs(v - s[i]) < Math.abs(v - stat[i]))
      ) {
        first = s
        firstFrame = n
        firstWall = performance.now() - wall
      }
    }
    const early = await samples(p, pts)
    await tick(800)
    const later = await samples(p, pts)
    assert.ok(
      first && markedFrame && firstFrame <= 18,
      JSON.stringify({ firstFrame, markedFrame, stat, early, later }),
    )
    assert.ok(
      early[40] > stat[40] &&
        early[41] < stat[41] &&
        early[41] - early[40] > 190,
      JSON.stringify({ stat, early }),
    )
    assert.ok(
      target.some((v, i) => v > early[i] && early[i] > stat[i]) &&
        target.some((v, i) => v < early[i] && early[i] < stat[i]),
    )
    for (let i = 40; i < 44; i++) {
      const [x, y] = pts[i]
      const goal = expected(x, y - 320, 1)
      assert.ok(
        Math.abs(later[i] - (i < 42 ? goal : (255 + goal) / 2)) <= 1.5,
        JSON.stringify({ i, goal, later }),
      )
    }
    t.diagnostic(
      JSON.stringify({
        firstFrame,
        markedFrame,
        firstWall,
        markWall,
        changed: first!.slice(0, 40).filter((v, i) => v !== stat[i]).length,
        stat: stat.slice(40),
        early: early.slice(40),
        later: later.slice(40),
      }),
    )
  })
