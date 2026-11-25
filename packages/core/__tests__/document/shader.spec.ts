import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sources } from '../../../../scripts/gpu-spike/shaders.ts'
import {
  checkShader,
  SHADER_LIMITS,
  type ShaderSettings,
} from '../../src/index.ts'

const minimal = 'vec4 shade(vec2 uv){return vec4(uv,0.0,1.0);}'
const speed = { type: 'number', min: 0, max: 2, default: 1 } as const
const shade = (statements: string) =>
  `vec4 shade(vec2 uv){\n${statements}\nreturn vec4(1.0);\n}`
const loop = (n: number, body: string, i = 'i') =>
  `for(int ${i}=0;${i}<${n};${i}++){${body}}`

function cost(source: string, settings: ShaderSettings = {}) {
  const r = checkShader(source, settings)
  assert.deepEqual(r, checkShader(source, settings))
  assert.ok(r.ok, JSON.stringify(r))
  return r.cost
}
function rejects_at_source_line(
  source: string,
  expected: [string, number, number | string, number | string],
  settings: ShaderSettings = {},
) {
  const r = checkShader(source, settings)
  assert.deepEqual(r, checkShader(source, settings))
  assert.ok(!r.ok, source)
  assert.deepEqual([r.rule, r.line, r.measured, r.limit], expected)
}

test('entry and spike sources match the hand ledger exactly', () => {
  assert.deepEqual(cost(minimal), {
    bytes: minimal.length,
    passes: 0,
    reads: 0,
    ops: 1,
  })
  assert.deepEqual(cost(sources.contours, { speed }), {
    bytes: 123,
    passes: 0,
    reads: 0,
    ops: 20,
  })
  assert.deepEqual(cost(sources.mist), {
    bytes: 136,
    passes: 3,
    reads: 0,
    ops: 49,
  })
  rejects_at_source_line(sources.ripple_field, [
    'shader.input',
    2,
    'u_field',
    'declared input',
  ])
})

test('bytes count original UTF-8, including comments and CRLF', () => {
  const prefix = `${minimal}\r\n// ☁🌫`
  const at = prefix + ' '.repeat(4096 - Buffer.byteLength(prefix))
  assert.equal(cost(at).bytes, 4096)
  rejects_at_source_line(at + '!', ['shader.bytes', 2, 4097, 4096])
})

test('rejects_at_source_line: closed syntax and calls, including unused helpers', () => {
  const cases: [string, Parameters<typeof rejects_at_source_line>[1]][] = [
    [
      '/* \r\n * note */\r\nuniform float u_extra;\r\n' + minimal,
      ['shader.input', 3, 'uniform', 'host declarations only'],
    ],
    [
      shade('// position\nfloat v=u_extra;'),
      ['shader.input', 3, 'u_extra', 'declared input'],
    ],
    [
      '// author\n#define N 2\n' + minimal,
      ['shader.directive', 2, '#', 'no directives'],
    ],
    [
      shade('for(int i=0;i<\nu_time;i++){}'),
      ['shader.loop', 3, 'u_time', 'nonnegative decimal int literal'],
    ],
    [
      shade('for(int i=0;i<2;i++){\ni=0;}'),
      ['shader.loop', 3, 'i', 'read-only counter'],
    ],
    [
      shade('for(int i=0;i<2;i++){\nint i=1;}'),
      ['shader.loop', 3, 'i', 'read-only counter'],
    ],
    [
      'float tone(float x){return x;}\nfloat tone(int x){return 0.;}\n' +
        minimal,
      ['shader.call', 2, 'tone', 'unique function'],
    ],
    [
      'float unused(float x){\nreturn mystery(x);}\n' + minimal,
      ['shader.call', 2, 'mystery', 'defined helper or builtin'],
    ],
    [
      'float unused(float x){\nreturn unused(x);}\n' + minimal,
      ['shader.call', 2, 'unused', 'nonrecursive helper'],
    ],
    [
      'float unused(float x){\nreturn x.xx;}\n' + minimal,
      ['shader.type', 2, 'xx', 'valid vector selection'],
    ],
    [
      'float unused(float x){\nreturn vec2(x);}\n' + minimal,
      ['shader.type', 2, 'vec2', 'float'],
    ],
    [shade('vec2 p\n[2];'), ['shader.syntax', 3, '[', ';']],
  ]
  for (const [source, diagnostic] of cases)
    rejects_at_source_line(source, diagnostic)
})

