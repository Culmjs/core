import type { Frame, Step } from '../document/index.ts'
import { cssEase } from '../scripts/motionEase.ts'
import type { PackedTrack, Scene } from '../scripts/motionHost.ts'
import type { TextPlan } from '../scripts/motionText.ts'

type Part = 'path' | NonNullable<Scene['parts']>[number]['unit']
export type BoundStep = { step: Step; targets: number[]; part?: Part }
type Segment = { start: number; end: number; from: Keyframe; to: Keyframe }
type Channel = { segments: Segment[]; add: boolean; both: boolean }

/** Independent translate axes add to the underlying CSS/WAAPI translate. Each
 * axis has a single piecewise curve per program (no double-add on later steps).
 * Individual properties leave the author's responsive `transform` intact. */
function channels(f: Frame, lastScale: number) {
  const out: Record<string, Keyframe> = {}
  if (f.opacity !== undefined) out.opacity = { opacity: f.opacity }
  if (f.draw !== undefined) out.draw = { strokeDashoffset: String(1 - f.draw) }
  if (f.xPx !== undefined) out.x = { translate: `${f.xPx}px` }
  if (f.xPercent !== undefined) out.x = { translate: `${f.xPercent}%` }
  if (f.yPx !== undefined) out.y = { translate: `0px ${f.yPx}px` }
  if (f.rotateDeg !== undefined) out.rotate = { rotate: `${f.rotateDeg}deg` }
  if (f.scale !== undefined) out.scale = { scale: String(f.scale) }
  if (f.scaleX !== undefined) out.scale = { scale: `${f.scaleX} ${lastScale}` }
  return out
}

/** The visitor receives finished WAAPI frames/timings. Lines/words/letters
 * need a measured count before later steps can be placed on this same clock. */
export function prepareTracks(
  bound: BoundStep[],
  reveals: ReadonlySet<number>,
): Pick<Scene, 'tracks' | 'parts' | 'duration' | 'text'> {
  if (bound.some(b => b.part && b.part !== 'path')) {
    // Fixed elements and each kind of split member have distinct scale
    // histories, even when the packed target token is 0 for all of them.
    const histories = new Map<Part | undefined, Map<number, number>>()
    const text: TextPlan = {}
    for (const { part, step } of bound)
      if (part && part !== 'path')
        text[part] ||=
          !!step.mask &&
          (bound.every(b => b.part === part && b.step.mask) || 'switch')
    const endpoints = new Map<string, string>()
    let clipped: Part | undefined
    return {
      duration: 0,
      tracks: [],
      text,
      parts: bound.map(({ step: s, targets, part }, i) => {
        const unit = part === 'path' ? undefined : part
        // A fixed block already includes all of its child offsets. For text,
        // stamp the prepared local track once per measured group at i * stagger.
        const step = { ...s, delayMs: 0, staggerMs: unit ? 0 : s.staggerMs }
        const scales = histories.get(unit) ?? new Map<number, number>()
        histories.set(unit, scales)
        const next =
          unit && text[unit] === 'switch' && s.mask ? unit : undefined
        let clip: PackedTrack[] | undefined
        if (clipped !== next) {
          const f: Keyframe = {}
          if (clipped) f['--cm-' + clipped] = 'visible'
          if (next) f['--cm-' + next] = 'hidden'
          clip = [
            [[[0, 0]], [f, f], { duration: 0, fill: i ? 'forwards' : 'both' }],
          ]
          clipped = next
        }
        return {
          ...fixedTracks(
            [{ step, targets }],
            unit ? undefined : reveals,
            i === 0,
            scales,
            endpoints,
            unit,
          ),
          delay: s.delayMs ?? 0,
          ...(unit && { unit, stagger: s.staggerMs ?? 0 }),
          ...(s.mask && { mask: true }),
          ...(clip && { clip }),
        }
      }),
    }
  }
  return fixedTracks(bound, reveals, true)
}

function fixedTracks(
  bound: BoundStep[],
  reveals: ReadonlySet<number> | undefined,
  first: boolean,
  scales = new Map<number, number>(),
  endpoints?: Map<string, string>,
  unit?: Part,
) {
  const targets = new Map<number, Map<string, Channel>>()
  let duration = 0
  for (const [index, { step: s, targets: ids }] of bound.entries()) {
    const start = duration + (s.delayMs ?? 0),
      stagger = s.staggerMs ?? 0
    const easing = s.ease && s.ease !== 'linear' ? cssEase(s.ease) : undefined
    for (const [i, id] of ids.entries()) {
      const by = targets.get(id) ?? new Map<string, Channel>()
      targets.set(id, by)
      const last = scales.get(id) ?? 1
      const from = channels(s.from, last),
        to = channels(s.to, last)
      if (s.to.scale !== undefined) scales.set(id, s.to.scale)
      for (const k of Object.keys(from)) {
        // Each dynamically placed block persists. Encode its additive delta
        // against the preceding endpoint of this logical member and axis.
        if (endpoints && (k === 'x' || k === 'y')) {
          const key = `${unit}:${id}:${k}`,
            before = endpoints.get(key)
          const value = (f: Keyframe) => String(f.translate).split(' ').at(-1)!
          endpoints.set(key, value(to[k]))
          if (before)
            for (const f of [from[k], to[k]])
              f.translate =
                (k === 'y' ? '0px ' : '') + `calc(${value(f)} - ${before})`
        }
        const c = by.get(k) ?? {
          segments: [],
          add: k === 'x' || k === 'y',
          both: first && index === 0,
        }
        by.set(k, c)
        if (easing) from[k].easing = easing
        const t = start + i * stagger
        c.segments.push({
          start: t,
          end: t + s.durationMs,
          from: from[k],
          to: to[k],
        })
      }
    }
    duration = start + (ids.length - 1) * stagger + s.durationMs
  }
  const unique = new Map<string, PackedTrack>()
  for (const [id, by] of targets)
    for (const [channel, c] of by) {
      const seg = c.segments,
        delay = seg[0].start,
        span = seg.at(-1)!.end - delay
      const frames: Keyframe[] = []
      const push = (f: Keyframe, time: number) =>
        frames.push(
          seg.length === 1 ? f : { ...f, offset: (time - delay) / span },
        )
      for (const [j, s] of seg.entries()) {
        // Hold a previous endpoint through a gap; equal offsets then permit a jump.
        if (j && seg[j - 1].end < s.start) push(seg[j - 1].to, s.start)
        push(s.from, s.start)
        push(s.to, s.end)
      }
      const options: KeyframeAnimationOptions = {
        duration: span,
        fill: c.both ? 'both' : 'forwards',
        ...(c.add && { composite: 'add' }),
      }
      const reveal = channel === 'opacity' && reveals?.has(id)
      const key = JSON.stringify([frames, options, reveal])
      const track: PackedTrack = unique.get(key) ?? [[], frames, options]
      if (reveal && !track[3])
        track[3] = frames.map(({ opacity, ...f }) => ({
          ...f,
          '--cm-alpha': opacity,
        }))
      track[0].push([id, delay])
      unique.set(key, track)
    }
  return { duration, tracks: [...unique.values()] }
}
