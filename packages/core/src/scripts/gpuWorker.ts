// The packer binds this constant to the framework source, never page data.
declare const CONTOURS: string
export type Region = [number, number, number, number, number]
type Frame = [number, number, Region[], number]

// WebGL's standardized wire constants, inlined into the priced worker.
const enum GL {
  Vertex = 0x8b31,
  Fragment = 0x8b30,
  LinkStatus = 0x8b82,
  Scissor = 0x0c11,
  Color = 0x4000,
  Triangles = 4,
}
export function gpuWorker() {
  onmessage = ({ data: canvas }: MessageEvent<OffscreenCanvas>) => {
    const fail = () => postMessage(-1)
    canvas.addEventListener('webglcontextlost', fail)
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false })
    if (!gl) return fail()
    const program = gl.createProgram()!
    const attach = (type: number, src: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, '#version 300 es\n' + src)
      gl.compileShader(shader)
      gl.attachShader(program, shader)
      gl.deleteShader(shader)
    }
    attach(
      GL.Vertex,
      'out vec2 uv;void main(){uv=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(uv*2.-1.,0,1);}',
    )
    attach(
      GL.Fragment,
      `precision highp float;in vec2 uv;uniform float u_time,u_set_speed;out vec4 c;${CONTOURS}\nvoid main(){c=shade(uv);}`,
    )
    const ext = gl.getExtension('KHR_parallel_shader_compile')
    gl.linkProgram(program)
    const poll = () => {
      if (ext && !gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR)) {
        setTimeout(poll, 8)
        return
      }
      if (!gl.getProgramParameter(program, GL.LinkStatus)) return fail()
      gl.useProgram(program)
      gl.enable(GL.Scissor)
      const uniform = (k: string) => gl.getUniformLocation(program, k)
      const time = uniform('u_time'),
        speed = uniform('u_set_speed')
      onmessage = ({ data: [w, h, regions, t] }: MessageEvent<Frame>) => {
        if (canvas.width !== w) canvas.width = w
        if (canvas.height !== h) canvas.height = h
        gl.scissor(0, 0, w, h)
        gl.clear(GL.Color)
        gl.uniform1f(time, t)
        for (const [x, y, width, height, s] of regions) {
          gl.viewport(x, y, width, height)
          gl.scissor(x, y, width, height)
          gl.uniform1f(speed, s)
          gl.drawArrays(GL.Triangles, 0, 3)
        }
        // Only acknowledge completed GPU work. The main thread clocks the
        // interval to the next available display opportunity and owns the deadline.
        gl.finish()
        postMessage(gl.isContextLost() || gl.getError() ? -1 : 1)
      }
      postMessage(0)
    }
    poll()
  }
}
