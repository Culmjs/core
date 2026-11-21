import {
  applyEdits,
  createScanner,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  type FormattingOptions,
  type Node,
  type ParseError,
} from 'jsonc-parser'

export type JsonPath = (string | number)[]
/** line and column count from 1; offset counts characters of the whole text, a byte order mark included */
export type Place = { offset: number; line: number; column: number }

// jsonc-parser's SyntaxKind is a const enum, unusable under isolatedModules
const COMMA = 5
const EOF = 17
const BOM = '﻿'
const split = (text: string) =>
  text.startsWith(BOM) ? ([BOM, text.slice(1)] as const) : (['', text] as const)

const placeOf = (body: string, offset: number, bom: number): Place => {
  const before = body.slice(0, offset)
  const line = before.split('\n').length
  return {
    offset: offset + bom,
    line,
    column: offset - (before.lastIndexOf('\n') + 1) + 1,
  }
}

/** `at` points at the key when the path ends in a key, at the value when it ends in an index. */
export function parseFile(text: string): {
  value: unknown
  at(path: JsonPath): Place | undefined
  errors: (Place & { message: string })[]
} {
  const [bom, body] = split(text)
  const errs: ParseError[] = []
  const tree = parseTree(body, errs, { allowTrailingComma: true })
  const errors = errs.map(e => ({
    ...placeOf(body, e.offset, bom.length),
    message: printParseErrorCode(e.error),
  }))
  return {
    value: parse(body, [], { allowTrailingComma: true }),
    errors,
    at(path) {
      if (!tree) return undefined
      const node = findNodeAtLocation(tree, path)
      if (!node) return undefined
      const target =
        node.parent?.type === 'property' ? node.parent.children![0]! : node
      return placeOf(body, target.offset, bom.length)
    },
  }
}

