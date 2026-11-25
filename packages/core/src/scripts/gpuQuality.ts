export type Quality = {
  scale: 0.25 | 0.5 | 1 | 'fallback'
  fast: number
  slow: number
}

export function nextQuality(state: Quality, frameMs: number): Quality {
  let { scale } = state
  if (scale === 'fallback') return state
  let fast = frameMs <= 16.7 ? state.fast + 1 : 0
  let slow = frameMs > 25 ? state.slow + 1 : 0
  if (slow >= 8 || fast >= 60) {
    scale = slow
      ? scale === 0.25
        ? 'fallback'
        : scale === 1
          ? 0.5
          : 0.25
      : scale === 0.25
        ? 0.5
        : 1
    fast = slow = 0
  }
  return { scale, fast, slow }
}
