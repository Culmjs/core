import assert from 'node:assert/strict'
import {
  createRegistry,
  emptySite,
  memoryStore,
  type Motion,
  type SiteDocument,
} from '@culmjs/core'
import { createMcpServer } from '@culmjs/tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

// The same documents drive both the acceptance reads and the owner preview.
// All layout, artwork and motion travel through the public writers.
const stock = () =>
  emptySite('Fen Survey', {
    id: 'fen',
    name: 'Field paper',
    family: 'Minimal',
    brand: '#1e6256',
    bg: '#f6f3e8',
    ink: '#163c34',
    headingFont: 'sys:serif',
    bodyFont: 'sys:sans',
    corners: 0,
    dark: 'light',
  })
const box: Motion = {
  trigger: 'enter-view',
  steps: [
    {
      target: 'self',
      from: { xPx: 0 },
      to: { xPx: 500 },
      durationMs: 500,
      ease: 'ease-out',
    },
  ],
}
const panel: Motion = {
  trigger: 'scroll',
  pinPx: 900,
  steps: [
    {
      target: { id: 'gauge' },
      from: { scaleX: 0 },
      to: { scaleX: 1 },
      durationMs: 1000,
    },
  ],
}
const type: Motion = {
  trigger: 'enter-view',
  steps: [
    {
      target: 'letters',
      from: { xPercent: 105 },
      to: { xPercent: 0 },
      durationMs: 1000,
      staggerMs: 42,
      ease: 'expo-out',
      mask: true,
    },
  ],
}
const caption = (text: string) => ({
  kind: 'text',
  text,
  style: { font: 'sys:mono', size: 15, weight: 600 },
})
const marker = {
  kind: 'column',
  id: 'plate',
  style: { width: 360, height: 48, margin: [0, 0, 0, 24], bg: 'ink' },
  phone: { margin: [0, 0, 0, -240] },
  motion: box,
  children: [
    {
      kind: 'shape',
      label: 'Notched reed staff',
      fill: 'none',
      stroke: { color: '#eac875', width: 3 },
      geometry: {
        type: 'path',
        view: [360, 48],
        d: 'M12 35H348 M20 9V35 M40 23V35 M60 17V35 M80 23V35 M100 9V35 M120 23V35 M140 17V35 M160 23V35 M180 9V35 M200 23V35 M220 17V35 M240 23V35 M260 9V35 M280 23V35 M300 17V35 M320 23V35 M340 9V35',
      },
      style: { width: 360, height: 48 },
    },
  ],
}
const waterline = {
  kind: 'box',
  id: 'plate',
  children: [
    {
      kind: 'column',
      as: 'article',
      style: {
        height: '100vh',
        position: 'relative',
        align: 'center',
        justify: 'center',
        bg: '#e2ede5',
      },
      children: [
        {
          kind: 'column',
          style: {
            position: 'absolute',
            inset: { bottom: { n: 52, unit: '%' } },
            align: 'center',
          },
          children: [
            caption('02   /   HIGH WATER'),
            {
              kind: 'text',
              level: 'h2',
              text: 'Waterline',
              style: { size: 56, lineHeight: 1.1 },
              phone: { size: 36 },
            },
          ],
        },
        {
          kind: 'box',
          id: 'gauge',
          style: {
            width: '80vw',
            maxWidth: 800,
            height: 8,
            origin: 'left',
            bg: 'ink',
          },
        },
      ],
    },
  ],
}
const ledger = {
  kind: 'text',
  id: 'plate',
  level: 'h2',
  text: 'Reed Ledger',
  style: { textAlign: 'center', size: 124, lineHeight: 1.2, weight: 600 },
  phone: { size: 48 },
}
type Scene = 'box' | 'panel' | 'type' | 'control' | 'mixed' | 'native'
async function author(scene: Scene): Promise<SiteDocument> {
  const site = 'fen'
  const store = memoryStore({ [site]: stock() })
  const opts = { site, store, registry: createRegistry(), data: { rows: {} } }
  const call = async (
    compact: boolean,
    name: string,
    args: Record<string, unknown>,
  ) => {
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'field-survey', version: '1' })
    const server = createMcpServer({ ...opts, jsonOps: compact })
    try {
      await Promise.all([client.connect(a), server.connect(b)])
      const reply = await client.callTool({ name, arguments: args })
      assert.ok(!reply.isError, JSON.stringify(reply.content))
    } finally {
      await client.close()
      await server.close()
    }
  }
  const number = scene === 'box' ? '01' : scene === 'panel' ? '02' : '03'
  const title =
    scene === 'box' ? 'Traverse' : scene === 'panel' ? 'Soundings' : 'Specimens'
  const intro = {
    kind: 'column',
    style: {
      height: 1800,
      justify: 'between',
      align: 'center',
      padding: [32, 16, 24, 16],
    },
    children: [
      {
        kind: 'column',
        style: { align: 'center' },
        children: [
          caption('FEN SURVEY   /   FIELD NOTES'),
          { kind: 'text', level: 'h1', text: title, style: { size: 48 } },
          { kind: 'button', label: 'Jump to plate', link: { url: '#plate' } },
        ],
      },
      caption(`FIELD PLATE   /   ${number}`),
    ],
  }
  const end = {
    kind: 'column',
    style: { height: 1800, align: 'center', padding: 32 },
    children: [
      {
        kind: 'details',
        summary: 'Field note',
        children: [
          { kind: 'text', text: 'Marks are read from the bank at low tide.' },
        ],
      },
    ],
  }
  const scroll = {
    trigger: 'scroll',
    steps: [
      {
        target: 'self',
        from: { opacity: 0.4 },
        to: { opacity: 1 },
        durationMs: 1000,
      },
    ],
  } satisfies Motion
  const subject =
    scene === 'box'
      ? marker
      : scene === 'panel'
        ? waterline
        : scene === 'native'
          ? { ...ledger, motion: scroll }
          : ledger
  const nodes: object[] = [intro, subject, end]
  if (scene === 'mixed')
    nodes.push({
      kind: 'box',
      id: 'notice',
      layer: 'popover-manual',
      open: true,
      state: [{ name: 'log', values: 'on-off', initial: 'off' }],
      children: [
        {
          kind: 'button',
          label: 'Contact the survey',
          link: { email: 'desk@fen.example' },
          motion: { ...scroll, trigger: 'load' },
        },
        {
          kind: 'button',
          label: 'Close notice',
          command: 'hide-popover',
          opens: 'notice',
        },
      ],
    })
  await call(true, 'write', {
    page: 'home',
    baseRevision: 0,
    ops: nodes.map(node => ({ op: 'insert', node })),
  })
  // The marker entered with compact insert; the heading uses compact patch;
  // the pinned owner is selected by id through the full apply/setMotion tool.
  if (scene === 'type' || scene === 'mixed')
    await call(true, 'write', {
      page: 'home',
      baseRevision: 1,
      ops: [{ op: 'update', id: 'plate', motion: type }],
    })
  if (scene === 'panel')
    await call(false, 'apply', {
      baseRevision: 1,
      key: 'pin-waterline',
      ops: [
        { op: 'setMotion', tree: { page: 'home' }, id: 'plate', motion: panel },
      ],
    })
  const head = await store.head(site)
  assert.ok('doc' in head)
  return head.doc
}
export const scenes = {
  box: () => author('box'),
  panel: () => author('panel'),
  type: () => author('type'),
  control: () => author('control'),
  mixed: () => author('mixed'),
  native: () => author('native'),
}
