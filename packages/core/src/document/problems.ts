export const CODES = [
  'INVALID_DOCUMENT',
  'INVALID_NODE',
  'UNKNOWN_KIND',
  'UNKNOWN_COMPONENT',
  'UNKNOWN_BLOCK',
  'UNKNOWN_SOURCE',
  'RESOURCE_LIMIT_EXCEEDED',
  'POLICY_VIOLATION',
  'REVISION_CONFLICT',
  'INVALID_OPERATION',
  'KEY_CONFLICT',
  'SOURCE_CONFLICT',
  'UNSUPPORTED_CAPABILITY',
  'MEASUREMENT_INCOMPLETE',
  'FETCH_FAILED',
] as const

export type Code = (typeof CODES)[number]

export type Problem = {
  code: Code
  message: string
  nodeId?: string
  path?: string
  allowed?: readonly string[]
  rule?: string
  /** One-based line in authored shader source (separate from a folder location). */
  shaderLine?: number
  measured?: number | string
  limit?: number | string
  op?: number
}