// ponytail: indent is read from the first indented line; a file that mixes styles gets the first one.
const formatOf = (body: string): FormattingOptions => {
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const m = /^([ \t]+)(?![*]|\/[/*])\S/m.exec(body)
  if (!m) return { insertSpaces: true, tabSize: 2, eol }
  if (m[1]!.startsWith('\t')) return { insertSpaces: false, tabSize: 1, eol }
  return { insertSpaces: true, tabSize: m[1]!.length, eol }
}

// A path the file cannot take: a step runs through a scalar, or a key step meets an array / an index step meets an object.
const blocked = (root: Node, path: JsonPath): boolean => {
  for (let i = 0; i < path.length; i++) {
    const node = findNodeAtLocation(root, path.slice(0, i))
    if (!node) return false
    const want = typeof path[i] === 'number' ? 'array' : 'object'
    if (node.type !== want) return true
  }
  return false
}

const parsed = (body: string): Node | undefined => {
  const errs: ParseError[] = []
  const tree = parseTree(body, errs, { allowTrailingComma: true })
  return errs.length ? undefined : tree
}

/**
 * An array insert that touches no other byte: the new element's text goes at the insertion point, between the elements around it.
 * The separator follows the array's own style (`, ` in a one-line array; a new line and the elements' indent in a multi-line one),
 * and a comment on the same line as an element stays with it. Undefined for an empty array, which the caller formats.
 */
function spliceInsert(
  body: string,
  arr: Node,
  index: number,
  value: unknown,
): string | undefined {
  const kids = arr.children ?? []
  if (!kids.length) return undefined
  const i = Math.min(index, kids.length)
  const fmt = formatOf(body)
  const eol = fmt.eol!
  const unit = fmt.insertSpaces ? ' '.repeat(fmt.tabSize!) : '\t'
  const between = (a: number, b: number) => body.slice(a, b).includes('\n')
  const multi =
    between(arr.offset, kids[0]!.offset) ||
    (kids.length > 1 &&
      between(kids[0]!.offset + kids[0]!.length, kids[1]!.offset))
  const ref = kids[Math.min(i, kids.length - 1)]!
  const lead = body.slice(
    body.lastIndexOf('\n', ref.offset - 1) + 1,
    ref.offset,
  )
  const indent = /^[ \t]*$/.test(lead) ? lead : unit
  const one = JSON.stringify(value)
  const text = multi
    ? JSON.stringify(value, null, fmt.insertSpaces ? fmt.tabSize : '\t')
        .split('\n')
        .join(eol + indent)
    : one
  const sep = multi ? eol + indent : ' '
  if (i === 0) {
    const first = kids[0]!.offset
    return body.slice(0, first) + text + ',' + sep + body.slice(first)
  }
  const prev = kids[i - 1]!
  const end = prev.offset + prev.length
  // the comma after the previous element, found past any comment or line break
  const sc = createScanner(body, true)
  sc.setPosition(end)
  const comma = sc.scan() === COMMA ? sc.getTokenOffset() : -1
  const same = /^[ \t]*(?:\/\/[^\r\n]*|\/\*[^\r\n]*?\*\/)?/
  if (comma >= 0 || i < kids.length) {
    // the previous element has its comma: the new one takes a comma too, and the next element's text is untouched
    const after = (comma >= 0 ? comma : end) + 1
    const at =
      after + (/^[ \t]*\/\/[^\r\n]*/.exec(body.slice(after))?.[0].length ?? 0)
    return body.slice(0, at) + sep + text + ',' + body.slice(at)
  }
  // the last element has none yet: it gets its comma right after it, before any comment on its line
  const at = end + same.exec(body.slice(end))![0].length
  return (
    body.slice(0, end) + ',' + body.slice(end, at) + sep + text + body.slice(at)
  )
}

/** The text when it parses without error, else undefined: no edit ever hands back JSON that does not parse. */
export const onlyIfValid = (text: string): string | undefined => {
  const [, body] = split(text)
  return parsed(body) ? text : undefined
}

const change = (
  text: string,
  path: JsonPath,
  value: unknown,
  insert: boolean,
): string | undefined => {
  const [bom, body] = split(text)
  const tree = parsed(body)
  if (!tree || path.length === 0 || blocked(tree, path)) return undefined
  try {
    const last = path[path.length - 1]
    let isArrayInsertion = insert
    if (!isArrayInsertion && typeof last === 'number') {
      const arr = findNodeAtLocation(tree, path.slice(0, -1))
      isArrayInsertion = arr?.type === 'array' && last >= arr.children!.length
    }
    if (isArrayInsertion && typeof last === 'number') {
      const arr = findNodeAtLocation(tree, path.slice(0, -1))
      const done =
        arr?.type === 'array' ? spliceInsert(body, arr, last, value) : undefined
      if (done !== undefined) return onlyIfValid(bom + done)
    }
    const edits = modify(body, path, value, {
      formattingOptions: formatOf(body),
      isArrayInsertion,
    })
    return onlyIfValid(bom + applyEdits(body, edits))
  } catch {
    return undefined
  }
}

/**
 * Inserts when the last step is an array index one past the end, or when `insert` is set.
 * Returns undefined, and never throws, when the edit cannot be made: the text has a syntax
 * error, or the path runs through a scalar or a container of the other kind.
 */
export const editFile = (
  text: string,
  path: JsonPath,
  value: unknown,
  opts: { insert?: boolean } = {},
): string | undefined => change(text, path, value, opts.insert ?? false)

/**
 * Removes a key (with its comma) or an array element. jsonc-parser's own removal eats the
 * comment above the next sibling and reformats it, so this cuts only the entry itself, its
 * comma and, when it has its own lines, those lines.
 * Returns undefined, and never throws, when the text has a syntax error or the path does not exist.
 */
export function removeAt(text: string, path: JsonPath): string | undefined {
  const [bom, body] = split(text)
  const tree = parsed(body)
  const node = tree && findNodeAtLocation(tree, path)
  if (!node?.parent) return undefined
  const entry = node.parent.type === 'property' ? node.parent : node
  const container = entry.parent!
  const idx = container.children!.indexOf(entry)
  let start = entry.offset
  let end = entry.offset + entry.length
  // the comma after the entry, found past any comment or line break
  const cs = createScanner(body, true)
  cs.setPosition(end)
  const comma = cs.scan() === COMMA
  if (comma) end = cs.getTokenOffset() + 1
  let cut: [number, number][] = []
  if (!comma && idx > 0) {
    const prev = container.children![idx - 1]!
    const from = prev.offset + prev.length
    const sc = createScanner(body, false)
    sc.setPosition(from)
    for (
      let t = sc.scan();
      t !== EOF && sc.getTokenOffset() < start;
      t = sc.scan()
    )
      if (t === COMMA) cut.push([sc.getTokenOffset(), sc.getTokenOffset() + 1])
  }
  const lineStart = body.lastIndexOf('\n', start - 1) + 1
  const rest = /^[ \t]*(\/\/[^\n]*)?\r?(\n|$)/.exec(body.slice(end))
  if (rest && /^[ \t]*$/.test(body.slice(lineStart, start)) && lineStart > 0) {
    start = lineStart
    end += rest[0].length
  } else if (cut.length && /^\s*$/.test(body.slice(cut[0]![1], start))) {
    // inline last element: take the space after the previous comma with it
    cut[0]![1] = end
    start = end
  } else {
    end += /^[ \t]*/.exec(body.slice(end))![0].length
  }
  if (start !== end) cut.push([start, end])
  cut = cut.sort((a, b) => b[0] - a[0])
  let out = body
  for (const [a, b] of cut) out = out.slice(0, a) + out.slice(b)
  return onlyIfValid(bom + out)
}
