import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { Problem } from '@culmjs/core'

/** The part of a browser the measure runner uses, over Chrome's DevTools Protocol. */
export type Browser = {
  /** The build string, e.g. `Chrome/158.0.8127.37`. */
  version: string
  newPage(): Promise<Page>
  close(): Promise<void>
}
export type Answer = {
  status?: number
  type: string
  body: Uint8Array | string
}
export type Page = {
  /** Requests the page's answer refused, in order. */
  blocked: string[]
  setViewport(width: number, height: number): Promise<void>
  setScheme(scheme: 'light' | 'dark'): Promise<void>
  /** Every request goes to `fn`; `undefined` fails the request and records its address in `blocked`. Nothing reaches the network. */
  answer(fn: (url: string) => Promise<Answer | undefined>): Promise<void>
  goto(
    url: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; problem?: string }>
  evaluate<T>(expression: string): Promise<T>
  /** A PNG of the page rectangle (page coordinates, beyond the window); the window when no clip is given. */
  screenshot(clip?: {
    x: number
    y: number
    w: number
    h: number
  }): Promise<Uint8Array>
  close(): Promise<void>
}

export type OpenOptions = {
  executable?: string
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /** Defaults to the user's home folder. */
  home?: string
  /** The system Chrome paths to try; defaults to the usual ones of the platform and the names on PATH. */
  system?: string[]
}

