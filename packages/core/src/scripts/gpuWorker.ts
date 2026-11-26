import { codesPerSecond, finalPass } from './gpuLimiter.ts'

export type Rect = [number, number, number, number]
export type Region = [...Rect, number, number[], boolean]
type Uniforms = Record<string, number[]>
// 0: limited, 1: exact reviewed snapshot, 2: framework builtin + reviewed.
export type Binding = [string, Uniforms, number]
type Frame = [
  number,
  number,
  Region[],
  number,
  OffscreenCanvas?,
  Binding[]?,
  number?,
  number?,
  number?,
  number?,
  number?,
]

/** All effect draws (including reviewed draws) go to private storage. The
 * default framebuffer only receives the checked, completed composite. */
export const acquire = (first: MessageEvent<Frame>) => {
  const canvas = first.data[4]!
  const fail = () => postMessage(-1)
  canvas.addEventListener('webglcontextlost', fail)
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
  })!
  if (!gl) return fail()
  const shader = (kind: number, src: string) => {
    const s = gl.createShader(kind)!
    gl.shaderSource(s, '#version 300 es\n' + src)
    gl.compileShader(s)
    return s
  }
  const vertex = shader(
    35633,
    'void main(){int i=gl_VertexID;gl_Position=vec4(i==1?3:-1,i==2?3:-1,0,1);}',
  )
  // A complete generated fragment, always starting with "uniform ", is a key.
  const programs: Record<string, WebGLProgram> = {}
  const pending: WebGLProgram[] = []
  function program(body: string, values?: Uniforms) {
    if (values) {
      let prelude = 'uniform sampler2D u_noise;'
      for (const k in values) {
        const n = values[k].length
        prelude += `uniform ${n === 1 ? 'float' : 'vec' + n} u_${k};`
      }
      // Zero invalid components and ignore shader alpha. The RGBA8 work
      // attachment clamps the remaining finite channels to the unit interval.
      body =
        prelude +
        '\n' +
        body +
        '\nvoid main(){vec3 c=shade((gl_FragCoord.xy-u_R)/u_resolution).rgb;u_O=vec4(mix(mix(c,vec3(0),isnan(c)),vec3(0),isinf(c)),1);}'
    }
    if (!programs[body]) {
      const p = (programs[body] = gl.createProgram()!)
      gl.attachShader(p, vertex)
      gl.attachShader(
        p,
        shader(35632, 'precision highp float;out vec4 u_O;' + body),
      )
      gl.linkProgram(p)
      pending.push(p)
    }
    return programs[body]
  }
  // The transfer clones each owner's inputs. The worker-only tail holds that
  // owner's code phase and a reference to its shared linked program.
  const materials: [...Binding, number?, WebGLProgram?][] = first.data[5]!
  const last = program(finalPass)
  const ext = gl.getExtension('KHR_parallel_shader_compile')
  const F = 36160,
    T = 3553
  // Unit 0: noise; 1: raw work; 2/3: display history. Each has a permanent
  // unit and private framebuffer. The display pair exchanges roles, not data.
  // Attachment must follow the texture's first bind, including on Chromium.
  const targets = [0, 1, 2, 3].map(unit => {
    const tex = gl.createTexture(),
      fb = gl.createFramebuffer()
    if (!fb || !tex) throw Error()
    const use = () => gl.bindFramebuffer(F, fb)
    let width = -1,
      height = -1
    return (w: number, h: number, data: Uint8Array | null = null) => {
      if (w !== width || h !== height) {
        gl.activeTexture(33984 + unit)
        gl.bindTexture(T, tex)
        for (const key of [10241, 10240]) gl.texParameteri(T, key, 9728)
        gl.texImage2D(
          T,
          0,
          32856,
          (width = w),
          (height = h),
          0,
          6408,
          5121,
          data,
        )
        use()
        gl.framebufferTexture2D(F, 36064, T, tex, 0)
        if (gl.checkFramebufferStatus(F) !== 36053) throw Error()
      }
      return () => {
        use()
        gl.viewport(0, 0, w, h)
      }
    }
  })
  targets[0](
    16,
    16,
    Uint8Array.from({ length: 1024 }, (_, i) => (i * 73) ^ ((i >> 2) * 59)),
  )
  let front = 2
  let previousTime = 0
  type Draw = [WebGLProgram, Uniforms, () => void, Rect]
  const bad = () => gl.getError() || gl.isContextLost()
  function render({
    data: [rw, rh, regions, t, , , scroll, px, py, w = rw, h = rh],
  }: MessageEvent<Frame>) {
    const raw = targets[1](rw, rh),
      out = targets[front ^ 1](w, h)
    targets[front](w, h)
    const draws: Draw[] = []
    for (const r of regions) {
      const [, , , , i, seed, keep] = r
      const rect = r.slice(0, 4) as Rect
      const [X, Y, W, H] = rect.map((v, k) =>
        k % 2 ? (v * rh) / h : (v * rw) / w,
      )
      const mat = materials[i],
        [source, settings, reviewed, before = 0] = mat
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
      const shader = (mat[4] ||= program(source, values))
      const l = Math.floor(X),
        b = Math.floor(Y)
      const after = keep
        ? before +
          codesPerSecond * Math.max(0, Math.min(0.033, t - previousTime))
        : 0
      // The fractional part is unspent code time; the integer part modulo
      // four selects coverage vs colour. A new placement starts at zero.
      mat[3] = after % 4
      const mode = reviewed
        ? 2
        : !keep
          ? +!!seed.length
          : (before | 0) === (after | 0)
            ? -1
            : mat[3] < 1
              ? 4
              : 3
      draws.push(
        [
          shader,
          values,
          raw,
          [l, b, Math.ceil(X + W) - l, Math.ceil(Y + H) - b],
        ],
        [last, { S: [...(seed.length ? seed : [0, 0, 0]), mode] }, out, rect],
      )
    }
    const waiting = (status: number) =>
      pending.some(p => !gl.getProgramParameter(p, status))
    function ready() {
      // COMPLETION_STATUS_KHR is 0x91b1. Test link success after all programs
      // needed for this submission have completed, including the final pass.
      if (ext && waiting(37297)) return void setTimeout(ready, 8)
      if (waiting(35714)) return fail()
      pending.length = 0
      const full: Rect = [0, 0, w, h]
      out()
      gl.clear(16384)
      gl.enable(3089)
      for (const [p, values, target, rect] of draws) {
        gl.useProgram(p)
        const loc = (k: string) => gl.getUniformLocation(p, k)
        if (p === last) gl.uniform1iv(loc('T'), [1, front])
        for (const k in values) {
          const v = values[k]
          // Numeric settings are scalars and colours triples. Framework inputs
          // use up to four components; the WebGL vector upload matches the GLSL declaration.
          gl[`uniform${v.length as 1 | 2 | 3 | 4}fv` as const](loc('u_' + k), v)
        }
        target()
        gl.scissor(...rect)
        gl.drawArrays(4, 0, 3)
      }
      if (bad()) return fail()
      // Don't clear a currently visible drawing buffer just to *attempt*
      // allocating the new scale. All private draws must have succeeded first.
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      gl.disable(3089)
      gl.bindFramebuffer(36009, null)
      gl.blitFramebuffer(...full, ...full, 16384, 9728)
      gl.finish()
      front ^= 1
      previousTime = t
      postMessage(bad() ? -1 : 1)
    }
    ready()
  }
  gl.disable(3024)
  onmessage = render
  render(first)
}
