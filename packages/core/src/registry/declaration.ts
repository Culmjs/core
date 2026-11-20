import type { MigrationStep, Problem } from '../document/index.ts'

export const API_VERSION = 1

export type Declaration = {
  name: string
  version: number
  api: number[]
  runs: ('load' | 'edit' | 'build' | 'browser')[]
  trust: 'declarative' | 'in-page' | 'framed'
  migrations?: MigrationStep[]
}

const bad = (message: string, path: string): Problem => ({
  code: 'INVALID_DOCUMENT',
  message,
  path,
})

export function checkDeclaration(d: Declaration): Problem[] {
  const x = (d ?? {}) as Partial<Declaration>
  const out: Problem[] = []
  if (typeof x.name !== 'string' || !x.name.trim())
    out.push(bad('Plug-in name must be a non-empty string.', 'name'))
  if (!Number.isInteger(x.version) || (x.version as number) < 1)
    out.push(bad('Plug-in version must be a positive integer.', 'version'))
  if (!Array.isArray(x.api))
    out.push(bad('Plug-in api must be a list of version numbers.', 'api'))
  else if (!x.api.includes(API_VERSION))
    out.push({
      code: 'POLICY_VIOLATION',
      message: `Plug-in was not built for API version ${API_VERSION}.`,
      path: 'api',
    })
  return out
}
