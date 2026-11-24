import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import {
  compilePage,
  TIMELINE_SCRIPT,
  type SiteDocument,
  type Step,
} from '@culmjs/core'
import {
  node,
  text,
  siteWith,
  sampleRegistry,
} from '../../core/__tests__/kit.ts'
import { openBrowser, type Browser } from '../src/measure/browser.ts'

let browser: Browser
before(async () => {
  const r = await openBrowser()
  assert.ok(r.ok, JSON.stringify(r))
  browser = r.browser
})
after(async () => {
  await browser?.close()
})
async function read(doc: SiteDocument, body: string, reduced = false) {
  const r = compilePage(doc, 'home', {
    registry: sampleRegistry(),
    mode: 'measure',
    data: { rows: { projects: [{ title: 'A' }, { title: 'B' }] } },
  })
  assert.ok(r.ok, JSON.stringify(r.problems))
  const p = await browser.newPage()
  try {
    await p.answer(async url =>
      url === 'https://site.culm.invalid/'
        ? { type: 'text/html', body: r.html }
        : url === 'https://site.culm.invalid/favicon.ico'
          ? { type: 'image/x-icon', body: '' }
          : undefined,
    )
    await p.setViewport(1280, 900)
    if (reduced) await p.setScheme('light')
    assert.ok((await p.goto('https://site.culm.invalid/', 15000)).ok)
    const got =
      await p.evaluate(`(async()=>{const get=id=>document.querySelector('[data-id="'+id+'"]'),
      tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      ${body}})()`)
    assert.deepEqual(p.errors, [])
    assert.deepEqual(p.blocked, [])
    return got
  } finally {
    await p.close()
  }
}
const x: Step = {
  target: 'self',
  from: { xPx: 0 },
  to: { xPx: 100 },
  durationMs: 100,
}

test('generated WAAPI shares a clock through stagger, holds and discontinuous steps; rotation and independent CSS survive', async () => {
  const kids = ['a', 'b', 'c'].map(id => text(id, id))
  kids[0].motion = {
    trigger: 'load',
    steps: [{ ...x, from: { yPx: 25 }, to: { yPx: 25 } }],
  }
  kids[0].style = { base: { rotate: 15 } }
  const box = node('box', 'column', kids)
  box.motion = {
    trigger: 'load',
    steps: [
      { ...x, target: 'children', staggerMs: 40, ease: 'ease-out' },
      { ...x, target: { id: 'a' }, from: { yPx: 0 }, to: { yPx: 100 } },
      {
        ...x,
        target: { id: 'a' },
        from: { xPx: 200 },
        to: { xPx: 300 },
        delayMs: 50,
      },
    ],
  }
  const body = `
    ${TIMELINE_SCRIPT};
    const els=['a','b','c'].map(get);
    const animations=els.flatMap(el=>el.getAnimations().filter(a=>!(a instanceof CSSAnimation)));
    await Promise.all(animations.map(a=>a.ready));
    const same=new Set(animations.map(a=>a.startTime)).size;
    const css=els[0].getAnimations().find(a=>a instanceof CSSAnimation);css.pause();css.currentTime=50;
    const read=ms=>{for(const a of animations){a.pause();a.currentTime=ms}
      return els.map(el=>getComputedStyle(el).translate.split(' ').map(parseFloat))};
    return [same,animations.length,read(50),read(180),read(230),read(305),read(380),getComputedStyle(els[0]).transform]`
  const result = await read(siteWith([box]), body)
  assert.deepEqual(result, [
    1,
    4,
    [[75, 25], [19], [0]],
    [[100, 25], [100], [100]],
    [[100, 75], [100], [100]],
    [[100, 125], [100], [100]],
    [[250, 125], [100], [100]],
    'matrix(0.965926, 0.258819, -0.258819, 0.965926, 0, 0)',
  ])
})

test('native intersection starts the actual entrance once; reduced motion stays readable', async () => {
  const space = node('space', 'box')
  space.style = { base: { height: { n: 1800, unit: 'px' } } }
  const hero = text('hero', 'Reed', {
    motion: { trigger: 'enter-view', steps: [x] },
  })
  const doc = siteWith([space, hero])
  const got = await read(
    doc,
    `
    const el=get('hero');await tick();const before=el.getAnimations().length;
    el.scrollIntoView();await tick();
    const a=el.getAnimations()[0];await a.finished;
    const end=getComputedStyle(el).translate;
    scrollTo(0,0);await tick();el.scrollIntoView();await tick();
    return [before,end,el.getAnimations()[0]===a,a.playState]`,
  )
  assert.deepEqual(got, [0, '100px', true, 'finished'])
  assert.deepEqual(
    await read(
      doc,
      `const el=get('hero');el.scrollIntoView();await tick();return [el.getAnimations().length,getComputedStyle(el).translate]`,
      true,
    ),
    [0, 'none'],
  )
})