test('host types, shadow-free bindings, constructors, builtin signatures and control flow', () => {
  const settings: ShaderSettings = {
    speed,
    tint: { type: 'color', default: '#a0B1c2' },
  }
  cost(
    `vec3 paint(in vec2 p, float t, vec3 tint){
    float d=length(p)+dot(p,p);
    vec3 col=mix(tint,vec3(d),smoothstep(0.,1.,abs(cos(t))));
    col.rg=clamp(min(col.rg,p),0.,max(1.,t));
    if(d<=t && !(d==0.)){return col;}else return vec3(sin(d));
  }
  vec4 shade(vec2 uv){
    return vec4(paint(u_pointer+u_resolution*uv,u_time+u_scroll*u_set_speed,u_set_tint),1.);
  }`,
    settings,
  )
  for (const body of [
    'float x=u_pointer;',
    'vec2 p=u_scroll;',
    'int x=u_time;',
    'float x=dot(uv,1.);',
    'vec2 p=clamp(1.,uv,uv);',
    'vec4 c=texture(uv,uv);',
    'vec4 c=texture(u_noise,uv,1.);',
    'float x=u_noise;',
    'vec3 c=vec3(uv);',
    'float z=uv.z;',
    'uv.rr=uv;',
    'u_resolution.x=0.;',
    'if(uv) return vec4(1.);',
    'while(false){}',
    'discard;',
    'int n=1; for(int i=0;i<n;i++){}',
  ])
    assert.equal(checkShader(shade(body), {}).ok, false, body)
  for (const source of [
    '',
    'vec3 shade(vec2 uv){return vec3(uv,1.);}',
    'vec4 shade(float uv){return vec4(uv);}',
    'vec4 shade(vec2 uv){if(true)return vec4(uv,0.,1.);}',
    'float f(inout float x){return x;}\n' + minimal,
    'void main(){}\n' + minimal,
    minimal + '\n/* unfinished',
  ])
    assert.equal(checkShader(source, {}).ok, false, source)
})

test('charges_each_call including operands, nested passes and loop control', () => {
  const source =
    'float sampleAt(vec2 uv){return texture(u_noise,uv).r;}\n' +
    shade(
      'float s=0.;\n' + loop(2, loop(3, 's=sampleAt(uv)+sampleAt(uv);', 'j')),
    )
  const c = cost(source)
  assert.equal(c.reads, 12)
  assert.equal(c.passes, 8)
  // init s, outer control 6, two inner controls of 8, six bodies of 22, return ctor
  assert.equal(c.ops, 156)
  const zero = cost(
    shade(loop(0, loop(64, 'return texture(u_noise,uv);', 'j'))),
  )
  assert.deepEqual([zero.passes, zero.reads, zero.ops], [0, 0, 3])
})

test('condition plus per-metric maximum, not the sum or one chosen arm', () => {
  const c = cost(
    shade(`if(u_time<0.){texture(u_noise,uv);}else{${loop(3, 'sin(1.);')}}`),
  )
  assert.deepEqual([c.passes, c.reads, c.ops], [3, 1, 22])
})

test('expression branches pay for the condition and arguments, not both calls', () => {
  const c = cost(`vec4 tap(vec2 p){return texture(u_noise,p);}
    vec4 shade(vec2 uv){
      for(int i=0;i<1;i++);
      return length(uv)>u_time ? tap(uv+u_pointer) : tap(uv*u_resolution);
    }`)
  // 4 loop control + length/comparison + one arm (arithmetic, call, texture).
  assert.deepEqual([c.passes, c.reads, c.ops], [1, 1, 20])
})

test('each work cap is inclusive and independent', () => {
  const passes = (n: number) => shade(loop(n, ''))
  assert.equal(cost(passes(64)).passes, 64)
  rejects_at_source_line(passes(65), ['shader.passes', 2, 65, 64])
  const reads = (n: number) => shade(loop(n, 'texture(u_noise,uv);'))
  assert.equal(cost(reads(16)).reads, 16)
  rejects_at_source_line(reads(17), ['shader.reads', 2, 17, 16])
  // 127 trig calls × 4, a cast, unary negations and the final constructor.
  const ops = (n: number) =>
    shade('sin(1.);'.repeat(127) + `float(${'- '.repeat(n)}1.);`)
  assert.equal(cost(ops(2)).ops, 512)
  rejects_at_source_line(ops(3), ['shader.ops', 3, 513, 512])
  assert.deepEqual(
    [
      SHADER_LIMITS.bytes,
      SHADER_LIMITS.passes,
      SHADER_LIMITS.reads,
      SHADER_LIMITS.ops,
    ],
    [4096, 64, 16, 512],
  )
})

test('settings are bounded even when unused and have finite, typed defaults', () => {
  const settings = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [`s${i}`, speed]),
  )
  cost(minimal, settings)
  rejects_at_source_line(minimal, ['shader.settings', 1, 17, 16], {
    ...settings,
    extra: speed,
  })
  for (const invalid of [
    { constructor: speed },
    { Upper: speed },
    { ['x'.repeat(33)]: speed },
    { t: { ...speed, default: 3 } },
    { t: { ...speed, max: Infinity } },
    { t: { type: 'color' as const, default: 'red' } },
    { t: { ...speed, other: 1 } },
  ])
    assert.equal(checkShader(minimal, invalid as ShaderSettings).ok, false)
})

test('nesting is bounded; flat expressions and summarized helper chains are not parser recursion', () => {
  const grouped = (n: number) =>
    shade(`float v=${'('.repeat(n)}1.${')'.repeat(n)};`)
  cost(grouped(31)) // function block is level 1
  rejects_at_source_line(grouped(32), ['shader.nesting', 2, 33, 32])
  assert.equal(
    cost(shade(`float v=${Array(300).fill('1.').join('+')};`)).ops,
    301,
  )
  let helpers = 'float f0(){return u_time;}\n'
  for (let i = 1; i <= 8; i++)
    helpers += `float f${i}(){return f${i - 1}()+f${i - 1}();}\n`
  cost(helpers + minimal)
  rejects_at_source_line(helpers + shade('f8();'), ['shader.ops', 11, 513, 512])
})
