import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import {
  compilePage,
  type Motion,
  type Step,
  type SiteDocument,
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
const read = async <T>(
  doc: SiteDocument,
  expression: string,
  width = 1280,
  reduced = false,
) => {
  const r = compilePage(doc, 'home', {
    registry: sampleRegistry(),
    mode: 'measure',
  })
  assert.ok(r.ok, JSON.stringify(r.problems))
  const p = await browser.newPage()
  try {
    await p.answer(async url =>
      new URL(url).pathname === '/'
        ? { type: 'text/html', body: r.html }
        : undefined,
    )
    await p.setViewport(width, 900)
    if (reduced) await p.setScheme('light') // measure's scheme emulation also requests reduced motion
    assert.ok((await p.goto('https://site.culm.invalid/', 15000)).ok)
    return await p.evaluate<T>(
      `(async()=>{const get=id=>document.querySelector('[data-id="'+id+'"]');${expression}})()`,
    )
  } finally {
    await p.close()
  }
}
const fade: Step = {
  target: 'self',
  from: { opacity: 0 },
  to: { opacity: 1 },
  durationMs: 500,
}

const moveX: Step = { ...fade, from: { xPx: 0 }, to: { xPx: 100 } }
test('appearAfter keeps its root scroll clock and threshold while translation plays', async () => {
  const owner = text('hero', 'Reed', {
    style: { base: { appearAfter: 100 } },
    motion: { trigger: 'load', steps: [moveX] },
  })
  const got = await read(
    siteWith([owner, node('space', 'box')]),
    `
    get('space').style.height='3000px';const el=get('hero');
    const timed=el.getAnimations().find(a=>a.timeline===document.timeline);
    timed.pause();timed.currentTime=250;
    const out=[];for(const y of [0,954,1100,0]){scrollTo(0,y);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const s=getComputedStyle(el);out.push([s.visibility,+s.opacity,parseFloat(s.translate)])}return out`,
  )
  assert.deepEqual(got, [
    ['hidden', 0, 50],
    ['visible', 0.5, 50],
    ['visible', 1, 50],
    ['hidden', 0, 50],
  ])
  owner.motion = {
    trigger: 'load',
    steps: [{ ...fade, from: { opacity: 0.5 }, to: { opacity: 0.5 } }],
  }
  const opacity = await read(
    siteWith([owner, node('space', 'box')]),
    `
    get('space').style.height='3000px';const out=[];
    for(const y of [0,954,1100,0]){scrollTo(0,y);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      out.push(+getComputedStyle(get('hero')).opacity)}return out`,
  )
  assert.deepEqual(opacity, [0, 0.25, 0.5, 0])
})
test('separate horizontal and vertical owners compose on a child and deactivate independently', async () => {
  const child = text('line', 'Reed', {
    motion: {
      trigger: 'load',
      steps: [{ ...fade, from: { yPx: 0 }, to: { yPx: 200 } }],
    },
  })
  const owner = node('hero', 'column', [child])
  owner.state = [{ name: 'mode', values: 'on-off', initial: 'on' }]
  owner.motion = {
    trigger: { state: 'mode', is: 'on' },
    steps: [{ ...moveX, target: 'children' }],
  }
  const got = await read(
    siteWith([owner]),
    `
    const el=get('line'),parent=get('hero');const read=()=>{for(const a of el.getAnimations()){a.pause();a.currentTime=250}
      const r=el.getBoundingClientRect(),p=parent.getBoundingClientRect();return [r.x-p.x,r.y-p.y]};
    const on=read();parent.dataset.sMode='off';return [on,read()]`,
  )
  assert.deepEqual(got, [
    [50, 100],
    [0, 100],
  ])
})
test('a transformed inline span inside a box actually moves and returns to its inline layout', async () => {
  const child = text('line', 'Reed', {
    props: { level: 'span', runs: [{ text: 'Reed' }] },
    motion: { trigger: { state: 'mode', is: 'on' }, steps: [moveX] },
  })
  const owner = node('hero', 'box', [child])
  owner.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  const got = await read(
    siteWith([owner]),
    `
    const el=get('line'),parent=get('hero'),left=el.getBoundingClientRect().left;
    const box=()=>[getComputedStyle(el).display,el.getBoundingClientRect().left-left];
    const values=[box()];parent.dataset.sMode='on';const a=el.getAnimations()[0];a.pause();
    for(const t of [0,250,500]){a.currentTime=t;values.push(box())}
    parent.dataset.sMode='off';return [...values,box()]`,
  )
  assert.deepEqual(got, [
    ['inline', 0],
    ['inline-block', 0],
    ['inline-block', 50],
    ['inline-block', 100],
    ['inline', 0],
  ])
  child.style = {
    base: { hidden: true },
    when: [{ state: 'mode', is: 'on', decl: { hidden: false } }],
  }
  owner.state[0].initial = 'on'
  const visibility = `
    const p=get('hero'),el=get('line'),s=()=>getComputedStyle(el).display;
    const a=el.getAnimations()[0];if(a){a.pause();a.currentTime=250}const on=[s(),el.getBoundingClientRect().left-p.getBoundingClientRect().left];
    p.dataset.sMode='off';return [on,s(),matchMedia('(prefers-reduced-motion:reduce)').matches]`
  assert.deepEqual(await read(siteWith([owner]), visibility), [
    ['inline-block', 50],
    'none',
    false,
  ])
  assert.deepEqual(await read(siteWith([owner]), visibility, 390, true), [
    ['inline', 0],
    'none',
    true,
  ])
})

test('independent owners can animate different properties of the same rendered child', async () => {
  const child = text('line', 'Reed', {
    motion: {
      trigger: 'load',
      steps: [{ ...fade, from: { xPx: 0 }, to: { xPx: 100 } }],
    },
  })
  const owner = node('hero', 'column', [child])
  owner.state = [{ name: 'mode', values: 'on-off', initial: 'on' }]
  owner.motion = {
    trigger: { state: 'mode', is: 'on' },
    steps: [{ ...fade, target: 'children' }],
  }
  const got = await read(
    siteWith([owner]),
    `
    const el=get('line');
    const sample=()=>{const animations=el.getAnimations();for(const a of animations){a.pause();a.currentTime=250}
      const s=getComputedStyle(el);return [animations.length,s.opacity,s.translate]};
    const active=sample();get('hero').dataset.sMode='off';return [active,sample()]`,
  )
  assert.deepEqual(got, [
    [2, '0.5', '50px'],
    [1, '1', '50px'],
  ])
})

test('quadratic-out hits 375 px at half-time, holds through a delay and composes with authored rotation', async () => {
  const motion: Motion = {
    trigger: 'load',
    steps: [
      { ...fade, from: { xPx: 0 }, to: { xPx: 500 }, ease: 'ease-out' },
      { ...fade, from: { yPx: 0 }, to: { yPx: 100 }, delayMs: 100 },
    ],
  }
  const owner = {
    ...node('hero', 'column', [text('line', 'Reed')]),
    style: { base: { rotate: 15 } },
    motion,
  }
  const got = await read<number[][]>(
    siteWith([owner]),
    `
    const el=get('hero'), animations=el.getAnimations();
    return [0,250,500,550,850,1100].map(t=>{
      for(const a of animations){a.pause();a.currentTime=t}
      const css=getComputedStyle(el), xy=css.translate.split(' ').map(parseFloat);
      return [xy[0],xy[1]??0,new DOMMatrixReadOnly(css.transform).a]
    })`,
  )
  for (const [i, [x, y]] of [
    [0, 0],
    [375, 0],
    [500, 0],
    [500, 0],
    [500, 50],
    [500, 100],
  ].entries()) {
    assert.ok(
      Math.abs(got[i][0] - x) < 0.1 && Math.abs(got[i][1] - y) < 0.1,
      JSON.stringify(got),
    )
    assert.ok(Math.abs(got[i][2] - Math.cos(Math.PI / 12)) < 0.0001)
  }
})
test('a state on the site wrapper does not activate motion shadowed by a local declaration', async () => {
  const state = (initial: string) => [
    { name: 'mode', values: 'on-off' as const, initial },
  ]
  const motion: Motion = { trigger: { state: 'mode', is: 'on' }, steps: [fade] }
  const button = {
    ...node('switch', 'button'),
    props: { label: 'Toggle' },
    on: [{ on: 'click' as const, do: { toggle: 'mode' } }],
  }
  const inner = {
    ...node('inner', 'column', [text('local', 'Local', { motion }), button]),
    state: state('off'),
  }
  const doc = siteWith([inner, text('global', 'Global', { motion })], {
    header: { ...node('header', 'instance'), component: 'banner' },
    components: [
      {
        id: 'banner',
        name: 'Banner',
        props: [],
        variants: [],
        root: {
          ...node('bar', 'column', [text('label', 'Banner')]),
          state: state('on'),
        },
      },
    ],
  })
  const got = await read(
    doc,
    `
    const sample=()=>['global','local'].map(id=>get(id).getAnimations().length);
    const pairs=[sample()];get('switch').click();pairs.push(sample());get('switch').click();pairs.push(sample());
    return pairs`,
  )
  assert.deepEqual(got, [
    [1, 0],
    [1, 1],
    [1, 0],
  ])
})
test('a native two-step descendant scroll animation seeks forward and back over the owner, not the small target', async () => {
  const target = { id: 'line' }
  const doc = siteWith([
    node('before', 'box'),
    {
      ...node('hero', 'column', [
        text('line', 'Reed', {
          motion: {
            trigger: 'load',
            steps: [{ ...fade, from: { xPx: 0 }, to: { xPx: 100 } }],
          },
        }),
      ]),
      style: { base: { overflow: 'scroll-x' } },
      motion: {
        trigger: 'scroll',
        steps: [
          { ...fade, target, to: { opacity: 0.5 } },
          { ...fade, target, from: { opacity: 0.5 } },
        ],
      },
    },
    node('after', 'box'),
  ])
  doc.pages[0].root.style = { base: { overflow: 'clip' } }
  for (const width of [1280, 390]) {
    const got = await read<number[]>(
      doc,
      `
    for(const id of ['before','after'])get(id).style.height='1800px';
    const el=get('hero'),child=get('line');el.style.height='900px';
    const timed=child.getAnimations().find(a=>a.timeline===document.timeline);
    timed.pause();timed.currentTime=250;
    const top=el.getBoundingClientRect().top+scrollY;
    const raf=()=>new Promise(r=>requestAnimationFrame(r)),out=[];
    for(const progress of [0,.25,.5,.75,1,.25]){
      scrollTo({top:top-innerHeight+progress*(innerHeight+el.offsetHeight),behavior:'instant'});
      await raf();await raf();const css=getComputedStyle(child);out.push(+css.opacity);
      if(Math.abs(parseFloat(css.translate)-50)>.01 || css.translate==='none') throw Error(css.translate)
    }
    return out`,
      width,
    )
    for (const [i, p] of [0, 0.25, 0.5, 0.75, 1, 0.25].entries())
      assert.ok(Math.abs(got[i] - p) < 0.01, JSON.stringify(got))
  }
})

test('native support alone never attaches a nested fallback scene to the wrong scrollport', async () => {
  const motion: Motion = {
    trigger: 'scroll',
    scrollFallback: 'timeline',
    steps: [fade],
  }
  const scroller = {
    ...node('scroller', 'column', [text('inside', 'Inside', { motion })]),
    style: { base: { overflow: 'scroll-x' as const } },
  }
  const doc = siteWith([scroller, text('outside', 'Outside', { motion })])
  for (const width of [1280, 390])
    assert.deepEqual(
      await read(
        doc,
        `
    return [CSS.supports('animation-timeline:view()'),...['outside','inside'].map(id=>
      get(id).getAnimations().some(a=>a.timeline instanceof ViewTimeline))]`,
        width,
      ),
      [true, true, false],
    )
})

test('viewport motion seeks on desktop when its owner is hidden on the only scrolling layout', async () => {
  const hero = {
    ...node('hero', 'column', [text('title', 'Reed')]),
    hide: { phone: true as const },
    motion: { trigger: 'scroll', steps: [fade] } satisfies Motion,
  }
  const scroller = {
    ...node('scroller', 'column', [hero]),
    style: { phone: { overflow: 'scroll-x' as const } },
  }
  const doc = siteWith([node('before', 'box'), scroller, node('after', 'box')])
  const sample = `const hero=get('hero');get('before').style.height=get('after').style.height='1800px';hero.style.height='900px';
    const css=getComputedStyle(hero), overflow=getComputedStyle(get('scroller')).overflowX;
    if(!hero.getClientRects().length) return [css.display,hero.getClientRects().length,overflow];
    const top=hero.getBoundingClientRect().top+scrollY,out=[];
    for(const f of [0,.5,1]){scrollTo(0,top-innerHeight+f*(innerHeight+hero.offsetHeight));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));out.push(+css.opacity)}
    return [overflow,...out]`
  assert.deepEqual(await read(doc, sample, 1280), ['visible', 0, 0.5, 1])
  assert.deepEqual(await read(doc, sample, 390), ['none', 0, 'auto'])
})

test('the state that creates a scrollport removes the animated target box', async () => {
  const target = text('title', 'Reed', {
    style: { when: [{ state: 'mode', is: 'on', decl: { hidden: true } }] },
  })
  const hero = node('hero', 'column', [target])
  hero.motion = {
    trigger: 'scroll',
    steps: [{ ...fade, target: { id: 'title' } }],
  }
  const box = node('scroller', 'column', [hero])
  box.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  box.style = {
    when: [{ state: 'mode', is: 'on', decl: { overflow: 'scroll-x' } }],
  }
  const doc = siteWith([node('before', 'box'), box, node('after', 'box')])
  const r = await read(
    doc,
    `
    const box=get('scroller'),hero=get('hero'),target=get('title'),raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    get('before').style.height=get('after').style.height='1800px';hero.style.height='900px';
    const sample=()=>[getComputedStyle(box).overflowX,target.getClientRects().length];
    const out=[sample()],top=hero.getBoundingClientRect().top+scrollY;
    for(const f of [0,.5,1]){scrollTo(0,top-innerHeight+f*(innerHeight+hero.offsetHeight));await raf();out.push(+getComputedStyle(target).opacity)}
    box.dataset.sMode='on';await raf();out.push(sample());box.dataset.sMode='off';await raf();out.push(sample());return out`,
  )
  assert.deepEqual(r, [['visible', 1], 0, 0.5, 1, ['auto', 0], ['visible', 1]])
})

test('a hover clamp has no hidden box to hit-test; an actual state reveal restores one', async () => {
  const extra = text('extra', 'Extra', {
    style: { base: { hidden: true }, hover: { clampLines: 1 } },
  })
  const panel = node('panel', 'column', [text('body', 'Body'), extra])
  panel.motion = { trigger: 'scroll', pinPx: 200, steps: [fade] }
  panel.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  const doc = siteWith([panel])
  const sample = `const el=get('extra'),r=el.getBoundingClientRect();return [getComputedStyle(el).display,el.getClientRects().length,document.elementFromPoint(r.x+1,r.y+1)===el]`
  assert.deepEqual(await read(doc, sample), ['none', 0, false])
  delete panel.motion
  extra.style!.when = [{ state: 'mode', is: 'on', decl: { hidden: false } }]
  assert.deepEqual(
    await read(doc, `get('panel').dataset.sMode='on';${sample}`),
    ['block', 1, true],
  )
})

test('distinct site and local values can show a target inside an active scrollport', async () => {
  const state = (initial: string) => [
    { name: 'mode', values: 'on-off' as const, initial },
  ]
  const target = text('title', 'Reed', {
    style: {
      base: { hidden: true },
      when: [{ state: 'mode', is: 'off', decl: { hidden: false } }],
    },
  })
  target.motion = {
    trigger: 'scroll',
    scrollFallback: 'timeline',
    steps: [fade],
  }
  const scroller = node('scroller', 'column', [target])
  scroller.state = state('on')
  scroller.style = {
    when: [{ state: 'mode', is: 'on', decl: { overflow: 'scroll-x' } }],
  }
  const doc = siteWith([scroller], {
    header: { ...node('head', 'instance'), component: 'banner' },
    components: [
      {
        id: 'banner',
        name: 'Banner',
        props: [],
        variants: [],
        root: {
          ...node('bar', 'column', [text('label', 'Header')]),
          state: state('off'),
        },
      },
    ],
  })
  const r = await read(
    doc,
    `
    const wrap=document.querySelector('.s-site'),box=get('scroller'),target=get('title');
    const sample=()=>[wrap.dataset.sMode,box.dataset.sMode,getComputedStyle(box).overflowX,target.getClientRects().length,target.getAnimations().some(a=>a.timeline instanceof ViewTimeline)];
    const out=[sample()];wrap.dataset.sMode='on';out.push(sample());box.dataset.sMode='off';out.push(sample());return out`,
  )
  assert.deepEqual(r, [
    ['off', 'on', 'auto', 1, false],
    ['on', 'on', 'auto', 0, false],
    ['on', 'off', 'auto', 1, false],
  ])
})
