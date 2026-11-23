import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FetchHosts } from '../src/folder/fetch.ts'

export type How =
  'redirect' | 'drop' | 'slow' | 'huge' | 'foreign' | 'notfont' | number

const woff2 = (tag: string) => Buffer.from(`wOF2${tag}`)
const KIND = {
  robotoslab: 'SERIF',
  monoonly: 'MONOSPACE',
  lato: 'SANS_SERIF',
  lora: 'SERIF',
} as const
/** Static families with the weights they have: Google answers 400 to a request that names one they lack. */
const HAS: Record<string, number[]> = {
  Lato: [100, 300, 400, 700, 900],
  Lora: [400, 500, 600, 700],
}

const G = (body: string) =>
  `<g fill="none" stroke="currentColor" stroke-width="2">${body}</g>`
const SETS: Record<
  string,
  {
    name: string
    spdx: string
    title: string
    url: string
    width?: number
    icons: Record<string, Record<string, unknown>>
    aliases?: Record<string, { parent: string }>
  }
> = {
  lucide: {
    name: 'Lucide',
    spdx: 'ISC',
    title: 'ISC',
    url: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE',
    width: 24,
    icons: {
      camera: {
        body: G(
          '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="3"/>',
        ),
      },
      ...Object.fromEntries(
        Array.from({ length: 70 }, (_, i) => [
          `a${i}`,
          { body: G('<path d="M0 0h1"/>') },
        ]),
      ),
    },
    aliases: { photo: { parent: 'camera' } },
  },
  'fa6-brands': {
    name: 'Font Awesome 6 Brands',
    spdx: 'CC-BY-4.0',
    title: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    icons: {
      github: {
        body: '<path fill="currentColor" d="M0 0h8v8z"/>',
        width: 496,
        height: 512,
      },
    },
  },
  bad: {
    name: 'Bad',
    spdx: 'GPL-3.0',
    title: 'GPL 3.0',
    url: 'https://www.gnu.org/licenses/gpl-3.0.html',
    width: 24,
    icons: { thing: { body: '<path d="M0 0h1"/>' } },
  },
  evil: {
    name: 'Evil',
    spdx: 'MIT',
    title: 'MIT',
    url: 'https://example.org/mit',
    width: 24,
    icons: {
      script: { body: '<script>alert(1)</script><path d="M0 0h1"/>' },
      onload: { body: '<path d="M0 0h1" onload="alert(1)"/>' },
      href: { body: '<path d="M0 0h1" href="https://evil.example/x"/>' },
      url: { body: '<path d="M0 0h1" fill="url(#a)"/>' },
      red: { body: '<path d="M0 0h1" fill="#f00"/>' },
    },
  },
}

function iconify(url: URL, res: ServerResponse) {
  const json = (o: unknown) =>
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(o))
  if (url.pathname === '/iconify/collection') {
    const set = SETS[url.searchParams.get('prefix') ?? '']
    if (!set) return void res.writeHead(404).end('{}')
    return json({
      prefix: url.searchParams.get('prefix'),
      info: {
        name: set.name,
        author: { name: 'Someone', url: 'https://example.org' },
        license: { title: set.title, spdx: set.spdx, url: set.url },
      },
    })
  }
  const m = /^\/iconify\/([a-z0-9-]+)\.json$/.exec(url.pathname)
  const set = m && SETS[m[1]!]
  if (!set) return void res.writeHead(404).end('{}')
  const asked = (url.searchParams.get('icons') ?? '').split(',')
  const icons: Record<string, unknown> = {}
  const aliases: Record<string, unknown> = {}
  const missing: string[] = []
  for (const n of asked) {
    if (set.icons[n]) icons[n] = set.icons[n]
    else if (set.aliases?.[n]) {
      aliases[n] = set.aliases[n]
      icons[set.aliases[n]!.parent] = set.icons[set.aliases[n]!.parent]
    } else missing.push(n)
  }
  return json({
    prefix: m![1],
    ...(set.width ? { width: set.width, height: set.width } : {}),
    icons,
    ...(Object.keys(aliases).length ? { aliases } : {}),
    ...(missing.length ? { not_found: missing } : {}),
  })
}

/**
 * A local stand-in for the Google Fonts endpoints (no network). Serves the css2 reply for `Roboto Slab` (a variable family: one file
 * for every upright weight, one for italic, a latin and a cyrillic block each) and for `Mono Only` (static, no italic: Google's 400).
 * `fail(prefix, how)` makes every later request whose path starts with `prefix` fail that way.
 */
