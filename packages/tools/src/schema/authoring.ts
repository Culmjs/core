import { KINDS } from '@culmjs/core'
import type { BlockDef, KindSpec, Registry } from '@culmjs/core'

type Schema = Record<string, unknown>

const ref = (name: string): Schema => ({
  $ref: `#/$defs/${encodeURIComponent(name.replace(/~/g, '~0').replace(/\//g, '~1'))}`,
})
const str: Schema = { type: 'string' }
const STYLE_LAYERS = ['base', 'tablet', 'phone', 'hover', 'dark']
const ID = '^[a-z0-9]{1,20}$'

// The node keys every kind shares. Open on purpose: the schema never refuses what validateSite accepts.
const NODE_KEYS: Record<string, Schema> = {
  id: str,
  name: str,
  slot: { type: 'object' },
  children: { type: 'array', items: ref('node') },
  repeat: { type: 'object' },
  bind: { type: 'object' },
  showIf: { type: 'object' },
  showIfAny: { type: 'array' },
  hide: { type: 'object' },
  locked: { type: 'boolean' },
  origin: { type: 'object' },
  placement: { type: 'object' },
  component: str,
  set: { type: 'object' },
  overrides: { type: 'object' },
  state: { type: 'array' },
  on: { type: 'array' },
  motion: {
    type: 'object',
    description:
      'A trigger with either steps or a registered effect and optional numeric settings.',
    properties: {
      trigger: { anyOf: [str, { type: 'object' }] },
      steps: { type: 'array', items: { type: 'object' } },
      effect: str,
      settings: { type: 'object', additionalProperties: { type: 'number' } },
      pinPx: { type: 'number' },
      scrollFallback: { const: 'timeline' },
      host: { const: true },
    },
    required: ['trigger'],
    oneOf: [{ required: ['steps'] }, { required: ['effect'] }],
  },
  required: { type: 'boolean' },
}

const propSchema = (f: KindSpec['props'][string]): Schema =>
  f.type === 'number'
    ? { type: 'number' }
    : f.type === 'switch'
      ? { type: 'boolean' }
      : f.type === 'select' && f.options
        ? { enum: [...f.options] }
        : ['text', 'textarea', 'url', 'date', 'id', 'asset'].includes(f.type)
          ? str
          : {}

function kindDef(kind: string, spec: KindSpec): Schema {
  const decl = (): Schema => ({
    type: 'object',
    properties: Object.fromEntries(spec.styles.map(k => [k, {}])),
  })
  const layers = [...new Set([...STYLE_LAYERS, ...spec.states])]
  return {
    description: spec.label,
    type: 'object',
    properties: {
      kind: { const: kind },
      props: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(spec.props).map(([k, f]) => [k, propSchema(f)]),
        ),
      },
      style: {
        type: 'object',
        properties: {
          ...Object.fromEntries(layers.map(l => [l, decl()])),
          when: {
            type: 'array',
            items: {
              type: 'object',
              properties: { decl: decl() },
            },
          },
        },
      },
    },
  }
}

function settingSchema(s: BlockDef['settings'][number]): Schema {
  if (s.type === 'number') return { type: 'number' }
  if (s.type === 'switch') return { type: 'boolean' }
  if (s.type === 'select' && Array.isArray(s.options))
    return { enum: s.options.map(o => o?.value) }
  if (s.type === 'text' || s.type === 'textarea') return str
  return {}
}

function shortDef(b: BlockDef): Schema {
  return {
    description: b.guide ?? b.name,
    type: 'object',
    properties: {
      block: { const: b.id },
      // the loader falls back to the first look for a look that is not text
      look: {
        anyOf: [{ enum: b.looks.map(l => l.id) }, { not: { type: 'string' } }],
      },
      id: str,
      ...Object.fromEntries(
        (Array.isArray(b.settings) ? b.settings : [])
          .filter(
            s =>
              typeof s?.key === 'string' &&
              !['block', 'look', 'id'].includes(s.key),
          )
          .map(s => [s.key, { description: s.label, ...settingSchema(s) }]),
      ),
    },
    required: ['block'],
    additionalProperties: false,
  }
}

const fieldType: Schema = {
  anyOf: [
    { enum: ['text', 'number', 'boolean', 'list'] },
    {
      type: 'object',
      properties: {
        rows: { type: 'object', additionalProperties: ref('fieldType') },
      },
      required: ['rows'],
    },
  ],
}

/**
 * One JSON Schema (draft 2020-12) of the folder authoring format: site.json, a page, a piece, a block file and a data file.
 * It is open wherever the loader is open, has no depth or count limit, and holds no reference between nodes.
 * One known place it is stricter than the loader: `site` refuses a file with `root`, `fields`, `looks`, `plugins` or `out`, which the loader
 * ignores in site.json. Without it a broken page, piece, data or block file would match `site` under the root `anyOf`
 * and no error would show.
 */
