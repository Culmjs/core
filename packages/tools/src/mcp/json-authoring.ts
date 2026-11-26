// Small, optional examples, returned only when requested. No registered blocks:
// each result is an ordinary editable JSON subtree for the checked writer.
import { shaderSchema } from '../schema/authoring.ts'
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
        fill: { from: 'brand', to: 'muted', angle: 35 },
        stroke: { color: 'ink', width: 2 },
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
  motion: {
    kind: 'column',
    id: 'choreo',
    style: { gap: 24 },
    children: [
      {
        kind: 'text',
        id: 'reveal',
        level: 'h2',
        text: 'Masked reveal',
        motion: {
          trigger: 'enter-view',
          steps: [
            {
              target: 'letters',
              from: { xPercent: 105 },
              to: { xPercent: 0 },
              durationMs: 800,
              staggerMs: 42,
              ease: 'expo-out',
              mask: true,
            },
          ],
        },
      },
      {
        kind: 'box',
        id: 'pinframe',
        motion: {
          trigger: 'scroll',
          pinPx: 600,
          steps: [
            {
              target: { id: 'gauge' },
              from: { scaleX: 0 },
              to: { scaleX: 1 },
              durationMs: 1000,
            },
          ],
        },
        children: [
          {
            kind: 'column',
            style: { bg: 'canvas', padding: '48px 32px', gap: 16 },
            children: [
              { kind: 'text', text: 'Pinned scrub gauge' },
              {
                kind: 'box',
                id: 'gauge',
                style: {
                  width: 'fill',
                  height: 8,
                  origin: 'left',
                  bg: 'brand',
                },
              },
            ],
          },
        ],
      },
    ],
  },
  chart: {
    kind: 'shape',
    id: 'revchart',
    chart: {
      chart: 'area',
      legend: true,
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [{ name: 'Output', values: [28, 46, 62, 91], color: 'brand' }],
    },
    style: { width: 'fill', height: 260 },
  },
  diagram: {
    kind: 'shape',
    id: 'arch',
    diagram: {
      dir: 'LR',
      nodes: [
        { id: 'src', label: 'Author JSON', sub: 'compact', fill: 'bg' },
        { id: 'core', label: 'Core DSL', sub: 'validate', fill: 'brand' },
        { id: 'out', label: 'Static / PNG', sub: 'checked', fill: 'deep' },
      ],
      edges: [
        ['src', 'core', 'ops'],
        ['core', 'out', 'compile'],
      ],
    },
    style: { width: 'fill', height: 180 },
  },
  poster: {
    kind: 'box',
    id: 'card',
    style: {
      width: 'fill',
      height: 'fill',
      bg: 'deep',
      color: 'on-deep',
      padding: 64,
      overflow: 'clip',
    },
    children: [
      {
        kind: 'shape',
        placement: { mode: 'behind' },
        contours: { seed: 7, bands: 12 },
        style: { width: 'fill', height: 'fill', opacity: 0.35 },
      },
      {
        kind: 'column',
        style: { gap: 16 },
        children: [
          {
            kind: 'text',
            level: 'h1',
            text: 'Field Notes 04',
            style: { size: 72, weight: 800, color: 'on-deep' },
          },
          {
            kind: 'shape',
            stamp: {
              text: 'VERIFIED · STATIC · ZERO-JS',
              center: '04',
              teeth: 24,
            },
            style: { width: 140, height: 140 },
          },
        ],
      },
    ],
  },
}
export const JSON_GUIDE =
  'Author with JSON operations. Batch related edits at one baseRevision; pass page:"header" or "footer" to edit chrome, or use addPage/removePage/setPage ops. Each insert appends one custom subtree: {op:"insert",node:{kind:"column",id:"intro",children:[{kind:"text",level:"h1",text:"Hello",style:{size:"14rem"},phone:{size:64}}]}}. Use lower-case alphanumeric ids (1–20). Build with row, column, grid (cols,phoneCols), text, button (label,link), image and shape. Style keys include bg,color,size,font,weight,gap,padding,width,align,justify; null clears a style key. update also accepts set, slot, placement, hide, state and on. New starters give H1/H2 a separate display range and tight leading; override lineHeight and letterSpacing per layer. Compose the phone layout explicitly: stack competing copy, annotations and actions with phone:{direction:"column",align:"start"}; preserve useful horizontal pairs. Visuals: shape accepts compact shorthands contours:{seed:7,bands?:10,scale?}, stamp:{text:"...",center?:"01",teeth?:24,rings?:2}, wave:{amp:18,freq:3,y?,closeBottom?}, chart:{chart:"bar"|"line"|"area"|"donut"|"spark",series:[{name?,values:[...],color?}],labels?,legend?}, diagram:{dir?:"LR"|"TB",nodes:[{id,label,sub?,fill?}],edges:[["a","b",label?]]}, curve:{points:[[x,y],...]}, arc:{cx,cy,r,start,end}, or marks:[{rect:[x,y,w,h,rx?]|circle:[cx,cy,r]|ellipse:[cx,cy,rx,ry]|line:[x1,y1,x2,y2]|wave:{amp,freq,y?}|grid:{cols,rows}|path|label,at?:[x,y],fill?,stroke?:"ink/2",repeat?:{count,step?:[dx,dy],opacity?:[from,to]}}], plus fill:{radial:[cx,cy,r],from,to} and blur/grain. For photos/AI visuals use {kind:"image",generate:"prompt...",aspect:"16:9",alt:"..."}. Call render {out,node|id,size:"og"|"square"|"poster"} to export checked PNG/WebP/SVG images. Motion accepts {trigger:"load"|"enter-view"|"hover"|"press"|"scroll"|"pointer-x",effect:"rise",settings?:{distance:24}} or {trigger,pinPx?,steps:[{target:"self"|"children"|"lines"|"words"|"letters"|"path"|{id,part?:"path"},from:{...},to:{...},durationMs,delayMs?,staggerMs?,ease?:"linear"|"ease-out"|"expo-out",mask?}]} with matching from/to keys (opacity,xPx,yPx,xPercent,scale,scaleX,rotateDeg,draw); pinPx (1–4000) needs trigger:"scroll" on a container with one visual child, mask is for split text, and draw (0–1) is for stroked path shapes. describe {example:"figure"|"phone-row"|"display"|"motion"|"chart"|"diagram"|"poster"} gives an editable example. find with no filter outlines the page. measure before finishing; target its suggested parent ids with update. build exports static files.'
const str = { type: 'string' },
  bool = { type: 'boolean' },
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
      operation('addCustomEffect', { effect: shaderSchema(false) }, ['effect']),
      operation('insert', { node: { ...obj, properties: { motion: obj } } }, [
        'node',
      ]),
      operation(
        'update',
        {
          id: str,
          text: str,
          props: obj,
          set: obj,
          slot: obj,
          placement: { anyOf: [obj, { type: 'null' }] },
          hide: { anyOf: [obj, { type: 'null' }] },
          state: { anyOf: [{ type: 'array' }, { type: 'null' }] },
          on: { anyOf: [{ type: 'array' }, { type: 'null' }] },
          motion: { anyOf: [obj, { type: 'null' }] },
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
      operation(
        'addPage',
        {
          page: str,
          title: str,
          slug: str,
          index: integer,
          on: bool,
          inMenu: bool,
          inFooter: bool,
          icon: str,
        },
        ['title', 'slug'],
      ),
      operation('removePage', { page: str }, ['page']),
      operation(
        'setPage',
        {
          page: str,
          title: str,
          slug: str,
          on: bool,
          inMenu: bool,
          inFooter: bool,
          icon: str,
        },
        ['page'],
      ),
    ],
  },
}
