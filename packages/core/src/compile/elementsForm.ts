import { type Link } from '../document/index.ts'
import { DETAILS_NAME, urlOk } from '../document/rules.ts'
import { EMBEDS, embedUrl } from '../document/embed.ts'
import { UI, el, glyph, str, type Attrs, type Build } from './elementsBase.ts'
import { type HtmlNode } from './html.ts'
import { href } from './links.ts'

/** The kinds that gather others: embed, menu, form, field and details. */
export function formElement(b: Build): HtmlNode | null {
  switch (b.w.kind) {
    case 'embed':
      return embed(b)
    case 'menu':
      return menu(b)
    case 'form':
      return form(b)
    case 'field':
      return field(b)
    default:
      return details(b)
  }
}

/** The static markup the embed host takes over: a play link, over the poster when the provider has one. No frame, no script. */
function embed({ p, attrs, cls, plate }: Build): HtmlNode | null {
  const src = embedUrl(p.provider, p.id, 'page')
  if (!src) return plate('video')
  const poster = embedUrl(p.provider, p.id, 'poster')
  return el('div', { ...attrs, class: cls('s-embed') }, [
    el(
      'a',
      {
        class: 's-embed-go',
        href: src,
        target: '_blank',
        rel: 'noopener noreferrer',
        'data-embed': p.provider as string,
        'data-embed-id': p.id as string,
      },
      [
        poster &&
          ({
            tag: 'img',
            attrs: {
              src: poster,
              alt: '',
              loading: 'lazy',
              referrerpolicy: 'no-referrer',
            },
          } as HtmlNode),
        el('span', {}, [UI.play(EMBEDS[p.provider as string].name)]),
      ],
    ),
  ])
}

function menu(b: Build): HtmlNode | null {
  const { p, ctx, attrs } = b
  const { doc, links, mode } = ctx
  const live = mode === 'live'
  const dropdown = p.as === 'dropdown'
  const wrap = (
    label: string,
    lang: string | undefined,
    items: HtmlNode[],
    aria: string,
  ) =>
    dropdown
      ? el('nav', { ...attrs, 'aria-label': aria }, [
          el(
            'details',
            { class: 's-dd', 'data-up': p.drop === 'up' ? '' : undefined },
            [el('summary', { lang }, [label]), el('div', {}, items)],
          ),
        ])
      : el('nav', { ...attrs, 'aria-label': aria }, items)
  const footer = p.which === 'footer'
  // href() also drops a page that is off or whose address is unsafe.
  const pages = doc.pages
    .filter(pg => (footer ? pg.inFooter : pg.inMenu))
    .flatMap(pg => {
      const to = href({ page: pg.slug }, doc, links)
      return to === undefined ? [] : [{ pg, to }]
    })
  // `half` splits the list in two for a header that sets the name between its links: the first half is the menu, the second a second nav, named "(2)", that carries on after the name
  const cut = Math.ceil(pages.length / 2)
  const halved =
    p.half === 'first'
      ? pages.slice(0, cut)
      : p.half === 'second'
        ? pages.slice(cut)
        : pages
  // `limit` keeps the first links; `viewAll` ends the list with one more
  const shown =
    typeof p.limit === 'number' && Number.isInteger(p.limit) && p.limit >= 1
      ? halved.slice(0, p.limit)
      : halved
  const all =
    p.viewAll && typeof p.viewAll === 'object'
      ? href(p.viewAll as Link, doc, links)
      : undefined
  const allPage =
    p.viewAll && typeof p.viewAll === 'object' && 'page' in p.viewAll
      ? doc.pages.find(pg => pg.slug === (p.viewAll as { page: string }).page)
      : undefined
  const items = shown.map(({ pg, to }) =>
    el(
      'a',
      {
        href: live ? to : undefined,
        'aria-current': pg.id === ctx.current ? 'page' : undefined,
      },
      // `icons: on` draws each page's own icon above its name; the name stays the link's words
      [p.icons === 'on' && glyph(pg.icon), pg.title],
    ),
  )
  if (all !== undefined)
    items.push(
      el(
        'a',
        {
          href: live ? all : undefined,
          'data-all': '',
          'aria-current':
            allPage && allPage.id === ctx.current ? 'page' : undefined,
        },
        [
          typeof p.viewAllLabel === 'string' && p.viewAllLabel
            ? p.viewAllLabel
            : (allPage?.title ?? 'View all'),
        ],
      ),
    )
  return wrap(
    UI.menu,
    undefined,
    items,
    `${footer ? UI.footerMenu : UI.siteMenu}${p.half === 'second' ? ' (2)' : ''}`,
  )
}

function form({ p, attrs, ctx, kids }: Build): HtmlNode {
  const to = ctx.links.form?.()
  const action = to !== undefined && urlOk(to) ? to : undefined
  return el('form', { ...attrs, action, method: 'post' }, [
    {
      tag: 'input',
      attrs: {
        type: 'hidden',
        name: 'form',
        value: str(p.formId, 'Contact'),
      },
    },
    el('label', { class: 's-trap', 'aria-hidden': 'true' }, [
      UI.trap,
      {
        tag: 'input',
        attrs: { name: 'website', tabindex: -1, autocomplete: 'off' },
      },
    ]),
    ...kids(),
  ])
}

function field({ p, attrs, ctx, w }: Build): HtmlNode {
  const name =
    p.name === 'email' || p.name === 'message' || p.name === 'subject'
      ? p.name
      : 'name'
  const input: Attrs = {
    name,
    class: ctx.classOf.get(`${w.id}:control`),
    required: p.required ? '' : undefined,
    disabled: ctx.mode === 'edit' ? '' : undefined,
  }
  return el('label', attrs, [
    str(p.label, UI[name]),
    name === 'message'
      ? el('textarea', { ...input, rows: 3 })
      : {
          tag: 'input',
          attrs: {
            ...input,
            type: name === 'email' ? 'email' : undefined,
            maxlength: name === 'subject' ? 200 : undefined,
          },
        },
  ])
}

function details({ p, attrs, cls, kids }: Build): HtmlNode {
  return el(
    'details',
    {
      ...attrs,
      class: cls(
        p.marker === 'none'
          ? 's-mk-none'
          : p.marker === 'chevron-end'
            ? 's-mk-end'
            : '',
      ),
      open: p.open || p.foldOn === 'never' ? '' : undefined,
      name:
        typeof p.name === 'string' && DETAILS_NAME.test(p.name)
          ? p.name
          : undefined,
    },
    [el('summary', {}, [str(p.summary)]), ...kids()],
  )
}
