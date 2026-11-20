import { existsSync } from 'node:fs'
import { readFiles } from './check-layers.ts'
import { pathToFileURL } from 'node:url'

// Whole words, case-insensitive, except CV (capitals only). Each also matches
// an optional lower-case plural suffix (s or es) and at most one trailing digit
// (`paper2`, not `paper22`).
export const TERMS = [
  'scholar',
  'evoscholar',
  'scholaros',
  'paper',
  'publication',
  'talk',
  'CV',
  'orcid',
  'premium',
  'lab',
  'marketplace',
  'booking',
  'analytics',
]

const PATTERNS = TERMS.map(
  t =>
    [t, new RegExp(`\\b${t}(?:s|es)?\\d?\\b`, t === 'CV' ? '' : 'i')] as const,
)

export function termHits(files: { path: string; source: string }[]): string[] {
  const out: string[] = []
  for (const { path, source } of files) {
    source.split('\n').forEach((raw, i) => {
      // split camelCase and snake_case so identifiers like paperId are seen as words
      const line = raw
        // a plural acronym joined to a word (CVsList): keep the plural with the acronym
        .replace(/([A-Z]{2,}(?:s|es))(?=[A-Z])/g, '$1 ')
        .replace(/([A-Z]+)([A-Z](?!(?:s|es)\b)[a-z])/g, '$1 $2')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
      for (const [term, re] of PATTERNS)
        if (re.test(line)) out.push(`${path}:${i + 1} ${term}`)
    })
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Core is required: run from the wrong directory, nothing would be checked and the script would pass. The other roots may not exist yet.
  if (!existsSync('packages/core/src')) {
    console.error(
      'packages/core/src not found: run check:terms from the repository root.',
    )
    process.exit(1)
  }
  const roots = [
    'packages/core/src',
    ...[
      'packages/tools/src',
      'packages/starter/src',
      'packages/starter/template',
    ].filter(existsSync),
  ]
  const lines = roots.flatMap(root =>
    termHits(readFiles(root).map(f => ({ ...f, path: `${root}/${f.path}` }))),
  )
  for (const l of lines) console.log(l)
  process.exit(lines.length ? 1 : 0)
}
