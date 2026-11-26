import type { GpuEffectDef } from './gpu.ts'
import { RIPPLE_WASM_BASE64 } from './rippleModule.ts'

// Shared by registration and the trusted comparison build. The checked worker
// receives the validated snapshot. Bump the identity when this program changes.
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

export const RIPPLE_ID = 'ripple-v1'
export const RIPPLE_SOURCE = `vec4 shade(vec2 uv){
 float h=texture(u_field,uv).r;
 return vec4(vec3(0.15+h*0.75),1.0);
}`
export const rippleField: GpuEffectDef = Object.freeze({
  name: 'ripple_field',
  tier: 3,
  source: RIPPLE_SOURCE,
  settings: Object.freeze({
    speed: Object.freeze({ type: 'number', min: 0, max: 2, default: 1 }),
  }),
  wasm: Object.freeze({
    abi: 'field-v1',
    bytesBase64: RIPPLE_WASM_BASE64,
  }),
})
