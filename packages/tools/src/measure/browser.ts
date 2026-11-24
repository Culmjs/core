import { createHash } from 'node:crypto'
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
  setReducedMotion(reduce: boolean): Promise<void>
  /** Emulate a touch device's primary (coarse) pointer. */
  setTouch(enabled: boolean): Promise<void>
  /** Move focus with the browser's normal sequential keyboard navigation. */
  tab(): Promise<void>
  /** Actual browser accessibility names, in tree order. */
  names(role: string): Promise<string[]>
  /** Every console error, uncaught exception and failed request the page logged, in order. */
  errors: string[]
  /** Scripts on or off for the next navigation and after (on by default). */
  setScripts(on: boolean): Promise<void>
  /** For a page that reaches a local server: the page keeps `EventSource`, `WebSocket` and `window.open` (the next navigation on). Call it instead of `answer`, which would intercept every request; a page with no `answer` reaches the network. */
  unblock(): Promise<void>
  /** Every request goes to `fn`; `undefined` fails the request and records its address in `blocked`. Nothing reaches the network. */
  answer(fn: (url: string) => Promise<Answer | undefined>): Promise<void>
  goto(
    url: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; problem?: string }>
  evaluate<T>(
    expression: string,
    options?: { userGesture?: boolean },
  ): Promise<T>
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
    const hub = watch(cdp)
    await cdp.send('Target.setAutoAttach', AUTO)
    let closing: Promise<void> | undefined
    const browser: Browser = {
      version: String(v.product ?? 'Chrome'),
      newPage: () => newPage(cdp, hub),
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
  /** Forgets every listener of a session. */
  drop(session: string): void
}

