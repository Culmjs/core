// Small, optional examples, returned only when requested. No registered blocks:
// each result is an ordinary editable JSON subtree for the checked writer.
export const examples = {
  display: {
    kind: 'text',
    level: 'h1',
    runs: [{ text: 'Your ' }, { text: 'headline', style: { italic: true } }],
    style: { size: 'clamp(72px, 14vw, 200px)', weight: 800 },
    phone: { size: 64 },
  },
  'phone-row': {
    kind: 'row',
    id: 'summary',
    style: { align: 'center', justify: 'between', gap: 24 },
    phone: { direction: 'column', align: 'start', gap: 12 },
    children: [
      { kind: 'text', level: 'h2', text: 'Section title' },
      { kind: 'text', text: 'Short annotation' },
    ],
  },
  figure: {
    kind: 'column',
    id: 'study',
    style: { gap: 12 },
    children: [
      {
        kind: 'shape',
        id: 'drawing',
        geometry: {
          type: 'path',
          view: [120, 72],
          d: 'M4 60 Q20 6 48 34 T116 12 L116 64 L4 64 Z',
        },
        fill: { from: '#415a48', to: '#c5d6bc', angle: 35 },
        stroke: { color: '#294532', width: 2 },
        style: { width: 'fill', height: 180 },
        phone: { height: 120 },
      },
      {
        kind: 'text',
        runs: [{ text: '01 / ', style: { weight: 700 } }, { text: 'Caption' }],
        style: { font: 'sys:mono', size: 14 },
      },
    ],
  },
  group: {
    kind: 'shape',
    geometry: { type: 'group', view: [100, 60] },
    style: { width: 200, height: 120 },
    children: [
      {
        kind: 'shape',
        geometry: { type: 'ellipse' },
        fill: 'brand',
        slot: { x: 4, y: 6, w: 48, h: 48 },
      },
      {
        kind: 'shape',
        geometry: { type: 'path', view: [52, 24], d: 'M1 22 Q26 0 51 8' },
        stroke: { color: 'ink', width: 2 },
        fill: 'none',
        slot: { x: 40, y: 24, w: 52, h: 24 },
      },
    ],
  },
}
export const JSON_GUIDE =
  'Author with JSON operations. Batch related edits at one baseRevision. Each insert appends one custom subtree: {op:"insert",node:{kind:"column",id:"intro",children:[{kind:"text",level:"h1",text:"Hello",style:{size:"14rem"},phone:{size:64}}]}}. Use lower-case alphanumeric ids (1–20). Build with row, column, grid (cols,phoneCols), text, button (label,link) and shape. Style keys include bg,color,size,font,weight,gap,padding,width,align,justify. New starters give H1/H2 a separate display range and tight leading; override lineHeight and letterSpacing per layer. Compose the phone layout explicitly: stack competing copy, annotations and actions with phone:{direction:"column",align:"start"}; preserve useful horizontal pairs. Invent a motif that communicates the brief: shape supports custom paths (geometry:{type:"path",view:[100,100],d:"..."}), groups, strokes and gradient fills, not just circles. describe {example:"figure"|"phone-row"|"display"} gives an editable example. find with no filter outlines the page. measure before finishing; target its suggested parent ids with update. build exports static files.'
const str = { type: 'string' },
  obj = { type: 'object' },
  integer = { type: 'integer', minimum: 0 }
const operation = (
  op: string,
  fields: Record<string, unknown>,
  required: string[],
) => ({
  type: 'object',
  properties: { op: { const: op }, ...fields },
  required: ['op', ...required],
  additionalProperties: false,
})
export const jsonEditSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 32,
  items: {
    oneOf: [
      operation('insert', { node: obj }, ['node']),
      operation(
        'update',
        {
          id: str,
          text: str,
          props: obj,
          style: obj,
          phone: obj,
          tablet: obj,
          hover: obj,
          dark: obj,
        },
        ['id'],
      ),
      operation('move', { id: str, parent: str, index: integer }, [
        'id',
        'index',
      ]),
      operation('remove', { id: str }, ['id']),
      operation('theme', { value: obj }, ['value']),
    ],
  },
}
