import { codesPerSecond, finalPass } from './gpuLimiter.ts'

export type Rect = [number, number, number, number]
export type Region = [...Rect, number, number[], boolean]
type Uniforms = Record<string, number[]>
// 0: limited, 1: exact reviewed snapshot, 2: framework builtin + reviewed.
export type Binding = [string, Uniforms, number, string?]
type WasmTuple = [WebAssembly.Memory, (dt: number) => void, () => number]
type Material = [...Binding, number?, WebGLProgram?, (WasmTuple | 0)?]
type Draw = [WebGLProgram, Uniforms, Rect, Uint8Array?]
type Frame = [
  number,
  number,
  Region[],
  number,
  OffscreenCanvas?,
  Material[]?,
  number?,
  number?,
  number?,
  number?,
  number?,
]

/** All effect draws (including reviewed draws) go to private storage. The
 * default framebuffer only receives the checked, completed composite. */
export const acquire = (first: MessageEvent<Frame>) => {
  const canvas = first.data[4]!,
    fail = () => postMessage(-1),
    G = (c: unknown) => {
      if (c) throw 0
    }
  canvas.addEventListener('webglcontextlost', fail)
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    premultipliedAlpha: false,
  })!
  if (!gl) return fail()
  const shader = (kind: number, s: string, o = gl.createShader(kind)!) => (
    gl.shaderSource(o, '#version 300 es\n' + s),
    gl.compileShader(o),
    o
  )
  const vertex = shader(
    35633,
    'void main(){int i=gl_VertexID;gl_Position=vec4(i%2*4-1,i/2*4-1,0,1);}',
  )
  const programs: Record<string, WebGLProgram> = {},
    pending: WebGLProgram[] = []
  function program(body: string, values?: Uniforms, wasm?: string) {
    if (values) {
      let pre = 'uniform sampler2D u_noise' + (wasm ? ',u_field;' : ';')
      for (const k in values) {
        const n = values[k].length
        pre += 'uniform ' + (n < 2 ? 'float' : 'vec' + n) + ' u_' + k + ';'
      }
      body =
        pre +
        body +
        'void main(){vec3 c=shade((gl_FragCoord.xy-u_R)/u_resolution).rgb;u_O=vec4(mix(mix(c,vec3(0),isnan(c)),vec3(0),isinf(c)),1);}'
    }
    let p = programs[body]
    return (
      p ||
      (pending.push((p = programs[body] = gl.createProgram()!)),
      [vertex, shader(35632, 'precision highp float;out vec4 u_O;' + body)].map(
        s => gl.attachShader(p, s),
      ),
      gl.linkProgram(p),
      p)
    )
  }
  const materials = first.data[5]!,
    last = program(finalPass),
    ext = gl.getExtension('KHR_parallel_shader_compile'),
    F = 36160,
    T = 3553
  const targets = [0, 1, 2, 3, 4].map(u => {
    const tex = gl.createTexture(),
      fb = (u & 3 ? gl.createFramebuffer() : tex) as WebGLFramebuffer | null
    G(!tex || !fb)
    let W = 0,
      H = 0
    return (w: number, h: number, d: Uint8Array | null = null) => (
      (d || w ^ W || h ^ H) &&
        (gl.activeTexture(33984 + u),
        gl.bindTexture(T, tex),
        [0, 1, 2, 3].map(k =>
          gl.texParameteri(
            T,
            10240 + k,
            k > 1 ? (u ? 33071 : 10497) : u > 3 ? 9729 : 9728,
          ),
        ),
        gl.texImage2D(
          T,
          0,
          u > 3 ? 33321 : 32856,
          (W = w),
          (H = h),
          0,
          u > 3 ? 6403 : 6408,
          5121,
          d,
        ),
        u & 3 &&
          (gl.bindFramebuffer(F, fb),
          gl.framebufferTexture2D(F, 36064, T, tex, 0))),
      () => (gl.bindFramebuffer(F, fb), gl.viewport(0, 0, w, h))
    )
  })
  targets[0](
    16,
    16,
    new Uint8Array(1024).map((_, i) => (i * 73) ^ ((i >> 2) * 59)),
  )
  let front = 2,
    prev = 0
  const bad = () => gl.getError() || gl.isContextLost()
  function render({
    data: [rw, rh, regions, t, , , scroll, px, py, w = rw, h = rh],
  }: MessageEvent<Frame>) {
    const raw = targets[1](rw, rh),
      out = targets[front ^ 1](w, h)
    targets[front](w, h)
    const draws: Draw[] = [],
      failed: number[] = [],
      dt = Math.max(0, Math.min(0.033, t - prev))
    for (const r of regions) {
      const s4 = r.slice(0, 4) as Rect,
        [, , , , i, seed, keep] = r,
        mat = materials[i],
        [source, settings, rev, wb, before = 0] = mat
      let field: Uint8Array | undefined
      if (wb)
        try {
          G(mat[6] === 0)
          let m = mat[6]
          if (!m) {
            const B = Uint8Array.from(atob(wb), c => c.charCodeAt(0))
            G((B.length - 1) >>> 9)
            const ex = new WebAssembly.Instance(new WebAssembly.Module(B))
                .exports as {
                memory: WebAssembly.Memory
                reset: () => void
                step: (dt: number) => void
                fieldPtr: () => number
              },
              mem = ex.memory
            let g = mem.buffer.byteLength - 65536
            try {
              mem.grow(1)
              g = 1
            } catch {
              /* fixed 1-page maximum throws RangeError */
            }
            G(g)
            ex.reset()
            m = mat[6] = [mem, ex.step, ex.fieldPtr]
          }
          m[1](dt * (settings.set_speed || [1])[0])
          const p = m[2]()
          G(p !== (p | 0))
          field = new Uint8Array(m[0].buffer, p, 1024)
        } catch {
          mat[6] = 0
          failed.push(i)
          continue
        }
      const [X, Y, W, H] = s4.map((v, k) => v * (k & 1 ? rh / h : rw / w))
      const values = Object.assign(
        {
          R: [X, Y],
          resolution: [W, H],
          pointer: [px!, py!],
          time: [t],
          scroll: [scroll!],
        },
        settings,
      )
      const sh = mat[5] || (mat[5] = program(source, values, wb)),
        l = Math.floor(X),
        b = Math.floor(Y),
        after = keep ? before + codesPerSecond * dt : 0
      mat[4] = after % 4
      seed[3] = rev
        ? 2
        : keep
          ? (before | 0) ^ (after | 0)
            ? mat[4] < 1
              ? 4
              : 3
            : -1
          : seed[3]
      draws.push(
        [sh, values, [l, b, Math.ceil(X + W) - l, Math.ceil(Y + H) - b], field],
        [last, { S: seed }, s4],
      )
    }
    const wait = (st: number) =>
      pending.some(p => !gl.getProgramParameter(p, st))
    function ready(): void {
      if (ext && wait(37297)) return void setTimeout(ready, 8)
      if (wait(35714)) return fail()
      pending.length = 0
      out()
      gl.clear(16384)
      gl.enable(3089)
      for (const [p, values, rect, field] of draws) {
        gl.useProgram(p)
        const loc = (k: string) => gl.getUniformLocation(p, 'u_' + k),
          u1 = (k: string, v: number[]) => gl.uniform1iv(loc(k), v)
        if (p === last) u1('T', [1, front])
        if (field) {
          targets[4](32, 32, field)
          u1('field', [4])
        }
        for (const k in values) {
          const v = values[k]
          gl[
            ('uniform' + v.length + 'fv') as
              'uniform1fv' | 'uniform2fv' | 'uniform3fv' | 'uniform4fv'
          ](loc(k), v)
        }
        ;(p === last ? out : raw)()
        gl.scissor(...rect)
        gl.drawArrays(4, 0, 3)
      }
      if (bad()) return fail()
      if (canvas.width ^ w) canvas.width = w
      if (canvas.height ^ h) canvas.height = h
      gl.disable(3089)
      gl.bindFramebuffer(36009, null)
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, 16384, 9728)
      gl.finish()
      front ^= 1
      prev = t
      postMessage(bad() ? -1 : failed.length ? failed : 1)
    }
    ready()
  }
  gl.disable(3024)
  onmessage = render
  render(first)
}
