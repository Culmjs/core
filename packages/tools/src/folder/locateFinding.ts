import type { Problem } from '@culmjs/core'
import type { Finding } from '@culmjs/core/measure'

/** The finding with `file`, `line` and `column` of its first node; failing that, the file of its page. Used by `culm check` and the MCP `measure` tool. */
export function locateFinding(
  f: Finding,
  locate: <P extends Problem>(p: P) => P,
  pageFile: (page: string) => string | undefined,
): Finding & { file?: string; line?: number; column?: number } {
  const at = locate({
    code: 'INVALID_DOCUMENT',
    message: f.message,
    nodeId: f.nodes[0],
  } as Problem) as { file?: string; line?: number; column?: number }
  const file = at.file ?? pageFile(f.page)
  return {
    ...f,
    ...(file !== undefined ? { file } : {}),
    ...(at.line !== undefined ? { line: at.line, column: at.column } : {}),
  }
}