test('repeat copies activate only their own target and deactivate back to author layout', async () => {
  const root = node('panel', 'box', [
    text('title', 'Title', {
      props: { level: 'span', runs: [{ text: 'Title' }] },
    }),
  ])
  root.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  root.motion = {
    trigger: { state: 'mode', is: 'on' },
    steps: [
      { ...x, target: { id: 'title' } },
      { ...x, target: 'self' },
    ],
  }
  const doc = siteWith(
    [
      {
        ...node('list', 'list', [
          { ...node('item', 'instance'), component: 'card' },
        ]),
        repeat: { source: 'projects' },
      },
    ],
    {
      components: [{ id: 'card', name: 'Card', root, props: [], variants: [] }],
    },
  )
  assert.deepEqual(
    await read(
      doc,
      `
    const o=get('item~1'),one=get('item.title~0'),two=get('item.title~1');
    const left=two.getBoundingClientRect().left;
    o.dataset.sMode='on';await tick();
    for(const a of o.getAnimations({subtree:true})){a.pause();a.currentTime=50}
    const active=[one.getAnimations().length,two.getBoundingClientRect().left-left,getComputedStyle(two).display];
    o.dataset.sMode='off';await tick();return [...active,two.getAnimations().length,getComputedStyle(two).display]`,
    ),
    [0, 50, 'inline-block', 0, 'inline'],
  )
})

test('releasing a settled activation reveals the earlier completed WAAPI track', async () => {
  const fade = (value: number): Step => ({
    ...x,
    from: { opacity: 1 },
    to: { opacity: value },
    durationMs: 20,
  })
  const child = text('label', 'Label', {
    motion: { trigger: 'enter-view', steps: [fade(0.5)] },
  })
  const box = node('box', 'box', [child])
  box.state = [{ name: 'mode', initial: 'off', values: 'on-off' }]
  box.motion = {
    trigger: { state: 'mode', is: 'on' },
    steps: [{ ...fade(0.75), target: 'children' }, x],
  }
  const got = await read(
    siteWith([box]),
    `
    const b=get('box'),el=get('label'),sample=()=>+getComputedStyle(el).opacity;
    const settled=async()=>{await tick();await Promise.all(el.getAnimations().map(a=>a.finished));await tick()}
    await settled();const first=sample();b.dataset.sMode='on';await settled();const second=sample();
    b.dataset.sMode='off';await tick();return [first,second,sample()]`,
  )
  assert.deepEqual(got, [0.5, 0.75, 0.5])
})

test('timeline opacity composes with the authored root-scroll reveal', async () => {
  const hero = text('hero', 'Reed', {
    style: { base: { appearAfter: 100 } },
    motion: {
      trigger: 'enter-view',
      steps: [
        {
          ...x,
          from: { opacity: 0.5 },
          to: { opacity: 0.5 },
        },
      ],
    },
  })
  const got = await read(
    siteWith([hero, node('space', 'box')]),
    `
    const el=get('hero');get('space').style.height='3000px';await tick();
    const native=CSS.supports('animation-timeline:scroll()'), out=[];
    for(const y of [0,954,1100,0]){scrollTo(0,y);await tick();out.push(+getComputedStyle(el).opacity)}
    return [native,out]`,
  )
  const [native, values] = got as [boolean, number[]]
  assert.deepEqual(values, native ? [0, 0.25, 0.5, 0] : [0.5, 0.5, 0.5, 0.5])
})

test('the delivered fallback never suppresses an unrelated keyboard or pointer activation', async () => {
  const fallback = {
    trigger: 'scroll',
    scrollFallback: 'timeline',
    effect: 'rise',
  } as const
  const wrap = node('wrap', 'box', [
    text('nested', 'Inside', { motion: fallback }),
  ])
  wrap.style = { base: { overflow: 'scroll-y' } }
  const input = (id: string, trigger: 'hover' | 'press') => {
    const target = text(`${id}label`, id)
    return {
      ...node(id, 'box', [target]),
      motion: { trigger, steps: [{ ...x, target: { id: target.id } }, x] },
    }
  }
  const got = await read(
    siteWith([
      text('native', 'Viewport', { motion: fallback }),
      wrap,
      input('key', 'hover'),
      input('click', 'press'),
    ]),
    `
    const native=CSS.supports('animation-timeline:view()'), out=get('native'), inside=get('nested');
    const view=el=>el.getAnimations().some(a=>a.timeline instanceof ViewTimeline);
    const key=get('key'),click=get('click'),keyTrack=()=>get('keylabel').getAnimations().length,
      pressTrack=()=>get('clicklabel').getAnimations().length;
    key.focus();const focus=keyTrack()===Number(key.matches(':hover,:focus-visible'));
    key.blur();const blur=keyTrack();
    click.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));const keyboard=pressTrack();
    click.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter'}));
    click.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}));const down=pressTrack();
    window.dispatchEvent(new PointerEvent('pointerup'));
    return [native ? view(out)&&!view(inside)&&out.getAnimations().every(a=>a instanceof CSSAnimation):true,
      [...document.scripts].some(s=>s.text.includes('data-culm-motion')),focus,blur,keyboard,down,pressTrack()]`,
  )
  assert.deepEqual(got, [true, true, true, 0, 1, 1, 0])
})
