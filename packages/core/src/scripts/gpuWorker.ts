import { codesPerSecond, finalPass } from './gpuLimiter.ts'

export type Rect = [number, number, number, number]
export type Region = [...Rect, number, number[], boolean]
export type Binding = [string, Record<string, number | string>, boolean]
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
    'void main(){gl_Position=vec4(vec2((gl_VertexID<<1)&2,gl_VertexID&2)*2.-1.,0,1);}',
  )
  const programs = new Map<string, WebGLProgram>()
  const pending: WebGLProgram[] = []
  function program(body: string) {
    let p = programs.get(body)
    if (!p) {
      p = gl.createProgram()!
      const s = shader(35632, 'precision highp float;out vec4 u_O;\n' + body)
      gl.attachShader(p, vertex)
      gl.attachShader(p, s)
      gl.deleteShader(s)
      gl.linkProgram(p)
      pending.push(p)
      programs.set(body, p)
    }
    return p
  }
  const bindings = first.data[5]!
  const effects: WebGLProgram[] = []
  function effect(i: number) {
    const [source, settings] = bindings[i]
    return (effects[i] ||= program(
      'uniform vec4 u_R;uniform float u_time,u_scroll;uniform vec2 u_resolution,u_pointer;uniform sampler2D u_noise;' +
        Object.entries(settings)
          .map(
            ([k, v]) =>
              `uniform ${typeof v === 'number' ? 'float' : 'vec3'} u_set_${k};`,
          )
          .join('') +
        '\n' +
        source +
        '\nvoid main(){vec3 c=shade((gl_FragCoord.xy-u_R.xy)/u_R.zw).rgb;u_O=vec4(clamp(mix(mix(c,vec3(0),isnan(c)),vec3(0),isinf(c)),0.,1.),1.);}',
    ))
  }
  const last = program(finalPass)
  const ext = gl.getExtension('KHR_parallel_shader_compile')
  const bind = (tex: WebGLTexture | null) => gl.bindTexture(3553, tex)
  const fb = gl.createFramebuffer()
  if (!fb) return fail()
  const frame = (tex: WebGLTexture) => {
    gl.bindFramebuffer(36160, fb)
    gl.framebufferTexture2D(36160, 36064, 3553, tex, 0)
  }
  function texture(w: number, h: number, data: Uint8Array | null = null) {
    const tex = gl.createTexture()
    if (!tex) throw Error()
    bind(tex)
    gl.texParameteri(3553, 10241, 9728)
    gl.texParameteri(3553, 10240, 9728)
    gl.texImage2D(3553, 0, 32856, w, h, 0, 6408, 5121, data)
    return tex
  }
  const noise = texture(
    16,
    16,
    Uint8Array.from(
      { length: 1024 },
      (_, i) => ((i * 73) ^ ((i >> 2) * 59)) & 255,
    ),
  )
  function target(w: number, h: number) {
    const tex = texture(w, h)
    frame(tex)
    if (gl.checkFramebufferStatus(36160) !== 36053) throw Error()
    return { tex, w, h }
  }
  type Target = ReturnType<typeof target>
  function fit(old: Target | undefined, w: number, h: number) {
    if (old && old.w === w && old.h === h) return old
    if (old) gl.deleteTexture(old.tex)
    return target(w, h)
  }
  let prev: Target | undefined,
    next: Target | undefined,
    raw: Target | undefined
  let previousTime = 0
  const credit: number[] = []
  const turn: number[] = []
  let p: WebGLProgram
  const use = (program: WebGLProgram) => gl.useProgram((p = program))
  const u = (k: string) => gl.getUniformLocation(p, k)
  const draw = () => gl.drawArrays(4, 0, 3)
  const render = ({
    data: [rw, rh, regions, t, , , scroll, px, py, w = rw, h = rh],
  }: MessageEvent<Frame>) => {
    gl.activeTexture(33984)
    prev = fit(prev, w, h)
    next = fit(next, w, h)
    raw = fit(raw, rw, rh)
    gl.viewport(0, 0, w, h)
    gl.scissor(0, 0, w, h)
    frame(next.tex)
    gl.clear(16384)
    for (const [x, y, dx, dy, i, seed, keep] of regions) {
      const r: Rect = [x, y, dx, dy]
      const X = (x * rw) / w,
        Y = (y * rh) / h,
        W = (dx * rw) / w,
        H = (dy * rh) / h
      const [, settings, bypass] = bindings[i]
      gl.viewport(0, 0, rw, rh)
      gl.scissor(
        Math.floor(X),
        Math.floor(Y),
        Math.ceil(X + W) - Math.floor(X),
        Math.ceil(Y + H) - Math.floor(Y),
      )
      frame(raw.tex)
      gl.activeTexture(33984)
      bind(noise)
      use(effects[i])
      gl.uniform4fv(u('u_R'), [X, Y, W, H])
      gl.uniform1f(u('u_time'), t)
      gl.uniform1f(u('u_scroll'), scroll!)
      gl.uniform2f(u('u_pointer'), px!, py!)
      gl.uniform2f(u('u_resolution'), W, H)
      for (const [key, v] of Object.entries(settings)) {
        const loc = u('u_set_' + key)
        if (typeof v === 'number') gl.uniform1f(loc, v)
        else
          gl.uniform3fv(
            loc,
            v
              .slice(1)
              .match(/../g)!
              .map(n => parseInt(n, 16) / 255),
          )
      }
      draw()
      {
        use(last)
        gl.viewport(0, 0, w, h)
        gl.scissor(...r)
        frame(next.tex)
        bind(raw.tex)
        gl.activeTexture(33985)
        bind(prev.tex)
        gl.uniform1i(u('B'), 1)
        gl.uniform2f(u('size'), w, h)
        gl.uniform4fv(u('S'), seed.length ? [...seed, 1] : [0, 0, 0, 0])
        const earned = keep
          ? (credit[i] || 0) +
            codesPerSecond * Math.min(0.033, Math.max(0, t - previousTime))
          : 0
        const step = Math.floor(earned)
        credit[i] = earned - step
        turn[i] = keep ? ((turn[i] || 0) + step) % 4 : 0
        gl.uniform1i(u('K'), bypass ? 2 : !keep ? 0 : turn[i] === 0 ? 3 : 1)
        gl.uniform1f(u('D'), step / 255)
        draw()
      }
    }
    if (gl.getError() || gl.isContextLost()) return fail()
    // Don't clear a currently visible drawing buffer just to *attempt*
    // allocating the new scale. All private draws must have succeeded first.
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    gl.scissor(0, 0, w, h)
    gl.bindFramebuffer(36009, null)
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, 16384, 9728)
    gl.finish()
    ;[prev, next] = [next, prev]
    previousTime = t
    postMessage(gl.isContextLost() || gl.getError() ? -1 : 1)
  }
  function poll(msg: MessageEvent<Frame>) {
    for (const r of msg.data[2]) effect(r[4])
    if (
      ext &&
      pending.some(p => !gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR))
    ) {
      setTimeout(() => poll(msg), 8)
      return
    }
    if (pending.some(p => !gl.getProgramParameter(p, 35714))) return fail()
    pending.length = 0
    render(msg)
  }
  gl.enable(3089)
  gl.disable(3024)
  onmessage = poll
  poll(first)
}
