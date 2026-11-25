/** Linear-light reference; callers decode the actual quantized display history. */
export function limitChannel(
  previous: number,
  requested: number,
  elapsedMs: number,
  ratePerSecond: number,
) {
  const unit = (n: number) =>
    Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
  const a = unit(previous),
    b = unit(requested)
  const d = (Math.max(0, Math.min(33, elapsedMs)) * ratePerSecond) / 1000
  return a + Math.min(d, Math.max(-d, b - a))
}

/** Integer RGBA8 display history. Explicit sRGB transfer in both directions;
 * dithering is disabled and the final texture is blitted without conversion. */
export const finalPass = `uniform sampler2D A,B;uniform vec4 S;uniform float D;
vec3 lin(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),greaterThan(c,vec3(.04045)));}
void main(){vec3 a=lin(S.a>0.?texture(B,gl_FragCoord.xy/vec2(textureSize(A,0))).rgb:S.rgb);
vec3 b=lin(texelFetch(A,ivec2(gl_FragCoord.xy),0).rgb);
vec3 c=a+clamp(b-a,-D,D);
u_O=vec4(mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,greaterThan(c,vec3(.0031308))),1.);}`
