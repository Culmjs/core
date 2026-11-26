// Physical-device transport for the local Astro benchmark. Only loopback fixtures
// and newly created tabs are used. Do not force-stop Chrome or clear the profile.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function physicalAndroid() {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    join(homedir(), 'Library', 'Android', 'sdk')
  const standard = join(sdk, 'platform-tools', 'adb')
  const bin = process.env.ADB || (existsSync(standard) ? standard : 'adb')
  const adb = (...args) =>
    execFileSync(bin, ['-d', ...args], {
      encoding: 'utf8',
      timeout: 12000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  try {
    if (adb('get-state') !== 'device') throw Error()
  } catch {
    throw Error(
      'Physical Android run needs exactly one authorized USB phone. Open Chrome on it and confirm USB debugging; no desktop result was substituted.',
    )
  }
  const prop = name => adb('shell', 'getprop', name)
  if (prop('ro.kernel.qemu') === '1' || prop('ro.boot.qemu') === '1')
    throw Error('The handset lane requires physical hardware, not an emulator.')
  const info = {
    manufacturer: prop('ro.product.manufacturer'),
    model: prop('ro.product.model'),
    soc: prop('ro.soc.model'),
    android: prop('ro.build.version.release'),
  }
  const allocated = []
  const allocate = (kind, target) => {
    const value = adb(kind, '--no-rebind', 'tcp:0', target)
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 65535)
      throw Error(`adb ${kind} did not return a dynamic TCP port`)
    const port = Number(value)
    allocated.push([kind, port])
    return port
  }
  return {
    info,
    async connect(chromium) {
      const port = allocate('forward', 'localabstract:chrome_devtools_remote')
      return chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        noDefaults: true,
        timeout: 12000,
      })
    },
    // A fresh device-side origin for each visit; no prior slow flag, stored
    // site data or disk cache from earlier runs can count as a cold start.
    // Retain our port allocations until the end so the OS cannot recycle one.
    visit(localOrigin) {
      const port = allocate('reverse', `tcp:${new URL(localOrigin).port}`)
      return `http://127.0.0.1:${port}`
    },
    close() {
      for (const [kind, port] of allocated.reverse()) {
        try {
          adb(kind, '--remove', `tcp:${port}`)
        } catch {
          console.warn(`Could not remove benchmark adb ${kind} tcp:${port}.`)
        }
      }
    },
  }
}
