/** Enter-view plays once; scroll seeks reversibly; pointer-x is horizontal progress within the owner, clamped to [0, 1]. */
export type MotionTrigger =
  | 'load'
  | 'enter-view'
  | 'hover'
  | 'press'
  | 'scroll'
  | 'pointer-x'
  | { state: string; is: string }

/** An id names a descendant in the same authored tree and repeat template. */
export type MotionTarget =
  | 'self'
  | 'children'
  | 'lines'
  | 'words'
  | 'letters'
  | 'path'
  | { id: string; part?: 'path' }

export type Frame = {
  opacity?: number
  xPx?: number
  yPx?: number
  xPercent?: number
  scale?: number
  scaleX?: number
  rotateDeg?: number
  draw?: number
}

export type Step = {
  target: MotionTarget
  from: Frame
  to: Frame
  durationMs: number
  /** Measured from the end of the preceding step, including its stagger. */
  delayMs?: number
  staggerMs?: number
  ease?: 'linear' | 'ease-out' | 'expo-out'
  mask?: boolean
}

export type Program =
  { steps: Step[] } | { effect: string; settings?: Record<string, number> }

export type Motion = Program & {
  trigger: MotionTrigger
  pinPx?: number
  scrollFallback?: 'timeline'
}
