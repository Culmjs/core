import test from 'node:test'
import assert from 'node:assert/strict'
import { crc32, deflateSync } from 'node:zlib'
import { decodePng } from '../../src/measure/png.ts'

const chunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Encodes `pixels` (channels per pixel) with the filter `kind(y)` on each row. */
function encode(
  w: number,
  h: number,
  ch: 3 | 4,
  pixels: number[],
  kind: (y: number) => number,
  depth = 8,
) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([depth, ch === 4 ? 6 : 2, 0, 0, 0], 8)
  const stride = w * ch
  const rows: number[] = []
  for (let y = 0; y < h; y++) {
    const k = kind(y)
    rows.push(k)
    for (let i = 0; i < stride; i++) {
      const at = (yy: number, ii: number) =>
        yy < 0 || ii < 0 ? 0 : pixels[yy * stride + ii]!
      const [a, b, c] = [at(y, i - ch), at(y - 1, i), at(y - 1, i - ch)]
      const guess = [0, a, b, (a + b) >> 1, paeth(a, b, c)][k]!
      rows.push((pixels[y * stride + i]! - guess) & 255)
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const noise = (n: number) =>
  Array.from({ length: n }, (_, i) => (i * 73 + 11) % 256)

test('every row filter is undone, in RGBA', () => {
  const px = noise(7 * 5 * 4)
  const img = decodePng(encode(7, 5, 4, px, y => y % 5))
  assert.equal(img.width, 7)
  assert.equal(img.height, 5)
  assert.deepEqual([...img.rgba], px)
})

test('RGB gets an opaque alpha', () => {
  const px = noise(3 * 2 * 3)
  const img = decodePng(encode(3, 2, 3, px, y => 4 - y))
  assert.deepEqual([...img.rgba.subarray(0, 4)], [px[0], px[1], px[2], 255])
  assert.equal(img.rgba.length, 3 * 2 * 4)
})

test('a 16-bit PNG, and bytes that are no PNG, throw', () => {
  assert.throws(
    () => decodePng(encode(2, 2, 4, noise(16), () => 0, 16)),
    /8-bit/,
  )
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /PNG/)
})
