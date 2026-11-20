/**
 * The embed kind's fixed provider table. An author supplies only a provider name and an id; every address is built from a
 * template, after the id passes the provider's strict pattern, so no author text ever reaches an attribute as an address.
 * `src` is the frame address, `page` the plain link; `{id}` is replaced by the checked id. `h` is a fixed pixel height for
 * audio players and maps; the rest are 16:9.
 */
export type EmbedSpec = {
  name: string
  re: string
  src: string
  page: string
  allow: string
  h?: number
  q?: true
  poster?: string
}

export const EMBEDS: Record<string, EmbedSpec> = {
  youtube: {
    name: 'YouTube',
    re: '^[A-Za-z0-9_-]{11}$',
    src: 'https://www.youtube-nocookie.com/embed/{id}?autoplay=1',
    page: 'https://www.youtube.com/watch?v={id}',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    poster: 'https://i.ytimg.com/vi/{id}/hqdefault.jpg',
  },
  vimeo: {
    name: 'Vimeo',
    re: '^[0-9]{6,12}$',
    src: 'https://player.vimeo.com/video/{id}?autoplay=1',
    page: 'https://vimeo.com/{id}',
    allow: 'autoplay; picture-in-picture; fullscreen',
  },
  loom: {
    name: 'Loom',
    re: '^[0-9a-f]{32}$',
    src: 'https://www.loom.com/embed/{id}?autoplay=1',
    page: 'https://www.loom.com/share/{id}',
    allow: 'autoplay; fullscreen',
  },
  spotify: {
    name: 'Spotify',
    re: '^(track|album|playlist|episode|show)/[A-Za-z0-9]{22}$',
    src: 'https://open.spotify.com/embed/{id}',
    page: 'https://open.spotify.com/{id}',
    allow: 'autoplay; encrypted-media; clipboard-write',
    h: 352,
  },
  soundcloud: {
    name: 'SoundCloud',
    re: '^[0-9]{1,12}$',
    src: 'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F{id}&auto_play=true',
    page: 'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F{id}',
    allow: 'autoplay',
    h: 166,
  },
  bandcamp: {
    name: 'Bandcamp',
    re: '^(track|album)=[0-9]{1,12}$',
    src: 'https://bandcamp.com/EmbeddedPlayer/{id}/size=large/bgcol=ffffff/linkcol=0687f5/tracklist=false/artwork=small/transparent=true/',
    page: 'https://bandcamp.com/EmbeddedPlayer/{id}/size=large/bgcol=ffffff/linkcol=0687f5/',
    allow: '',
    h: 120,
  },
  'google-maps': {
    name: 'Google Maps',
    re: "^(?=.*[A-Za-z0-9])[A-Za-z0-9 ,.'-]{1,120}$",
    src: 'https://www.google.com/maps?q={id}&output=embed',
    page: 'https://www.google.com/maps?q={id}',
    allow: '',
    h: 400,
    q: true,
  },
}

/** The kind's `provider` choices. */
export const EMBED_PROVIDERS = Object.keys(EMBEDS)

/** Whether `id` passes the provider's pattern. */
export const embedIdOk = (provider: unknown, id: unknown): boolean =>
  typeof provider === 'string' &&
  Object.hasOwn(EMBEDS, provider) &&
  typeof id === 'string' &&
  new RegExp(EMBEDS[provider].re).test(id)

/** The origins the embeds' frames load from, for a page that restricts where frames may come from. */
export const EMBED_ORIGINS: string[] = [
  ...new Set(Object.values(EMBEDS).map(s => new URL(s.src).origin)),
]

/** The checked URL for a provider and id, or null. `which` picks the frame address, the plain link or the poster image. */
export function embedUrl(
  provider: unknown,
  id: unknown,
  which: 'src' | 'page' | 'poster' = 'page',
): string | null {
  if (!embedIdOk(provider, id)) return null
  const s = EMBEDS[provider as string]
  const t = s[which]
  return t
    ? t.replace('{id}', s.q ? encodeURIComponent(id as string) : (id as string))
    : null
}
