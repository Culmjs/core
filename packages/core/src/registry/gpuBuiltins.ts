import type { GpuEffectDef } from './gpu.ts'

// Shared by registration and the worker packer. The browser never compiles a
// string from the page payload. Bump the identity when this program changes.
export const CONTOURS_ID = 'contours-v1'
export const CONTOURS_SOURCE = `vec4 shade(vec2 uv){
 float ridge=sin(uv.x*24.0+sin(uv.y*9.0)+u_time*u_set_speed);
 return vec4(vec3(0.6+ridge*0.2),1.0);
}`
export const contours: GpuEffectDef = Object.freeze({
  name: 'contours',
  tier: 3,
  source: CONTOURS_SOURCE,
  settings: Object.freeze({
    speed: Object.freeze({ type: 'number', min: 0, max: 2, default: 1 }),
  }),
})
