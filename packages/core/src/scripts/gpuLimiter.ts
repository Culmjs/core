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
export const codesPerSecond = 28.0234375 // (255 * .25) / (2.4 / 1.055)

/** Straight RGBA8, fixed presentation grid. Each earned code changes coverage
 * OR straight colour. Both are contractions over an arbitrary stationary
 * background. The ORIGINAL CSS paint is the blend destination. */
// The .033 s cap earns strictly less than one code. K selects unchanged (-1),
// transparent/solid seed (0/1), reviewed (2), coverage-first (3) or colour-first (4).
export const finalPass =
  'uniform highp sampler2D u_T[2];uniform vec4 u_S;void main(){vec2 p=gl_FragCoord.xy/vec2(textureSize(u_T[1],0));vec4 a=texture(u_T[1],p),b=texture(u_T[0],p);int K=int(u_S.a);u_O=K==2?b:K==1?u_S:K==0?vec4(b.rgb,0):K<0?a:a+(a.a<1.&&(K==3||a.rgb==b.rgb)?vec4(0,0,0,1):vec4(sign(b.rgb-a.rgb),0))/255.;}'
