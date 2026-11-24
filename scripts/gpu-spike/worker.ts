import { type EffectName, type Payload } from './shaders.ts'

export type Region = [EffectName, number, number, number, number]
type Field = {
  memory: WebAssembly.Memory
  reset(): void
  step(dt: number): void
  fieldPtr(): number
}
const vertex = `#version 300 es
out vec2 uv;
void main(){uv=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(uv*2.-1.,0,1);}`
const header = `#version 300 es
precision highp float;
in vec2 uv;out vec4 color;
`
// History stores the quantized sRGB values actually blitted. Decode before
// limiting; encode only the final result. Every fixture goes through this pass.
const limiter = `uniform sampler2D raw,prev;uniform float delta;
vec3 decode(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),greaterThan(c,vec3(.04045)));}
vec3 encode(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,greaterThan(c,vec3(.0031308)));}
void main(){
 vec3 a=decode(texture(prev,uv).rgb),b=decode(texture(raw,uv).rgb);
 color=vec4(encode(a+clamp(b-a,vec3(-delta),vec3(delta))),1.);
}`

async function setup(canvas: OffscreenCanvas, data: Payload) {
  const gl = canvas.getContext('webgl2', { antialias: false })!
  const { TEXTURE_2D: T, FRAMEBUFFER: F, COLOR_BUFFER_BIT: COLOR } = gl
  gl.disable(gl.DITHER)
  function shader(type: number, code: string) {
    const s = gl.createShader(type)!
    gl.shaderSource(s, code)
    gl.compileShader(s)
    return s
  }
  const vs = shader(gl.VERTEX_SHADER, vertex)
  function program(body: string) {
    const p = gl.createProgram()!
    gl.attachShader(p, vs)
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, header + body))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    return p
  }
  const programs = new Map<string, WebGLProgram>()
  for (const [name, src] of Object.entries(data.sources))
    programs.set(
      name,
      program(
        `uniform float u_time,u_set_speed;` +
          (name === 'ripple_field' ? 'uniform sampler2D u_field;' : '') +
          src +
          '\nvoid main(){color=vec4(shade(uv).rgb,1.);}',
      ),
    )
  const lastPass = program(limiter)
  function texture(w: number, h: number, field = false) {
    const tex = gl.createTexture()!
    gl.bindTexture(T, tex)
    for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
      gl.texParameteri(T, key, gl.NEAREST)
    for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
      gl.texParameteri(T, key, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      T,
      0,
      field ? gl.R8 : gl.RGBA8,
      w,
      h,
      0,
      field ? gl.RED : gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )
    return tex
  }
  function target(w: number, h: number) {
    const tex = texture(w, h)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(F, fb)
    gl.framebufferTexture2D(F, gl.COLOR_ATTACHMENT0, T, tex, 0)
    if (gl.checkFramebufferStatus(F) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('framebuffer')
    gl.clearColor(112 / 255, 112 / 255, 112 / 255, 1)
    gl.clear(COLOR)
    return { tex, fb }
  }
  let field: Field | undefined, fieldTex: WebGLTexture | undefined
  if (data.module) {
    const bytes = Uint8Array.from(atob(data.module), c => c.charCodeAt(0))
    const { instance } = await WebAssembly.instantiate(bytes, {})
    field = instance.exports as unknown as Field
    field.reset()
    fieldTex = texture(32, 32, true)
  }
  function surfaces(r: Region) {
    return {
      raw: target(r[3], r[4]),
      a: target(r[3], r[4]),
      b: target(r[3], r[4]),
    }
  }
  const histories: ReturnType<typeof surfaces>[] = []
  let elapsed = 0
  return (regions: Region[], ms: number) => {
    gl.activeTexture(gl.TEXTURE0)
    if (field) {
      field.step(ms / 1000)
      gl.bindTexture(T, fieldTex!)
      gl.texSubImage2D(
        T,
        0,
        0,
        0,
        32,
        32,
        gl.RED,
        gl.UNSIGNED_BYTE,
        new Uint8Array(field.memory.buffer, field.fieldPtr(), 1024),
      )
    }
    gl.bindFramebuffer(F, null)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(COLOR)
    elapsed += ms
    regions.forEach(([name, x, y, w, h], i) => {
      const layers = (histories[i] ??= surfaces(regions[i]))
      gl.viewport(0, 0, w, h)
      gl.bindFramebuffer(F, layers.raw.fb)
      const p = programs.get(name)!
      gl.useProgram(p)
      gl.uniform1f(gl.getUniformLocation(p, 'u_time'), elapsed / 1000)
      gl.uniform1f(gl.getUniformLocation(p, 'u_set_speed'), 1)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(T, fieldTex ?? null)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindFramebuffer(F, layers.b.fb)
      gl.useProgram(lastPass)
      gl.bindTexture(T, layers.raw.tex)
      gl.uniform1i(gl.getUniformLocation(lastPass, 'raw'), 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(T, layers.a.tex)
      gl.uniform1i(gl.getUniformLocation(lastPass, 'prev'), 1)
      gl.uniform1f(
        gl.getUniformLocation(lastPass, 'delta'),
        (0.25 * Math.min(ms, 33)) / 1000,
      )
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, layers.b.fb)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      gl.blitFramebuffer(0, 0, w, h, x, y, x + w, y + h, COLOR, gl.NEAREST)
      ;[layers.a, layers.b] = [layers.b, layers.a]
    })
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost())
      throw new Error('draw')
    gl.flush()
  }
}

let draw: Awaited<ReturnType<typeof setup>>
self.onmessage = async ({ data: { canvas, payload, regions, ms } }) => {
  try {
    if (canvas) draw = await setup(canvas, payload)
    draw(regions, ms)
    self.postMessage(true)
  } catch {
    self.postMessage(false)
  }
}
