// Every element or descendant rule sits inside :where(), so it weighs nothing and any compiled class wins.
const SCHEME_D =
  '--s-brand:var(--s-brand-d);--s-ink:var(--s-ink-d);--s-bg:var(--s-bg-d)'

export const BASE_CSS = [
  ':where(*,*::before,*::after){box-sizing:border-box}',
  ':where(html,body){margin:0}',
  ':where(body){min-height:100vh}',
  '.s-site{--s-brand:var(--s-brand-l);--s-ink:var(--s-ink-l);--s-bg:var(--s-bg-l)}',
  `.s-site.s-scheme-dark{${SCHEME_D}}`,
  `@media (prefers-color-scheme: dark){.s-site.s-scheme-auto{${SCHEME_D}}}`,
  '.s-site{--s-muted:color-mix(in srgb,var(--s-ink) var(--s-muted-ink,66%),var(--s-bg));--s-line:color-mix(in srgb,var(--s-ink) 14%,var(--s-bg));background:var(--s-bg);color:var(--s-ink);font:calc(15px*var(--s-scale,1))/1.6 var(--s-body);min-height:100vh;position:relative;overflow-x:clip;display:flex;flex-direction:column}',
  // The header stays at the top while the page scrolls (not on a short window, where it would eat the page) and the footer sits at the foot of the window when the page is short.
  ':where(.s-site)>:where(main){flex:1 0 auto}',
  '.s-site>.s-header{position:sticky;top:0;z-index:40;background:var(--s-bg)}',
  '@media (max-height:520px){.s-site>.s-header{position:static}}',
  // main repeats the page background so the crawl's measuring code, which reads main, body and html, sees it.
  ':where(.s-site) :where(main){background:var(--s-bg)}',
  ':where(.s-site) :where(a){color:var(--s-brand)}',
  ':where(.s-site) :where(h1,h2,h3,h4,h5,h6){font-family:var(--s-head);margin:0}',
  ':where(.s-site) :where(p,figure){margin:0}',
  ':where(.s-site) :where(img,video,iframe){max-width:100%}',
  ':where(.s-site) :where(p,h1,h2,h3,h4,h5,h6,span,a,li,td,th){overflow-wrap:anywhere}',
  // Header and menu links are plain (the browser underline is for running text); only the open page is marked.
  ':where(.s-site) :where(header a,nav a){text-decoration:none}',
  ':where(.s-site) :where([aria-current=page]){text-decoration:underline;text-underline-offset:4px}',
  ':where(.s-pattern){position:absolute;inset:0;pointer-events:none}',
  ':where([data-s-pattern=glow])::after{content:"";position:absolute;inset:0;background:radial-gradient(220px circle at var(--mx,-999px) var(--my,-999px),color-mix(in srgb,var(--s-brand) 22%,transparent),transparent 70%)}',
  ':where([data-s-pattern=cells])::after{content:"";position:absolute;inset:0;background:radial-gradient(90px circle at var(--mx,-999px) var(--my,-999px),color-mix(in srgb,var(--s-brand) 35%,transparent),transparent 100%);mask:linear-gradient(#000 1px,transparent 1px) 0 0/24px 24px,linear-gradient(90deg,#000 1px,transparent 1px) 0 0/24px 24px}',
  '@media (prefers-reduced-motion: reduce),(pointer: coarse){:where([data-s-pattern])::after{display:none}}',
  ':where(.s-embed-go){position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#111 center/cover no-repeat;color:#fff;text-decoration:none;font:600 14px/1.2 system-ui,sans-serif}',
  ':where(.s-embed-go) :where(img){position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
  ':where(.s-embed-go) :where(span){position:relative;padding:8px 14px;border-radius:999px;background:rgb(0 0 0/.65)}',
  ':where(.s-embed) :where(iframe){position:absolute;inset:0;width:100%;height:100%;border:0}',
  // A compiled class sets display on a layer, so a closed one is hidden with !important (a weighted selector would break the :where rule).
  'dialog:not([open]){display:none!important}',
  // Separate from the dialog rule: a browser without :popover-open drops this one, not both.
  '[popover]:not(:popover-open){display:none!important}',
  // The browser frames popovers and dialogs (border, padding); the widget's own style draws any frame.
  ':where(.s-site) :where([popover],dialog){color:var(--s-ink);background:var(--s-bg);border:0;padding:0}',
  ':where(.s-placeholder){min-height:80px;display:grid;place-items:center;border:1px dashed var(--s-line);border-radius:var(--s-radius);color:var(--s-muted);font-size:13px}',
  ':where(.s-vh){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}',
  ':where(.s-site) :where(button){border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer}',
  // Label tokens: the fallbacks equal what the button inherited before.
  ':where(.s-site) :where(button){font-family:var(--s-label,inherit);text-transform:var(--s-label-case,none);letter-spacing:var(--s-label-track,normal)}',
  ':where(.s-site) :where(input,select,textarea){font:inherit}',
  // A form's own button reads as a button: a line round it, room inside and a faint fill, all from the text colour so any look keeps its own.
  ':where(.s-site) :where(form button[type=submit]){display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:.6em 1.2em;border:1px solid currentColor;border-radius:6px;background:color-mix(in srgb,currentColor 8%,transparent);font-weight:600}',
  ':where(.s-site) :where(button):focus-visible{outline:2px solid var(--s-brand);outline-offset:2px}',
  // Details markers: fixed glyph, no author text in CSS.
  '.s-mk-none>summary,.s-mk-end>summary{list-style:none}',
  '.s-mk-none>summary::-webkit-details-marker,.s-mk-end>summary::-webkit-details-marker{display:none}',
  '.s-mk-end>summary{display:flex;justify-content:space-between;align-items:center;gap:.5em}',
  // A small brand-coloured plus that turns to a minus while open: no box, so it reads on a light or a dark page.
  '.s-mk-end>summary::after{content:"+";flex:none;color:var(--s-brand);font-weight:700;font-size:1.25em;line-height:1}',
  '.s-mk-end[open]>summary::after{content:"\\2212"}',
  ':where(.s-trap){position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
  ':where(.s-sent){margin:0;padding:12px 16px;text-align:center;background:#e8f5e9;color:#14532d;font:500 14px/1.4 system-ui,sans-serif}',
].join('')
