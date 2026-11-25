import { constants } from 'node:fs'
import { lstat, open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, type ParseError } from 'jsonc-parser'
import type { CustomEffect, Problem } from '@culmjs/core'
import { descriptorPattern, isObj } from '../shared.ts'
import { resolveFile } from './files.ts'
import { parseFile, type JsonPath } from './jsonc.ts'

// Paths, not shader language rules. Never resolve a path supplied by a descriptor.
const descriptor = new RegExp(descriptorPattern)
const source = /^effects\/[a-z][a-z0-9_]{0,31}\.frag$/
export const shaderPath = (p: string) => descriptor.test(p) || source.test(p)
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT'
const MAX_REFS = 32
// File transport ceiling (including JSONC comments). Normal shader refusals use core's much smaller byte/work limits.
const MAX_FILE = 64 * 1024
/** A deeply nested invalid descriptor may exceed the JSONC parser's call stack.
 * Only the first syntax problem is needed by the loader. */
export function parseDescriptor(text: string): ReturnType<typeof parseFile> {
  let message = `Descriptor exceeds ${MAX_FILE} bytes`
  if (Buffer.byteLength(text) <= MAX_FILE) {
    try {
      return parseFile(text, 1)
    } catch (e) {
      if (!(e instanceof RangeError)) throw e
      message = 'Descriptor is nested too deeply'
    }
  }
  return {
    value: undefined,
    at: () => undefined,
    errors: [{ offset: 0, line: 1, column: 1, message }],
  }
}
export async function shaderParentOk(dir: string) {
  return lstat(join(dir, 'effects')).then(s => s.isDirectory(), missing)
}

/** Distinguish a new path from an inaccessible, linked-out, oversized or non-text input. */
export async function shaderInput(
  dir: string,
  path: string,
): Promise<{ text: string } | { why: string } | undefined> {
  if (!shaderPath(path) || !(await shaderParentOk(dir)))
    return { why: 'not a local effects file' }
  try {
    await lstat(join(dir, path))
    const resolve = () =>
      resolveFile(dir, 'effects', path.slice('effects/'.length))
    const real = await resolve()
    if (!real) return { why: 'not a regular file inside effects/' }
    const f = await open(
      real,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const s = await f.stat()
      const target = await resolve()
      const other = target && (await stat(target))
      if (!s.isFile() || !other || s.dev !== other.dev || s.ino !== other.ino)
        return { why: 'its target changed while being opened' }
      if (s.size > MAX_FILE) return { why: `larger than ${MAX_FILE} bytes` }
      const b = Buffer.alloc(s.size + 1)
      let n = 0
      while (n < b.length) {
        const { bytesRead } = await f.read(b, n, b.length - n, n)
        if (!bytesRead) break
        n += bytesRead
      }
      if (n !== s.size) return { why: 'its size changed while being read' }
      return {
        text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          b.subarray(0, n),
        ),
      }
    } finally {
      await f.close()
    }
  } catch (e) {
    return missing(e) ? undefined : { why: 'cannot be read as UTF-8 text' }
  }
}

function sourceOf(d: unknown) {
  if (
    !isObj(d) ||
    typeof d.name !== 'string' ||
    typeof d.sourceFile !== 'string'
  )
    return
  const rel = `effects/${d.sourceFile}`
  if (source.test(rel) && d.sourceFile === `${d.name}.frag`) return rel
}

/** Read only listed descriptors and their named siblings, never the whole effects/ directory. */
export async function readShaderFiles(
  dir: string,
  files: Map<string, string>,
  refused: Map<string, string>,
) {
  const site = files.get('site.json')
  if (!site) return
  const errors: ParseError[] = []
  const v: unknown = parse(site.replace(/^\uFEFF/, ''), errors, {
    allowTrailingComma: true,
  })
  if (
    errors.length ||
    !isObj(v) ||
    !Object.hasOwn(v, 'customEffects') ||
    !Array.isArray(v.customEffects) ||
    v.customEffects.length > MAX_REFS
  )
    return
  const read = async (path: string) => {
    const r = await shaderInput(dir, path)
    if (r && 'text' in r) files.set(path, r.text)
    else if (r) refused.set(path, r.why)
  }
  for (const path of new Set(v.customEffects)) {
    if (typeof path !== 'string' || !descriptor.test(path)) continue
    await read(path)
    const text = files.get(path)
    const d = text && parseDescriptor(text)
    const frag = d && !d.errors.length && sourceOf(d.value)
    if (frag && !files.has(frag)) await read(frag)
  }
}

export type ShaderFiles = { descriptor: string; source: string }
export function loadShaders(
  refs: unknown,
  files: ReadonlyMap<string, string>,
  origins: ShaderFiles[],
  parse: (file: string) => ReturnType<typeof parseFile>,
  refer: (rel: string, file: string, path: JsonPath) => boolean,
  bad: (
    message: string,
    file: string,
    path: JsonPath,
    code?: Problem['code'],
  ) => void,
): CustomEffect[] {
  const result: CustomEffect[] = []
  if (!Array.isArray(refs) || refs.length > MAX_REFS) {
    bad('customEffects must list at most 32 descriptor files.', 'site.json', [
      'customEffects',
    ])
    return result
  }
  const seen = new Set<string>()
  for (const [i, file] of refs.entries()) {
    const at = ['customEffects', i]
    if (typeof file !== 'string' || !descriptor.test(file)) {
      bad('Expected a descriptor in effects/.', 'site.json', at)
      continue
    }
    if (seen.has(file)) {
      bad('Duplicate effect descriptor.', 'site.json', at)
      continue
    }
    seen.add(file)
    if (refer(file, 'site.json', at)) continue
    if (!files.has(file)) {
      bad(`The descriptor ${file} is missing.`, 'site.json', at)
      continue
    }
    const d = parse(file).value
    if (!isObj(d)) {
      bad('Expected a shader descriptor object.', file, [])
      continue
    }
    const extra = Object.keys(d).find(
      k => !['name', 'settings', 'sourceFile'].includes(k),
    )
    if (extra !== undefined) {
      bad('Unknown shader descriptor field.', file, [extra])
      continue
    }
    const frag = sourceOf(d)
    if (!frag) {
      const nameOk =
        typeof d.name === 'string' && source.test(`effects/${d.name}.frag`)
      const field = nameOk ? 'sourceFile' : 'name'
      bad(
        'Expected a name and its sibling <name>.frag.',
        file,
        Object.hasOwn(d, field) ? [field] : [],
      )
      continue
    }
    if (refer(frag, file, ['sourceFile'])) continue
    const text = files.get(frag)
    if (text === undefined) {
      bad(`The shader ${frag} is missing.`, file, ['sourceFile'])
      continue
    }
    origins.push({ descriptor: file, source: frag })
    result.push({
      name: d.name as string,
      settings: d.settings as CustomEffect['settings'],
      source: text,
    })
  }
  return result
}