export async function startFake() {
  const hits: string[] = []
  // a second server that must never be reached
  const leaked: string[] = []
  const spy = createServer((req, res) => {
    leaked.push(req.url ?? '')
    res.writeHead(200).end('wOF2')
  })
  await new Promise<void>(r => spy.listen(0, '127.0.0.1', r))
  const other = `http://127.0.0.1:${(spy.address() as AddressInfo).port}`
  const fails = new Map<string, How>()
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname + url.search
    hits.push(path)
    const how = [...fails].find(([p]) => path.startsWith(p))?.[1]
    if (how === 'redirect')
      return void res.writeHead(302, { location: `${other}/leak` }).end()
    if (how === 'drop') return void req.socket.destroy()
    if (how === 'slow') return
    if (typeof how === 'number') return void res.writeHead(how).end('no')
    if (how === 'huge')
      return void res.writeHead(200).end(Buffer.alloc(3 * 1024 * 1024, 'wOF2'))
    const send = (type: string, body: string | Buffer) =>
      res.writeHead(200, { 'content-type': type }).end(body)
    const files = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gstatic`
    if (url.pathname === '/css2') {
      const m = /^([^:]+):ital,wght@(.+)$/.exec(
        url.searchParams.get('family') ?? '',
      )
      if (!m) return void res.writeHead(400).end('bad')
      const name = m[1]!
      const pairs = m[2]!
        .split(';')
        .map(p => p.split(',').map(Number) as [number, number])
      let css = ''
      if (name === 'Roboto Slab') {
        for (const [i, w] of pairs)
          for (const [block, tag] of [
            ['cyrillic', 'cyr'],
            ['latin', 'lat'],
          ] as const) {
            const host =
              how === 'foreign' && block === 'latin'
                ? 'https://evil.example'
                : files
            css += `/* ${block} */\n@font-face {\n  font-family: 'Roboto Slab';\n  font-style: ${i ? 'italic' : 'normal'};\n  font-weight: ${w};\n  font-display: swap;\n  src: url(${host}/s/robotoslab/${tag}-${i ? 'i' : 'n'}.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}\n`
          }
      } else if (name === 'Mono Only') {
        if (pairs.some(([i]) => i))
          return void res.writeHead(400).end('no italic')
        for (const [, w] of pairs)
          css += `/* latin */\n@font-face {\n  font-family: 'Mono Only';\n  font-style: normal;\n  font-weight: ${w};\n  src: url(${files}/s/monoonly/w${w}.woff2) format('woff2');\n}\n`
      } else if (HAS[name]) {
        if (pairs.some(([i, w]) => i || !HAS[name]!.includes(w)))
          return void res.writeHead(400).end('no such weight')
        for (const [, w] of pairs)
          css += `/* latin */\n@font-face {\n  font-family: '${name}';\n  font-style: normal;\n  font-weight: ${w};\n  src: url(${files}/s/${name.toLowerCase()}/w${w}.woff2) format('woff2');\n}\n`
      } else return void res.writeHead(400).end('unknown family')
      return send('text/css', css)
    }
    if (url.pathname.startsWith('/gstatic/s/')) {
      if (url.pathname.includes('/cyr-'))
        return send('font/woff2', woff2('cyr'))
      return send(
        'font/woff2',
        how === 'notfont' ? Buffer.from('<html>') : woff2(url.pathname),
      )
    }
    if (url.pathname.startsWith('/iconify/')) return iconify(url, res)
    if (/^\/gh\/ofl\/(robotoslab|lato|lora)\/OFL\.txt$/.test(url.pathname))
      return send('text/plain', 'SIL OPEN FONT LICENSE Version 1.1 (fake)\n')
    if (url.pathname === '/gh/apache/monoonly/LICENSE.txt')
      return send('text/plain', 'Apache License 2.0 (fake)\n')
    const meta =
      /^\/gh\/(?:ofl|apache)\/(robotoslab|monoonly|lato|lora)\/METADATA\.pb$/.exec(
        url.pathname,
      )
    if (meta)
      return send(
        'text/plain',
        `name: "x"\ncategory: "${KIND[meta[1] as keyof typeof KIND]}"\n`,
      )
    res.writeHead(404).end('not found')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const hosts: FetchHosts = {
    css: base,
    files: `${base}/gstatic`,
    licence: `${base}/gh`,
    icons: `${base}/iconify`,
  }
  return {
    hosts,
    hits,
    leaked,
    fail: (path: string, how: How) => void fails.set(path, how),
    heal: () => fails.clear(),
    close: () =>
      new Promise<void>(r => {
        spy.closeAllConnections()
        spy.close()
        server.closeAllConnections()
        server.close(() => r())
      }),
  }
}