const incomplete = (message: string): Problem => ({
  code: 'MEASUREMENT_INCOMPLETE',
  message,
})
const isFile = (p: string) => {
  try {
    if (!statSync(p).isFile()) return false
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}
const dirs = (p: string) => {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

const WAYS =
  'Pass --chrome <path> or set CULM_CHROME to a Chrome or Chromium executable, run `npx playwright install chromium`, or install Google Chrome.'

/** A Chromium that `npx playwright install chromium` left on disk, newest first (headless shell before the full build of one revision). */
function playwrightChromes(o: OpenOptions): string[] {
  const env = o.env ?? process.env
  const home = o.home ?? homedir()
  const base =
    env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0'
      ? env.PLAYWRIGHT_BROWSERS_PATH
      : process.platform === 'darwin'
        ? join(home, 'Library', 'Caches', 'ms-playwright')
        : process.platform === 'win32'
          ? join(
              env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'),
              'ms-playwright',
            )
          : join(home, '.cache', 'ms-playwright')
  const win = process.platform === 'win32' ? '.exe' : ''
  const full =
    process.platform === 'darwin'
      ? 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
      : `chrome${win}`
  const found = dirs(base)
    .map(d => /^(chromium_headless_shell|chromium)-(\d+)$/.exec(d))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => +b[2]! - +a[2]! || (a[1]! < b[1]! ? 1 : -1))
  return found.flatMap(m =>
    dirs(join(base, m[0])).flatMap(sub =>
      sub.startsWith('chrome-')
        ? [
            join(
              base,
              m[0],
              sub,
              m[1] === 'chromium' ? full : `chrome-headless-shell${win}`,
            ),
          ]
        : [],
    ),
  )
}

function systemChromes(o: OpenOptions): string[] {
  if (o.system) return o.system
  const env = o.env ?? process.env
  if (process.platform === 'darwin')
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
  if (process.platform === 'win32')
    return ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map(k =>
      join(env[k] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    )
  return [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ].flatMap(n => (env.PATH ?? '').split(delimiter).map(d => join(d, n)))
}

/** The explicit option, else CULM_CHROME (a missing one is an error, not a reason to look further), else Playwright's Chromium, else the system Chrome. */
function findChrome(o: OpenOptions): { path: string } | { problem: Problem } {
  const env = o.env ?? process.env
  for (const [given, from] of [
    [o.executable, 'The Chrome executable'],
    [env.CULM_CHROME, 'CULM_CHROME'],
  ] as const)
    if (given)
      return isFile(given)
        ? { path: given }
        : {
            problem: incomplete(
              `${from} "${given}" is not an executable file. ${WAYS}`,
            ),
          }
  const path = [...playwrightChromes(o), ...systemChromes(o)].find(isFile)
  return path
    ? { path }
    : {
        problem: incomplete(
          `No Chrome or Chromium was found, so nothing was measured. ${WAYS}`,
        ),
      }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Starts Chrome (headless, its own temporary profile, no port: DevTools over a pipe). Never downloads a browser. */
export async function openBrowser(
  o: OpenOptions = {},
): Promise<
  { ok: true; browser: Browser } | { ok: false; problems: Problem[] }
> {
  const found = findChrome(o)
  if ('problem' in found) return { ok: false, problems: [found.problem] }
  const profile = await mkdtemp(join(tmpdir(), 'culm-chrome-'))
  const args = [
    ...(found.path.includes('headless-shell') ? [] : ['--headless=new']),
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-extensions',
    '--metrics-recording-only',
    '--no-pings',
    '--dns-prefetch-disable',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    // Frames stay in the page's own process, so the one Fetch interception below sees every request of the page, iframes included.
    '--disable-features=IsolateOrigins,site-per-process',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ]
  const child = spawn(found.path, args, {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
  })
  child.on('error', () => {})
  child.stderr?.resume()
  const gone = new Promise<void>(r => child.once('close', () => r()))
  const cleanup = async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
    await gone.catch(() => {})
    await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(
      () => {},
    )
  }
  try {
    const cdp = connect(child)
    const v = await cdp.send('Browser.getVersion', {}, undefined, 15000)
    let closing: Promise<void> | undefined
    const browser: Browser = {
      version: String(v.product ?? 'Chrome'),
      newPage: () => newPage(cdp),
      close: () =>
        (closing ??= (async () => {
          cdp.send('Browser.close', {}, undefined, 2000).catch(() => {})
          await Promise.race([gone, sleep(3000)])
          await cleanup()
        })()),
    }
    return { ok: true, browser }
  } catch (e) {
    await cleanup()
    return {
      ok: false,
      problems: [
        incomplete(
          `Chrome at "${found.path}" did not start: ${e instanceof Error ? e.message : String(e)}`,
        ),
      ],
    }
  }
}

type Json = any // eslint-disable-line @typescript-eslint/no-explicit-any -- CDP results are read by name
type Cdp = {
  send(
    method: string,
    params?: object,
    session?: string,
    ms?: number,
  ): Promise<Json>
  on(session: string, method: string, fn: (p: Json) => void): void
  once(session: string, method: string, ms: number): Promise<Json>
}

/** The DevTools pipe: JSON messages, each ended by a NUL byte, written to fd 3 and read from fd 4. */
function connect(child: ChildProcess): Cdp {
  const out = child.stdio[3] as NodeJS.WritableStream
  const inn = child.stdio[4] as NodeJS.ReadableStream
  out.on('error', () => {})
  let seq = 0
  const calls = new Map<number, { ok(r: Json): void; no(e: Error): void }>()
  const listeners = new Map<string, ((p: Json) => void)[]>()
  const key = (s: string, m: string) => `${s}|${m}`
  let buf = Buffer.alloc(0)
  inn.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    for (let i = buf.indexOf(0); i >= 0; i = buf.indexOf(0)) {
      const m = JSON.parse(buf.subarray(0, i).toString('utf8'))
      buf = buf.subarray(i + 1)
      if (m.id !== undefined) {
        const c = calls.get(m.id)
        calls.delete(m.id)
        if (m.error) c?.no(new Error(m.error.message))
        else c?.ok(m.result)
      } else
        for (const f of [
          ...(listeners.get(key(m.sessionId ?? '', m.method)) ?? []),
        ])
          f(m.params)
    }
  })
  child.once('close', () => {
    for (const c of calls.values()) c.no(new Error('Chrome closed'))
    calls.clear()
  })
  const on: Cdp['on'] = (s, m, fn) => {
    const k = key(s, m)
    listeners.set(k, [...(listeners.get(k) ?? []), fn])
  }
  return {
    on,
    send: (method, params = {}, session, ms = 60000) =>
      new Promise((ok, no) => {
        const id = ++seq
        const timer = setTimeout(() => {
          calls.delete(id)
          no(new Error(`${method} did not answer within ${ms} ms`))
        }, ms)
        calls.set(id, {
          ok: r => (clearTimeout(timer), ok(r)),
          no: e => (clearTimeout(timer), no(e)),
        })
        out.write(
          JSON.stringify({ id, method, params, sessionId: session }) + '\0',
        )
      }),
    once: (s, m, ms) =>
      new Promise((ok, no) => {
        const k = key(s, m)
        const timer = setTimeout(() => {
          listeners.set(
            k,
            (listeners.get(k) ?? []).filter(f => f !== fire),
          )
          no(new Error(`${m} did not happen within ${ms} ms`))
        }, ms)
        const fire = (p: Json) => {
          clearTimeout(timer)
          listeners.set(
            k,
            (listeners.get(k) ?? []).filter(f => f !== fire),
          )
          ok(p)
        }
        on(s, m, fire)
      }),
  }
}