/** The DevTools pipe: JSON messages, each ended by a NUL byte, written to fd 3 and read from fd 4. */
function connect(child: ChildProcess): Cdp {
  const out = child.stdio[3] as NodeJS.WritableStream
  const inn = child.stdio[4] as NodeJS.ReadableStream
  out.on('error', () => {})
  let seq = 0
  let closed = false
  const calls = new Map<number, { ok(r: Json): void; no(e: Error): void }>()
  const listeners = new Map<string, ((p: Json) => void)[]>()
  const key = (s: string, m: string) => `${s}|${m}`
  const got = (text: string) => {
    const m = JSON.parse(text)
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
  // Only each new chunk is scanned for the NUL; a message is joined once, when it ends.
  let parts: Buffer[] = []
  inn.on('data', (chunk: Buffer) => {
    let start = 0
    for (let i = chunk.indexOf(0); i >= 0; i = chunk.indexOf(0, start)) {
      parts.push(chunk.subarray(start, i))
      const text = Buffer.concat(parts).toString('utf8')
      parts = []
      start = i + 1
      got(text)
    }
    if (start < chunk.length) parts.push(chunk.subarray(start))
  })
  child.once('close', () => {
    closed = true
    for (const c of calls.values()) c.no(new Error('Chrome closed'))
    calls.clear()
  })
  const on: Cdp['on'] = (s, m, fn) => {
    const k = key(s, m)
    listeners.set(k, [...(listeners.get(k) ?? []), fn])
  }
  return {
    on,
    drop: s => {
      for (const k of [...listeners.keys()])
        if (k.startsWith(`${s}|`)) listeners.delete(k)
    },
    send: (method, params = {}, session, ms = 60000) =>
      new Promise((ok, no) => {
        if (closed) return no(new Error('Chrome closed'))
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

/** What a page answers with, and what it was refused: shared by the page and every target that belongs to it (frames, workers). */
type Owner = {
  fn?: (url: string) => Promise<Answer | undefined>
  blocked: string[]
  hooked: Set<string>
  /** Sessions whose children follow this owner. */
  adopted: Set<string>
}
type Hub = {
  owners: Map<string, Owner>
  /** The session of a top-level page, by target id, once Chrome has attached it. */
  slot(targetId: string): { p: Promise<string>; ok(s: string): void }
  forget(targetId: string): void
  /** Attaches what the session's target starts (frames, workers) to the owner's answer. */
  adopt(owner: Owner, session: string): Promise<void>
  /** The page that answered last: a shared or service worker has no opener to ask. ponytail: pages are measured one at a time. */
  last?: Owner
}
const AUTO = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }

/**
 * Every target Chrome starts is attached before it runs. A page of ours is handed to newPage; a window a page opened is closed and listed; a frame in another
 * process, a worker, a shared worker or a service worker gets the same Fetch answer as the page it belongs to before its first request.
 */
function watch(cdp: Cdp): Hub {
  const slots = new Map<string, { p: Promise<string>; ok(s: string): void }>()
  const hub: Hub = {
    owners: new Map(),
    async adopt(owner, session) {
      owner.adopted.add(session)
      cdp.on(session, 'Target.attachedToTarget', ev => void attached(ev, owner))
      await cdp.send('Target.setAutoAttach', AUTO, session)
    },
    forget: id => void slots.delete(id),
    slot(id) {
      let d = slots.get(id)
      if (!d) {
        let ok!: (s: string) => void
        d = { p: new Promise<string>(r => (ok = r)), ok: s => ok(s) }
        slots.set(id, d)
      }
      return d
    },
  }
  // Whatever happens, an attached target is resumed (or closed): a failed setup must not leave it paused.
  const attached = async (ev: Json, parent?: Owner) => {
    const { sessionId, targetInfo: t, waitingForDebugger } = ev
    const resume = () =>
      waitingForDebugger
        ? cdp
            .send('Runtime.runIfWaitingForDebugger', {}, sessionId)
            .catch(() => {})
        : Promise.resolve()
    const close = () =>
      cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {})
    const mine = !parent && t.type === 'page' && !t.openerId
    if (mine) return hub.slot(t.targetId).ok(sessionId) // newPage sets it up and resumes it
    // A target runs only once its requests are covered: by a Fetch hook of its own, or by its frame's (a dedicated worker, a worklet). Else it is closed.
    let covered = false
    try {
      if (!parent && t.type === 'page') {
        // A window the page opened: its requests fail and are listed, it runs just long enough that its opener is not left waiting, then it goes.
        const opener = hub.owners.get(t.openerId) ?? hub.last
        opener?.blocked.push(t.url || 'a window opened by the page')
        const popup: Owner = {
          blocked: opener?.blocked ?? [],
          hooked: new Set(),
          adopted: new Set(),
        }
        await hook(cdp, popup, sessionId)
        await resume()
        covered = true
        return
      }
      const owner = parent ?? hub.last
      if (!owner) return
      if (t.type === 'worker' || t.type === 'worklet') {
        covered = true
        await hub.adopt(owner, sessionId).catch(() => {})
      } else {
        await hook(cdp, owner, sessionId)
        await hub.adopt(owner, sessionId)
        covered = true
      }
      await resume()
    } catch {
      // a target that went away, or one that could not be covered
    } finally {
      if (!covered || (!parent && t.type === 'page')) {
        cdp.drop(sessionId)
        await close()
      }
    }
  }
  cdp.on('', 'Target.attachedToTarget', ev => void attached(ev))
  return hub
}

/** Fetch on a session, answered by the owner's current answer (set again by a second `answer`); a request with no answer fails and is listed. */
async function hook(cdp: Cdp, owner: Owner, session: string) {
  if (owner.hooked.has(session)) return
  owner.hooked.add(session)
  cdp.on(
    session,
    'Fetch.requestPaused',
    async ({ requestId, request }: Json) => {
      const s = (method: string, params: object) =>
        cdp.send(method, params, session)
      try {
        if (/^(data|about|blob):/.test(request.url))
          return void (await s('Fetch.continueRequest', { requestId }))
        let r = await owner.fn?.(request.url)
        // Full Chrome requests a favicon even when the document declares none.
        // The virtual measurement host supplies an empty default locally.
        if (
          request.url === 'https://site.culm.invalid/favicon.ico' &&
          (!r || r.status === 404)
        )
          r = { status: 204, type: 'image/x-icon', body: '' }
        if (!r) {
          owner.blocked.push(request.url)
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
            ...(/^text\/html/i.test(r.type)
              ? [
                  {
                    name: 'Content-Security-Policy',
                    value: scriptPolicy(Buffer.from(r.body).toString('utf8')),
                  },
                ]
              : []),
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
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, session)
}

async function newPage(cdp: Cdp, hub: Hub): Promise<Page> {
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
  })
  let timer: NodeJS.Timeout | undefined
  const sessionId = await Promise.race([
    hub.slot(targetId).p,
    new Promise<never>((_, no) => {
      timer = setTimeout(
        () => no(new Error('Chrome did not attach the new page')),
        15000,
      )
    }),
  ]).finally(() => {
    clearTimeout(timer)
    hub.forget(targetId)
  })
  const s = (method: string, params?: object, ms?: number) =>
    cdp.send(method, params, sessionId, ms)
  const owner: Owner = { blocked: [], hooked: new Set(), adopted: new Set() }
  hub.owners.set(targetId, owner)
  hub.last = owner
  const errors: string[] = []
  let scheme: 'light' | 'dark' | undefined,
    reduce = true
  const media = () =>
    s('Emulation.setEmulatedMedia', {
      features: [
        ...(scheme ? [{ name: 'prefers-color-scheme', value: scheme }] : []),
        {
          name: 'prefers-reduced-motion',
          value: reduce ? 'reduce' : 'no-preference',
        },
      ],
    })
  let guard: { identifier: string }
  const text = (a: Json) =>
    a?.value !== undefined ? String(a.value) : String(a?.description ?? a?.type)
  try {
    await s('Page.enable')
    await s('Log.enable')
    cdp.on(sessionId, 'Runtime.consoleAPICalled', ({ type, args }: Json) => {
      if (type === 'error') errors.push(args.map(text).join(' '))
    })
    cdp.on(
      sessionId,
      'Runtime.exceptionThrown',
      ({ exceptionDetails: e }: Json) =>
        void errors.push(String(e.exception?.description ?? e.text)),
    )
    cdp.on(sessionId, 'Log.entryAdded', ({ entry }: Json) => {
      if (
        entry.source === 'security' &&
        String(entry.text).includes('allow-popups')
      ) {
        owner.blocked.push('a window opened by the page')
        return
      }
      if (entry.level === 'error')
        errors.push(`${entry.text}${entry.url ? ` ${entry.url}` : ''}`)
    })
    // Sockets and WebRTC are not requests the interception sees: the page has none. A window the page opens is not made; the address is listed.
    await s('Runtime.enable')
    await s('Runtime.addBinding', { name: 'culmBlocked' })
    cdp.on(sessionId, 'Runtime.bindingCalled', ({ name, payload }: Json) => {
      if (name === 'culmBlocked') owner.blocked.push(String(payload))
    })
    guard = await s('Page.addScriptToEvaluateOnNewDocument', {
      source:
        "for (const k of ['RTCPeerConnection','webkitRTCPeerConnection','WebSocket','WebSocketStream','EventSource']) delete window[k];" +
        'window.open = u => { window.culmBlocked(String(u)); return null }',
    })
    await hub.adopt(owner, sessionId)
    await s('Runtime.runIfWaitingForDebugger')
  } catch (e) {
    for (const h of [...owner.hooked, ...owner.adopted]) cdp.drop(h)
    cdp.drop(sessionId)
    hub.owners.delete(targetId)
    if (hub.last === owner) hub.last = undefined
    await s('Runtime.runIfWaitingForDebugger').catch(() => {})
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {})
    throw e
  }
  return {
    blocked: owner.blocked,
    errors,
    setScripts: on =>
      s('Emulation.setScriptExecutionDisabled', { value: !on }).then(() => {}),
    unblock: () =>
      s('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: guard.identifier,
      }).then(() => {}),
    setViewport: (width, height) =>
      s('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    setScheme: value => {
      scheme = value
      return media()
    },
    setReducedMotion: value => {
      reduce = value
      return media()
    },
    setTouch: enabled => s('Emulation.setTouchEmulationEnabled', { enabled }),
    async names(role) {
      const { nodes } = await s('Accessibility.getFullAXTree')
      return nodes
        .filter((n: Json) => !n.ignored && n.role?.value === role)
        .map((n: Json) => n.name.value)
    },
    async tab() {
      await s('Page.bringToFront')
      const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }
      await s('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key })
      await s('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
    },
    async answer(fn) {
      owner.fn = fn
      hub.last = owner
      await hook(cdp, owner, sessionId)
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
    async evaluate<T>(expression: string, options?: { userGesture?: boolean }) {
      const r = await s('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: options?.userGesture ?? false,
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
      for (const h of [...owner.hooked, ...owner.adopted]) cdp.drop(h)
      cdp.drop(sessionId)
      hub.owners.delete(targetId)
      if (hub.last === owner) hub.last = undefined
      await cdp
        .send('Target.closeTarget', { targetId }, undefined, 5000)
        .catch(() => {})
    },
  }
}

/**
 * Speculation rules (prefetch, prerender) are loaded by the browser itself, where no interception reaches, and `'unsafe-inline'` allows them. So the page may run
 * only its own inline scripts, named by hash, plus files of its own origin and workers from blob: URLs. A hash is checked against text only, so only a script that runs
 * as JavaScript is hashed, and never one whose text is JSON: Chrome reads rules as strict JSON, so no rules text, written or copied later, matches a hash.
 */
function scriptPolicy(html: string): string {
  const hashes = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs = '', text]) => {
      const t = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i.exec(
        attrs,
      )
      const type = (t ? (t[1] ?? t[2] ?? t[3]!) : '').trim()
      if (!JS_TYPE.test(type)) return false
      try {
        JSON.parse(text!)
        return false
      } catch {
        return true
      }
    })
    .map(([, , text]) => {
      const lf = text!.replace(/\r\n?/g, '\n')
      return `'sha256-${createHash('sha256').update(lf).digest('base64')}'`
    })
  // Apply before the document runs. An intercepted document may use its own
  // scripts, forms and workers, but cannot open an unmeasured browsing context.
  return `sandbox allow-scripts allow-same-origin allow-forms; script-src 'self' blob: ${[...new Set(hashes)].join(' ')}`
}

/** The type values a browser runs as classic or module JavaScript (HTML, "JavaScript MIME type essence match"). */
const JS_TYPE =
  /^(module|(text|application)\/(x-)?(javascript|ecmascript)|text\/javascript1\.[0-5]|text\/(jscript|livescript))?$/i
