export {
  BASE_SCRIPT,
  EMAIL_SCRIPT,
  OPEN_SCRIPT,
  STATES_SCRIPT,
  TIMELINE_SCRIPT,
  GPU_HOST_PATH,
  GPU_HOST_SCRIPT,
  GPU_HOST_INTEGRITY,
  GPU_LOADER_SCRIPT,
} from './scriptsMin.ts'
export { hostStates } from './statesHost.ts'
export { hostMotion } from './motionHost.ts'
import { loadGpu } from './gpuLoader.ts'
import { GPU_HOST_PATH, GPU_HOST_INTEGRITY } from './scriptsMin.ts'
/** Public boot uses the same idempotent, preference-aware SRI loader as compiled pages. */
export function hostGpu(doc: Document, win: Window): void {
  loadGpu(
    doc,
    win as Window & typeof globalThis,
    '/' + GPU_HOST_PATH,
    GPU_HOST_INTEGRITY,
  )
}
export type { StatesDoc, StatesWin } from './statesHost.ts'