async function newPage(cdp: Cdp): Promise<Page> {
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
  })
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  const s = (method: string, params?: object, ms?: number) =>
    cdp.send(method, params, sessionId, ms)
  await s('Page.enable')
  // WebRTC and sockets are not requests the interception sees: the page has none.
  await s('Page.addScriptToEvaluateOnNewDocument', {
    source:
      "for (const k of ['RTCPeerConnection','webkitRTCPeerConnection','WebSocket','WebSocketStream','EventSource']) delete window[k]",
  })
  const blocked: string[] = []
  return {
    blocked,
    setViewport: (width, height) =>
      s('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    setScheme: scheme =>
      s('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: scheme },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      }),
    async answer(fn) {
      cdp.on(
        sessionId,
        'Fetch.requestPaused',
        async ({ requestId, request }: Json) => {
          try {
            if (/^(data|about|blob):/.test(request.url))
              return void (await s('Fetch.continueRequest', { requestId }))
            const r = await fn(request.url)
            if (!r) {
              blocked.push(request.url)
              return void (await s('Fetch.failRequest', {
                requestId,
                errorReason: 'BlockedByClient',
              }))
            }
            await s('Fetch.fulfillRequest', {
              requestId,
              responseCode: r.status ?? 200,
              responseHeaders: [
                { name: 'Content-Type', value: r.type },
                { name: 'Access-Control-Allow-Origin', value: '*' },
              ],
              body: Buffer.from(r.body).toString('base64'),
            })
          } catch {
            await s('Fetch.failRequest', {
              requestId,
              errorReason: 'Failed',
            }).catch(() => {})
          }
        },
      )
      await s('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    },
    async goto(url, timeoutMs) {
      const loaded = cdp.once(sessionId, 'Page.loadEventFired', timeoutMs)
      loaded.catch(() => {})
      try {
        const nav = await s('Page.navigate', { url }, timeoutMs)
        if (nav.errorText) return { ok: false, problem: String(nav.errorText) }
        await loaded
        return { ok: true }
      } catch (e) {
        return {
          ok: false,
          problem: e instanceof Error ? e.message : String(e),
        }
      }
    },
    async evaluate<T>(expression: string) {
      const r = await s('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails)
        throw new Error(
          String(
            r.exceptionDetails.exception?.description ??
              r.exceptionDetails.text,
          ),
        )
      return r.result.value as T
    },
    async screenshot(clip) {
      const r = await s('Page.captureScreenshot', {
        format: 'png',
        ...(clip
          ? {
              clip: {
                x: clip.x,
                y: clip.y,
                width: clip.w,
                height: clip.h,
                scale: 1,
              },
              captureBeyondViewport: true,
            }
          : {}),
      })
      return Buffer.from(r.data, 'base64')
    },
    async close() {
      await cdp
        .send('Target.closeTarget', { targetId }, undefined, 5000)
        .catch(() => {})
    },
  }
}
