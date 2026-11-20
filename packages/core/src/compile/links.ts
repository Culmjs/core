import { type Link, type SiteDocument } from '../document/index.ts'
import { urlOk } from '../document/rules.ts'

/** Every address a compiled site links to. The caller decides how pages and files are addressed. */
export type Links = {
  page(slug: string): string
  file(id: string): string | undefined
  /** Where a form posts to; without it a form posts to its own page. */
  form?(): string
}

/** The address a Link points at, or undefined when its target is missing, off, or unsafe. */
export function href(
  link: Link | string,
  doc: Pick<SiteDocument, 'pages'>,
  links: Links,
): string | undefined {
  const l: Link = typeof link === 'string' ? { url: link } : link
  const out =
    'page' in l
      ? doc.pages.some(p => p.slug === l.page && p.on)
        ? links.page(l.page)
        : undefined
      : 'file' in l
        ? links.file(l.file)
        : 'email' in l
          ? `mailto:${l.email}`
          : /^[^@\s:/?#]+@[^@\s:/?#]+$/.test(l.url)
            ? `mailto:${l.url}` // a bare address is an email link
            : l.url
  return out !== undefined && urlOk(out) ? out : undefined
}

/** The two halves of a plain `mailto:user@domain` address, or null. */
export const mailParts = (to: string | undefined) => {
  const m = to && /^mailto:([^@?\s]+)@([^?\s]+)$/i.exec(to)
  return m ? { u: m[1], d: m[2] } : null
}

/** The props of an `a` for `to`: on a page that hides addresses (`mail`) a plain mailto link has no address in it. `text` reads `user [at] domain` when it is the address. */
export function linkProps(
  to: string | undefined,
  mail: { used: boolean } | undefined,
  text?: string,
) {
  const m = mail && mailParts(to)
  if (!m) return { props: { href: to }, text }
  mail.used = true
  return {
    props: { href: '#', 'data-u': m.u, 'data-d': m.d },
    text: text === `${m.u}@${m.d}` ? `${m.u} [at] ${m.d}` : text,
  }
}
