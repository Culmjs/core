// These exact shade() strings travel once per used effect in inert page data.
export const sources = {
  contours: `vec4 shade(vec2 uv){
 float ridge=sin(uv.x*24.0+sin(uv.y*9.0)+u_time*u_set_speed);
 return vec4(vec3(0.6+ridge*0.2),1.0);
}`,
  ripple_field: `vec4 shade(vec2 uv){
 float h=texture(u_field,uv).r;
 return vec4(vec3(0.15+h*0.75),1.0);
}`,
  mist: `vec4 shade(vec2 uv){
 float v=0.0;
 for(int i=0;i<3;i++){
  v=v+sin(uv.x*float(i)+uv.y+u_time);
 }
 return vec4(vec3(0.7+v*0.08),1.0);
}`,
}

export type EffectName = keyof typeof sources
export type Payload = {
  sources: Partial<Record<EffectName, string>>
  module?: string
}
