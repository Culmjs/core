import { inflateSync } from 'node:zlib'

export type Image = { width: number; height: number; rgba: Uint8Array }

/** Decodes the PNGs Chrome writes: 8-bit RGB or RGBA, not interlaced. Anything else throws. */
export function decodePng(png: Uint8Array): Image {
  const b = Buffer.from(png)
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47)
    throw new Error('Not a PNG.')
  let width = 0
  let height = 0
  let channels = 0
  let sawIhdr = false
  const idat: Buffer[] = []
  for (let p = 8; p < b.length;) {
    if (p + 8 > b.length) throw new Error('Truncated PNG chunk.')
    const len = b.readUInt32BE(p)
    if (p + 12 + len > b.length) throw new Error('Truncated PNG chunk.')
    const type = b.toString('latin1', p + 4, p + 8)
    const data = b.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      if (len < 13) throw new Error('Invalid PNG header.')
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (width === 0 || height === 0 || width * height > 100_000_000)
        throw new Error('Invalid PNG dimensions.')
      const [depth, color, , , interlace] = data.subarray(8, 13)
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0)
        throw new Error(
          'Only 8-bit RGB and RGBA PNGs that are not interlaced are read.',
        )
      channels = color === 6 ? 4 : 3
      sawIhdr = true
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (!sawIhdr) throw new Error('Missing PNG header.')
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  if (raw.length < height * (stride + 1))
    throw new Error('Truncated PNG pixel data.')
  const rgba = new Uint8Array(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const kind = raw[y * (stride + 1)]!
    if (kind > 4) throw new Error(`Row ${y} has the unknown filter ${kind}.`)
    const row = Buffer.from(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
    )
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0
      const up = prev[i]!
      const c = i >= channels ? prev[i - channels]! : 0
      const guess =
        kind === 1
          ? a
          : kind === 2
            ? up
            : kind === 3
              ? (a + up) >> 1
              : kind === 4
                ? paeth(a, up, c)
                : 0
      row[i] = (row[i]! + guess) & 255
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      for (let k = 0; k < 3; k++) rgba[o + k] = row[x * channels + k]!
      rgba[o + 3] = channels === 4 ? row[x * 4 + 3]! : 255
    }
    prev = row
  }
  return { width, height, rgba }
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
