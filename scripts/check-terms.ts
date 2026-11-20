import { readFiles } from './check-layers.ts'
import { pathToFileURL } from 'node:url'

// Whole words, case-insensitive, except CV (capitals only).
export const TERMS = [
  'scholar',
  'paper',
  'papers',
  'publication',
  'publications',
  'talk',
  'talks',
  'CV',
  'orcid',
  'premium',
  'lab',
  'marketplace',
  'booking',
  'analytics',
]

const PATTERNS = TERMS.map(
  t => [t, new RegExp(`\\b${t}\\b`, t === 'CV' ? '' : 'i')] as const,
)

export function termHits(files: { path: string; source: string }[]): string[] {
  const out: string[] = []
  for (const { path, source } of files) {
    source.split('\n').forEach((raw, i) => {
      // split camelCase and snake_case so identifiers like paperId are seen as words
      const line = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
      for (const [term, re] of PATTERNS)
        if (re.test(line)) out.push(`${path}:${i + 1} ${term}`)
    })
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = 'packages/core/src'
  const files = readFiles(root)
  const lines = termHits(files)
  for (const l of lines) console.log(l)
  process.exit(lines.length ? 1 : 0)
}
