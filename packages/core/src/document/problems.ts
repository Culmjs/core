export const CODES = [
  'INVALID_DOCUMENT',
  'INVALID_NODE',
  'UNKNOWN_KIND',
  'UNKNOWN_COMPONENT',
  'UNKNOWN_BLOCK',
  'UNKNOWN_SOURCE',
  'RESOURCE_LIMIT_EXCEEDED',
  'POLICY_VIOLATION',
] as const

export type Code = (typeof CODES)[number]

export type Problem = {
  code: Code
  message: string
  nodeId?: string
  path?: string
  allowed?: readonly string[]
  rule?: string
}
