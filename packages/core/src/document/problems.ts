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
] as const

export type Code = (typeof CODES)[number]

export type Problem = {
  code: Code
  message: string
  nodeId?: string
  path?: string
  allowed?: readonly string[]
  rule?: string
  op?: number
}
