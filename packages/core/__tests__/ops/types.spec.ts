import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LOOK } from '../kit.ts'
import type { Op } from '../../src/ops/types.ts'

const t = { page: 'home' }
// One literal per row of the spec's table. Adding or removing a union member breaks the exhaustive record below.
const ops: { [K in Op['op']]: Extract<Op, { op: K }> } = {
  add: {
    op: 'add',
    tree: t,
    parent: 'a',
    index: 0,
    node: { kind: 'box', children: [{ kind: 'text' }] },
  },
  remove: { op: 'remove', tree: t, id: 'a' },
  move: { op: 'move', tree: t, id: 'a', parent: 'b', index: 1, slot: {} },
  setProps: {
    op: 'setProps',
    tree: t,
    id: 'a',
    props: { x: 1, y: null },
    name: 'n',
  },
  setText: { op: 'setText', tree: t, id: 'a', text: 'hi' },
  setStyle: {
    op: 'setStyle',
    tree: t,
    id: 'a',
    layer: { when: { state: 's', is: 'on' } },
    decl: { gap: 4, bg: null },
  },
  setHidden: {
    op: 'setHidden',
    tree: t,
    id: 'a',
    layout: 'phone',
    hidden: true,
  },
  setSlot: {
    op: 'setSlot',
    tree: t,
    id: 'a',
    slot: { grow: 1 },
    placement: null,
  },
  setRequired: { op: 'setRequired', tree: t, id: 'a', required: null },
  bindData: {
    op: 'bindData',
    tree: t,
    id: 'a',
    repeat: null,
    showIf: { from: 'site', field: 'x' },
  },
  setStates: { op: 'setStates', tree: t, id: 'a', state: null, on: [] },
  setMotion: { op: 'setMotion', tree: t, id: 'a', motion: null },
  addCustomEffect: {
    op: 'addCustomEffect',
    effect: {
      name: 'mist',
      source: 'vec4 shade(vec2 uv){return vec4(1.0);}',
      settings: {},
    },
  },
  insertBlock: {
    op: 'insertBlock',
    tree: t,
    parent: 'a',
    index: 0,
    block: 'hero',
    look: 'plain',
    settings: { k: 'v' },
    id: 'h',
  },
  setBlockSetting: {
    op: 'setBlockSetting',
    tree: t,
    id: 'a',
    key: 'k',
    value: true,
  },
  updateBlock: { op: 'updateBlock', tree: t, id: 'a' },
  makeComponent: {
    op: 'makeComponent',
    tree: t,
    id: 'a',
    component: 'c',
    name: 'C',
  },
  setInstance: {
    op: 'setInstance',
    tree: t,
    id: 'a',
    set: { x: null },
    overrides: { p: null },
  },
  detach: { op: 'detach', tree: 'header', id: 'a' },
  removeComponent: { op: 'removeComponent', component: 'c' },
  addPage: {
    op: 'addPage',
    title: 'T',
    slug: '/t',
    page: 'p',
    index: 1,
    on: true,
    inMenu: true,
    inFooter: false,
    icon: 'i',
  },
  removePage: { op: 'removePage', page: 'p' },
  setPage: { op: 'setPage', page: 'p', title: 'T' },
  movePage: { op: 'movePage', page: 'p', index: 0 },
  setSite: { op: 'setSite', name: 'n', languages: [{ code: 'en' }] },
  setLook: { op: 'setLook', look: LOOK },
  setSiteStyles: {
    op: 'setSiteStyles',
    styles: { textRange: null, motion: 'off' },
  },
  setFonts: { op: 'setFonts', fonts: ['sys:sans'] },
}

test('the 28 operations', () => {
  const names = Object.values(ops).map(o => o.op)
  assert.equal(new Set(names).size, 28)
  assert.deepEqual(names, Object.keys(ops))
})