export function authoringSchema(registry: Registry): Record<string, unknown> {
  const kinds = new Map<string, KindSpec>([
    ...Object.entries(KINDS),
    ...registry.kinds(),
  ])
  const blocks = registry.blocks()
  const defs: Record<string, Schema> = {
    site: {
      type: 'object',
      properties: {
        $schema: str,
        name: str,
        look: { type: 'object' },
        styles: { type: 'object' },
        fonts: { type: 'array', items: str },
        centreMaxWidth: { type: 'boolean' },
        languages: {
          type: 'array',
          items: {
            type: 'object',
            properties: { code: str, dir: { const: 'rtl' } },
            required: ['code'],
          },
        },
        pages: { type: 'array', items: str },
        header: ref('node'),
        footer: ref('node'),
      },
      // what tells a site from the other four shapes, so a broken page is not read as a site
      not: {
        anyOf: ['root', 'fields', 'looks', 'plugins', 'out'].map(k => ({
          required: [k],
        })),
      },
    },
    culm: {
      type: 'object',
      properties: {
        $schema: str,
        plugins: { type: 'array', items: str },
        out: str,
        images: {
          type: 'object',
          properties: {
            provider: { enum: ['gemini', 'openai', 'higgsfield', 'http'] },
            model: str,
            endpoint: str,
          },
        },
      },
      // what tells culm.json from the others, so a broken page is not read as one
      anyOf: [{ required: ['plugins'] }, { required: ['out'] }],
    },
    page: {
      type: 'object',
      properties: {
        $schema: str,
        id: str,
        title: str,
        slug: str,
        on: { type: 'boolean' },
        inMenu: { type: 'boolean' },
        inFooter: { type: 'boolean' },
        icon: str,
        root: ref('node'),
      },
      required: ['root'],
    },
    piece: {
      type: 'object',
      properties: {
        $schema: str,
        id: { type: 'string', pattern: ID },
        name: str,
        settings: { type: 'array', items: { type: 'object' } },
        variants: { type: 'array', items: { type: 'object' } },
        root: ref('node'),
      },
      required: ['root'],
    },
    block: {
      type: 'object',
      properties: {
        $schema: str,
        id: { type: 'string', pattern: ID },
        version: { type: 'integer', minimum: 1 },
        name: str,
        category: str,
        guide: { type: 'string', maxLength: 500 },
        looks: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { id: str, name: str, tree: ref('node') },
            required: ['id', 'tree'],
          },
        },
        settings: { type: 'array', items: { type: 'object' } },
      },
      required: ['id', 'version', 'name', 'category', 'looks', 'settings'],
    },
    data: {
      type: 'object',
      properties: {
        $schema: str,
        guide: str,
        fields: { type: 'object', additionalProperties: ref('fieldType') },
        rows: { type: 'array', items: { type: 'object' } },
      },
      required: ['fields'],
    },
    fieldType,
    use: {
      description:
        'A piece placed here; every other key is a value for one of its settings.',
      type: 'object',
      properties: {
        use: { type: 'string', minLength: 1 },
        id: str,
        // a piece may declare a setting called name, of any type; the schema cannot see the piece
        name: {
          description:
            'The name of the node, or the piece setting called name.',
        },
        slot: NODE_KEYS.slot,
        placement: NODE_KEYS.placement,
        hide: NODE_KEYS.hide,
        showIf: NODE_KEYS.showIf,
        showIfAny: NODE_KEYS.showIfAny,
        locked: NODE_KEYS.locked,
        overrides: NODE_KEYS.overrides,
        bind: NODE_KEYS.bind,
        children: NODE_KEYS.children,
      },
      required: ['use'],
    },
    shortForm: blocks.length
      ? {
          type: 'object',
          properties: { block: { enum: blocks.map(b => b.id) } },
          required: ['block'],
          allOf: blocks.map(b => ({
            if: { properties: { block: { const: b.id } }, required: ['block'] },
            then: ref(`short.${b.id}`),
          })),
        }
      : { not: {} }, // no block is registered, so no short form is valid
    plainNode: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...kinds.keys()] },
        ...NODE_KEYS,
      },
      required: ['kind'],
      allOf: [...kinds.keys()].map(k => ({
        if: { properties: { kind: { const: k } }, required: ['kind'] },
        then: ref(`kind.${k}`),
      })),
    },
    // the loader reads "block" first, then "use", then "kind"
    node: {
      type: 'object',
      if: { required: ['block'] },
      then: ref('shortForm'),
      else: {
        if: { required: ['use'] },
        then: ref('use'),
        else: ref('plainNode'),
      },
    },
  }
  for (const [k, spec] of kinds) defs[`kind.${k}`] = kindDef(k, spec)
  for (const b of blocks) defs[`short.${b.id}`] = shortDef(b)
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Culm authoring format',
    anyOf: ['site', 'culm', 'page', 'piece', 'block', 'data'].map(ref),
    $defs: defs,
  }
}
