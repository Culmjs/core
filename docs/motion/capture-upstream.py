"""Optional offline replay of the reference column. Requires Python Playwright and Chrome."""
import hashlib
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

root, out = map(Path, sys.argv[1:])
out.mkdir(parents=True, exist_ok=True)
hashes = {
    'gsap.min.js': '92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb',
    'ScrollTrigger.min.js': 'b0b14d67b55b0c43c756ac0b106cfcb09d0879945f6ead64451065b0672916a2',
    'index.html': 'c8df2fc37b15f6b58fdf9e96a67654d60d5d079edffd103d1dedca4cd609a4bd',
    'index.d73f7ad5.css': 'df0fba0ee03bebc6454a74ba5a936dfeb6cce69dc1c84a4a71c9d0ef305b207a',
    'index.e9a2d1b4.js': '97a8d5fe831ce05451fdc0f3993fb14c5f7fc3339c062d298301ffaaf00c47b4',
}
for name, expected in hashes.items():
    if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
        sys.exit(f'Pinned input mismatch: {name}')

# GreenSock docs' Simple example and just the orange tween from Pen WNvVOWw.
box = 'gsap.to(".box", { scrollTrigger: ".box", x: 500, });'
orange = '''gsap.from(".line-2", {
  scrollTrigger: {
    trigger: ".orange", scrub: true, pin: true, start: "top top", end: "+=100%"
  }, scaleX: 0, transformOrigin: "left center", ease: "none"
});'''
assert hashlib.sha256(''.join(orange.split()).encode()).hexdigest() == 'ac99678e1dd992d3f6f19a7b3b9bdb81e4f6ae2a24076dd5431d5d7a13736d38'
css = '*{box-sizing:border-box}body{margin:0;overflow-x:clip}section{height:100vh}.box{width:360px;height:48px;margin-left:24px;background:#243}@media(max-width:600px){.box{margin-left:-240px}}.orange{display:grid;place-items:center}.line-2{width:min(80vw,800px);height:8px;background:#234}'


def answer(route):
    url = route.request.url
    name = url.removeprefix('http://ref.test/')
    if name == 'index.e9a2d1b4.js':
        route.fulfill(content_type='text/javascript', body=(root/name).read_text() + '\nwindow.ScrollTrigger=ha;')
    elif name in hashes:
        route.fulfill(path=root/name)
    elif url.split('/')[-1] == 'webfont.js':
        route.fulfill(content_type='text/javascript', body='window.WebFont={load:o=>o.active()}')
    else:
        route.abort()


def jump(p, y):
    p.evaluate('y=>{scrollTo(0,y);ScrollTrigger.update()}', y)
    p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    print(browser.version)
    for width in (1280, 390):
        for scene in ('box', 'codepen', 'codrops'):
            p = browser.new_page(viewport={'width': width, 'height': 900}, device_scale_factor=1,
                                 reduced_motion='no-preference', service_workers='block')
            p.route('**/*', answer)
            if scene != 'codrops':
                spacer = '<section></section>' * 2
                subject = '<div class=box></div>' if scene == 'box' else '<section class=orange><div class=line-2></div></section>'
                p.set_content(f'<style>{css}</style>{spacer}{subject}{spacer}')
                for lib in ('gsap.min.js', 'ScrollTrigger.min.js'):
                    p.add_script_tag(path=root/lib)
                p.evaluate('gsap.registerPlugin(ScrollTrigger)')
                p.add_script_tag(content=box if scene == 'box' else orange)
                p.evaluate('ScrollTrigger.refresh()')
                p.evaluate('window.ref=ScrollTrigger.getAll()[0];void 0')
                if scene == 'box':
                    jump(p, 1200)
                    samples = [('0ms', 0), ('250ms', .25), ('500ms', .5)]
                else:
                    samples = [('start', 1800), ('half', 2250), ('end', 2700), ('release', 2732)]
            else:
                p.goto('http://ref.test/index.html', wait_until='load')
                p.wait_for_selector('[data-effect11] .char-wrap', state='attached')
                p.evaluate("window.ref=ScrollTrigger.getAll().find(t=>t.trigger.matches('[data-effect11]'));ScrollTrigger.refresh()")
                jump(p, p.evaluate('ref.start+10'))
                p.evaluate("ref.trigger.scrollIntoView({block:'center'})")
                samples = [('0ms', 0), ('100ms', .1), ('500ms', .5), ('1378ms', 1.378)]
                (out / f'codrops-{width}.json').write_text(json.dumps({'scrollY': p.evaluate('scrollY'), 'browser': browser.version}))
            for label, value in samples:
                if scene == 'codepen':
                    jump(p, value)
                else:
                    p.evaluate('t=>{ref.animation.pause().time(t)}', value)
                p.screenshot(path=out / f'{scene}-{width}-{label}.png')
            p.close()
