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

// Maximum slope of inverse sRGB, at white. Ordinary stationary source-over
// layers are contractions in encoded RGB. Carry fractional *code time*, not
// unearned steps, so even 120 Hz makes progress while rounding never compounds.
export const codesPerSecond = (255 * 0.25) / (2.4 / 1.055)

/** Straight RGBA8, fixed presentation grid. Each earned code changes coverage
 * OR straight colour. Both are contractions over an arbitrary stationary
 * background. The ORIGINAL CSS paint is the blend destination. */
export const finalPass = `uniform highp sampler2D A,B;uniform vec4 S;uniform vec2 size;uniform float D;uniform int K;
void main(){vec3 b=texture(A,gl_FragCoord.xy/size).rgb;
vec4 a=texelFetch(B,ivec2(gl_FragCoord.xy),0);
u_O=K==2?vec4(b,1.):K==0?(S.a>0.?S:vec4(b,0.)):a.a<1.&&(K!=3||all(equal(a.rgb,b)))?vec4(a.rgb,min(1.,a.a+D)):vec4(a.rgb+clamp(b-a.rgb,-D,D),a.a);}`
