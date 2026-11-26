import { pathToFileURL } from 'node:url'
import {
  compileFrame,
  createRegistry,
  emptySite,
  type Look,
  type Node,
} from '../packages/core/src/index.ts'
import { catalogue } from '../packages/core/src/ops/index.ts'
import { buildRequest } from '../packages/tools/src/jsx/batch.ts'
import { previewOps } from '../packages/tools/src/jsx/write.ts'
import { JSON_GUIDE } from '../packages/tools/src/mcp/json-authoring.ts'
import { plan } from '../packages/core/src/ops/plan.ts'

export const estimateTokens = (s: string) => Math.ceil(s.length / 4)

const LOOK: Look = {
  id: 'bench',
  name: 'Bench',
  family: 'Minimal',
  brand: '#b45309',
  ink: '#1c1917',
  bg: '#fafaf9',
  headingFont: 'sys:sans',
  bodyFont: 'sys:sans',
  corners: 8,
  dark: 'light',
}

export type BenchCase = {
  id: string
  name: string
  width: number
  height: number
  format: 'svg' | 'html'
  compactPayload: Record<string, unknown>
  fullPlanOps: unknown[]
  codingBaseline: string
}

export const BENCH_CASES: readonly BenchCase[] = [
  {
    id: 'chart',
    name: 'Multi-series quarterly area chart',
    width: 640,
    height: 360,
    format: 'svg',
    compactPayload: {
      out: 'assets/chart.svg',
      size: '640x360',
      node: {
        kind: 'shape',
        chart: {
          chart: 'area',
          legend: true,
          labels: ['Q1', 'Q2', 'Q3', 'Q4'],
          series: [
            { name: 'Desktop', values: [32, 48, 64, 92], color: 'brand' },
            { name: 'Mobile', values: [18, 29, 44, 71], color: 'ink' },
          ],
        },
      },
    },
    fullPlanOps: [
      {
        op: 'add',
        tree: { page: 'home' },
        parent: 'homeroot',
        index: 0,
        node: {
          kind: 'shape',
          name: 'Chart',
          slot: {},
          props: {
            geometry: {
              type: 'chart',
              chart: 'area',
              legend: true,
              labels: ['Q1', 'Q2', 'Q3', 'Q4'],
              series: [
                { name: 'Desktop', values: [32, 48, 64, 92], color: 'brand' },
                { name: 'Mobile', values: [18, 29, 44, 71], color: 'ink' },
              ],
            },
          },
        },
      },
    ],
    codingBaseline: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">',
      '  <style>.lbl{font:11px ui-monospace,monospace;fill:#57534e}.leg{font:600 11px system-ui,sans-serif;fill:#1c1917}</style>',
      '  <line x1="46" y1="324" x2="620" y2="324" stroke="#e7e5e4"/><text x="38" y="328" text-anchor="end" class="lbl">0</text>',
      '  <line x1="46" y1="251.5" x2="620" y2="251.5" stroke="#e7e5e4"/><text x="38" y="255.5" text-anchor="end" class="lbl">23</text>',
      '  <line x1="46" y1="179" x2="620" y2="179" stroke="#e7e5e4"/><text x="38" y="183" text-anchor="end" class="lbl">46</text>',
      '  <line x1="46" y1="106.5" x2="620" y2="106.5" stroke="#e7e5e4"/><text x="38" y="110.5" text-anchor="end" class="lbl">69</text>',
      '  <line x1="46" y1="34" x2="620" y2="34" stroke="#e7e5e4"/><text x="38" y="38" text-anchor="end" class="lbl">92</text>',
      '  <path d="M46 223.1 C112 204.2 170 185 237.3 172.7 C304 160 362 140 428.7 122.3 C495 104 553 68 620 34 L620 324 L46 324 Z" fill="#b45309" fill-opacity="0.18"/>',
      '  <path d="M46 223.1 C112 204.2 170 185 237.3 172.7 C304 160 362 140 428.7 122.3 C495 104 553 68 620 34" fill="none" stroke="#b45309" stroke-width="2.5"/>',
      '  <circle cx="46" cy="223.1" r="3.5" fill="#fafaf9" stroke="#b45309" stroke-width="2"/><circle cx="237.3" cy="172.7" r="3.5" fill="#fafaf9" stroke="#b45309" stroke-width="2"/>',
      '  <circle cx="428.7" cy="122.3" r="3.5" fill="#fafaf9" stroke="#b45309" stroke-width="2"/><circle cx="620" cy="34" r="3.5" fill="#fafaf9" stroke="#b45309" stroke-width="2"/>',
      '  <path d="M46 267.3 C112 254 170 242 237.3 232.6 C304 220 362 205 428.7 185.3 C495 165 553 130 620 100.2 L620 324 L46 324 Z" fill="#1c1917" fill-opacity="0.18"/>',
      '  <path d="M46 267.3 C112 254 170 242 237.3 232.6 C304 220 362 205 428.7 185.3 C495 165 553 130 620 100.2" fill="none" stroke="#1c1917" stroke-width="2.5"/>',
      '  <circle cx="46" cy="267.3" r="3.5" fill="#fafaf9" stroke="#1c1917" stroke-width="2"/><circle cx="237.3" cy="232.6" r="3.5" fill="#fafaf9" stroke="#1c1917" stroke-width="2"/>',
      '  <circle cx="428.7" cy="185.3" r="3.5" fill="#fafaf9" stroke="#1c1917" stroke-width="2"/><circle cx="620" cy="100.2" r="3.5" fill="#fafaf9" stroke="#1c1917" stroke-width="2"/>',
      '  <text x="46" y="348" text-anchor="middle" class="lbl">Q1</text><text x="237.3" y="348" text-anchor="middle" class="lbl">Q2</text>',
      '  <text x="428.7" y="348" text-anchor="middle" class="lbl">Q3</text><text x="620" y="348" text-anchor="middle" class="lbl">Q4</text>',
      '  <rect x="46" y="10" width="10" height="10" rx="3" fill="#b45309"/><text x="61" y="19" class="leg">Desktop</text>',
      '  <rect x="123" y="10" width="10" height="10" rx="3" fill="#1c1917"/><text x="138" y="19" class="leg">Mobile</text>',
      '</svg>',
    ].join('\n'),
  },
  {
    id: 'diagram',
    name: '3-node routed architecture diagram',
    width: 640,
    height: 180,
    format: 'svg',
    compactPayload: {
      out: 'assets/arch.svg',
      size: '640x180',
      node: {
        kind: 'shape',
        diagram: {
          dir: 'LR',
          nodes: [
            { id: 'a', label: 'Author JSON', sub: 'compact', fill: 'bg' },
            { id: 'b', label: 'Core DSL', sub: 'validate', fill: 'brand' },
            { id: 'c', label: 'PNG / SVG', sub: 'checked', fill: 'deep' },
          ],
          edges: [
            ['a', 'b', 'ops'],
            ['b', 'c', 'compile'],
          ],
        },
      },
    },
    fullPlanOps: [
      {
        op: 'add',
        tree: { page: 'home' },
        parent: 'homeroot',
        index: 0,
        node: {
          kind: 'shape',
          name: 'Arch',
          slot: {},
          props: {
            geometry: {
              type: 'diagram',
              dir: 'LR',
              nodes: [
                { id: 'a', label: 'Author JSON', sub: 'compact', fill: 'bg' },
                { id: 'b', label: 'Core DSL', sub: 'validate', fill: 'brand' },
                { id: 'c', label: 'PNG / SVG', sub: 'checked', fill: 'deep' },
              ],
              edges: [
                ['a', 'b', 'ops'],
                ['b', 'c', 'compile'],
              ],
            },
          },
        },
      },
    ],
    codingBaseline: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 180" width="640" height="180">',
      '  <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1.5L9 5L0 8.5z" fill="#57534e"/></marker></defs>',
      '  <path d="M176 90 C204 90, 204 90, 232 90" fill="none" stroke="#57534e" stroke-width="2" marker-end="url(#arr)"/>',
      '  <text x="204" y="84" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#57534e">ops</text>',
      '  <path d="M380 90 C408 90, 408 90, 436 90" fill="none" stroke="#57534e" stroke-width="2" marker-end="url(#arr)"/>',
      '  <text x="408" y="84" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#57534e">compile</text>',
      '  <rect x="28" y="61" width="148" height="58" rx="10" fill="#fafaf9" stroke="#e7e5e4" stroke-width="1.5"/>',
      '  <text x="102" y="86.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#1c1917">Author JSON</text>',
      '  <text x="102" y="102.7" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#57534e">compact</text>',
      '  <rect x="232" y="61" width="148" height="58" rx="10" fill="#b45309" stroke="#b45309" stroke-width="1.5"/>',
      '  <text x="306" y="86.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#fafaf9">Core DSL</text>',
      '  <text x="306" y="102.7" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#fafaf9">validate</text>',
      '  <rect x="436" y="61" width="148" height="58" rx="10" fill="#1c1917" stroke="#1c1917" stroke-width="1.5"/>',
      '  <text x="510" y="86.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#fafaf9">PNG / SVG</text>',
      '  <text x="510" y="102.7" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="#fafaf9">checked</text>',
      '</svg>',
    ].join('\n'),
  },
  {
    id: 'contours',
    name: 'Topographic contour + radial glow poster',
    width: 800,
    height: 600,
    format: 'svg',
    compactPayload: {
      out: 'assets/contours.svg',
      size: '800x600',
      node: {
        kind: 'shape',
        scene: { view: [400, 300] },
        marks: [
          {
            rect: [0, 0, 400, 300, 16],
            fill: { radial: [0.3, 0.3, 0.8], from: 'brand', to: 'deep' },
          },
          {
            wave: { y: 170, amp: 24, freq: 2, phase: 0.5 },
            stroke: 'on-deep/2',
            repeat: { count: 6, step: [0, 14], opacity: [0.9, 0.15] },
          },
          {
            label: 'TOPOGRAPHIC STUDY 04',
            at: [24, 42],
            size: 14,
            font: 'sys:mono',
            fill: 'on-deep',
          },
        ],
      },
    },
    fullPlanOps: [
      {
        op: 'add',
        tree: { page: 'home' },
        parent: 'homeroot',
        index: 0,
        node: {
          kind: 'shape',
          name: 'Contours',
          slot: {},
          props: {
            geometry: { type: 'scene', view: [400, 300] },
            marks: [
              {
                rect: [0, 0, 400, 300, 16],
                fill: { radial: [0.3, 0.3, 0.8], from: 'brand', to: 'deep' },
              },
              {
                wave: { y: 170, amp: 24, freq: 2, phase: 0.5 },
                stroke: { color: 'on-deep', width: 2 },
                repeat: { count: 6, step: [0, 14], opacity: [0.9, 0.15] },
              },
              {
                label: 'TOPOGRAPHIC STUDY 04',
                at: [24, 42],
                size: 14,
                font: 'sys:mono',
                fill: 'on-deep',
              },
            ],
          },
        },
      },
    ],
    codingBaseline: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="800" height="600">',
      '  <defs><radialGradient id="rg" cx="30%" cy="30%" r="80%"><stop offset="0%" stop-color="#b45309"/><stop offset="100%" stop-color="#1c1917"/></radialGradient></defs>',
      '  <rect x="0" y="0" width="400" height="300" rx="16" fill="url(#rg)"/>',
      '  <path d="M0 181.5 C33 198 66 198 100 170 C133 142 166 142 200 170 C233 198 266 198 300 170 C333 142 366 142 400 181.5" fill="none" stroke="#fafaf9" stroke-width="2" opacity="0.9"/>',
      '  <path d="M0 181.5 C33 198 66 198 100 170 C133 142 166 142 200 170 C233 198 266 198 300 170 C333 142 366 142 400 181.5" transform="translate(0 14)" fill="none" stroke="#fafaf9" stroke-width="2" opacity="0.75"/>',
      '  <path d="M0 181.5 C33 198 66 198 100 170 C133 142 166 142 200 170 C233 198 266 198 300 170 C333 142 366 142 400 181.5" transform="translate(0 28)" fill="none" stroke="#fafaf9" stroke-width="2" opacity="0.6"/>',
      '  <path d="M0 181.5 C33 198 66 198 100 170 C133 142 166 142 200 170 C233 198 266 198 300 170 C333 142 366 142 400 181.5" transform="translate(0 42)" fill="none" stroke="#fafaf9" stroke-width="2" opacity="0.45"/>',
      '  <path d="M0 181.5 C33 198 66 198 100 170 C133 142 166 142 200 170 C233 198 266 198 300 170 C333 142 366 142 400 181.5" transform="translate(0 56)" fill="none" stroke="#fafaf9" stroke-width="2" opacity="0.3"/>',
      '  <path d="M0 181.5 C33 198 66 198 100 170 C133 142 166 142 200 170 C233 198 266 198 300 170 C333 142 366 142 400 181.5" transform="translate(0 70)" fill="none" stroke="#fafaf9" stroke-width="2" opacity="0.15"/>',
      '  <text x="24" y="42" font-family="ui-monospace,monospace" font-size="14" fill="#fafaf9">TOPOGRAPHIC STUDY 04</text>',
      '</svg>',
    ].join('\n'),
  },
  {
    id: 'gen-hero',
    name: 'AI-generated image hero card',
    width: 1080,
    height: 1080,
    format: 'html',
    compactPayload: {
      out: 'assets/hero-card.webp',
      size: 'square',
      node: {
        kind: 'column',
        style: { bg: 'bg', padding: 48, gap: 24 },
        children: [
          {
            kind: 'image',
            generate:
              'Overhead studio photo of glazed stoneware vessels on limestone',
            aspect: '4:3',
            alt: 'Glazed stoneware vessels',
          },
          {
            kind: 'text',
            level: 'h1',
            text: 'Kiln Archive 2026',
            style: { size: 48, weight: 800 },
          },
        ],
      },
    },
    fullPlanOps: [
      {
        op: 'add',
        tree: { page: 'home' },
        parent: 'homeroot',
        index: 0,
        node: {
          kind: 'column',
          name: 'Hero',
          slot: {},
          style: { base: { bg: 'bg', padding: 48, gap: 24 } },
          children: [
            {
              kind: 'image',
              name: 'Photo',
              slot: {},
              props: {
                generate:
                  'Overhead studio photo of glazed stoneware vessels on limestone',
                aspect: '4:3',
                alt: 'Glazed stoneware vessels',
              },
              style: { base: { aspect: 1.333 } },
            },
            {
              kind: 'text',
              name: 'Title',
              slot: {},
              props: { level: 'h1', runs: [{ text: 'Kiln Archive 2026' }] },
              style: { base: { size: 48, weight: 800 } },
            },
          ],
        },
      },
    ],
    codingBaseline: [
      'import fs from "node:fs/promises";',
      'const res = await fetch("https://api.openai.com/v1/images/generations", {',
      '  method: "POST",',
      '  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },',
      '  body: JSON.stringify({ model: "gpt-image-1", prompt: "Overhead studio photo of glazed stoneware vessels on limestone", size: "1536x1024", output_format: "webp" }),',
      '});',
      'const { data } = await res.json();',
      'await fs.writeFile("assets/hero.webp", Buffer.from(data[0].b64_json, "base64"));',
      'const html = `<!doctype html><html><body style="margin:0;background:#fafaf9;padding:48px;font-family:system-ui"><img src="./assets/hero.webp" alt="Glazed stoneware vessels" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;margin-bottom:24px"/><h1 style="margin:0;font-size:48px;font-weight:800;color:#1c1917">Kiln Archive 2026</h1></body></html>`;',
      'await fs.writeFile("card.html", html);',
    ].join('\n'),
  },
  {
    id: 'stamp',
    name: 'Serrated stamp emblem SVG',
    width: 512,
    height: 512,
    format: 'svg',
    compactPayload: {
      out: 'assets/seal.svg',
      size: 'icon',
      node: {
        kind: 'shape',
        stamp: { text: 'CULM · CHECKED · STATIC', center: '01', teeth: 24 },
      },
    },
    fullPlanOps: [
      {
        op: 'add',
        tree: { page: 'home' },
        parent: 'homeroot',
        index: 0,
        node: {
          kind: 'shape',
          name: 'Seal',
          slot: {},
          props: {
            geometry: {
              type: 'stamp',
              text: 'CULM · CHECKED · STATIC',
              center: '01',
              teeth: 24,
            },
          },
        },
      },
    ],
    codingBaseline: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="512" height="512">',
      '  <defs><path id="tp" d="M26.72,80 A53.28,53.28 0 1,1 133.28,80 A53.28,53.28 0 1,1 26.72,80"/></defs>',
      '  <path d="M152,80L144.3,88.4L149.5,98.6L140,104.8L142.4,116L131.6,119.5L130.9,130.9L119.5,131.6L116,142.4L104.8,140L98.6,149.5L88.4,144.3L80,152L71.6,144.3L61.4,149.5L55.2,140L44,142.4L40.5,131.6L29.1,130.9L28.4,119.5L17.6,116L20,104.8L10.5,98.6L15.7,88.4L8,80L15.7,71.6L10.5,61.4L20,55.2L17.6,44L28.4,40.5L29.1,29.1L40.5,28.4L44,17.6L55.2,20L61.4,10.5L71.6,15.7L80,8L88.4,15.7L98.6,10.5L104.8,20L116,17.6L119.5,28.4L130.9,29.1L131.6,40.5L142.4,44L140,55.2L149.5,61.4L144.3,71.6Z" fill="none" stroke="#b45309" stroke-width="2"/>',
      '  <ellipse cx="80" cy="80" rx="38.88" ry="38.88" fill="none" stroke="#b45309" stroke-width="1.5"/>',
      '  <text text-anchor="middle" font-family="ui-monospace,monospace" font-size="14" font-weight="700" fill="#b45309"><textPath href="#tp" startOffset="50%">CULM · CHECKED · STATIC</textPath></text>',
      '  <text x="80" y="85.76" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" font-weight="800" fill="#1c1917">01</text>',
      '</svg>',
    ].join('\n'),
  },
  {
    id: 'og-card',
    name: '1200x630 composite OG card',
    width: 1200,
    height: 630,
    format: 'html',
    compactPayload: {
      out: 'assets/og.png',
      size: 'og',
      node: {
        kind: 'box',
        style: { bg: 'deep', color: 'on-deep', padding: 64, overflow: 'clip' },
        children: [
          {
            kind: 'shape',
            placement: { mode: 'behind' },
            contours: { seed: 7, bands: 10 },
            style: { width: 'fill', height: 'fill', opacity: 0.35 },
          },
          {
            kind: 'column',
            style: { gap: 20 },
            children: [
              {
                kind: 'text',
                level: 'h1',
                text: 'Culm Visual Engine',
                style: { size: 72, weight: 800, color: 'on-deep' },
              },
              {
                kind: 'shape',
                chart: {
                  chart: 'spark',
                  series: [{ values: [14, 28, 22, 49, 86], color: 'brand' }],
                },
                style: { width: 420, height: 120 },
              },
            ],
          },
        ],
      },
    },
    fullPlanOps: [
      {
        op: 'add',
        tree: { page: 'home' },
        parent: 'homeroot',
        index: 0,
        node: {
          kind: 'box',
          name: 'OG',
          slot: {},
          style: {
            base: {
              bg: 'deep',
              color: 'on-deep',
              padding: 64,
              overflow: 'clip',
            },
          },
          children: [
            {
              kind: 'shape',
              name: 'Bg',
              slot: {},
              placement: { mode: 'behind' },
              props: { geometry: { type: 'contours', seed: 7, bands: 10 } },
              style: { base: { width: 'fill', height: 'fill', opacity: 0.35 } },
            },
            {
              kind: 'column',
              name: 'Content',
              slot: {},
              style: { base: { gap: 20 } },
              children: [
                {
                  kind: 'text',
                  name: 'Title',
                  slot: {},
                  props: {
                    level: 'h1',
                    runs: [{ text: 'Culm Visual Engine' }],
                  },
                  style: { base: { size: 72, weight: 800, color: 'on-deep' } },
                },
                {
                  kind: 'shape',
                  name: 'Spark',
                  slot: {},
                  props: {
                    geometry: {
                      type: 'chart',
                      chart: 'spark',
                      series: [
                        { values: [14, 28, 22, 49, 86], color: 'brand' },
                      ],
                    },
                  },
                  style: {
                    base: {
                      width: { n: 420, unit: 'px' },
                      height: { n: 120, unit: 'px' },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
    codingBaseline: [
      '<!doctype html><html><head><meta charset="utf-8"><style>',
      '*{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#1c1917;color:#fafaf9;font-family:system-ui,sans-serif}',
      '.wrap{position:relative;width:1200px;height:630px;padding:64px;display:flex;flex-direction:column;gap:20px;overflow:hidden}',
      '.bg{position:absolute;inset:0;width:100%;height:100%;opacity:0.35;pointer-events:none}',
      'h1{position:relative;margin:0;font-size:72px;font-weight:800;line-height:1.02;letter-spacing:-0.02em}',
      '.spark{position:relative;width:420px;height:120px}',
      '</style></head><body><div class="wrap">',
      '<svg class="bg" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">',
      '  <path d="M0 40 Q100 10 200 50 T400 35" fill="none" stroke="#fafaf9" stroke-width="1" opacity="0.4"/>',
      '  <path d="M0 90 Q100 50 200 105 T400 85" fill="none" stroke="#b45309" stroke-width="1.8" opacity="0.6"/>',
      '  <path d="M0 140 Q100 100 200 160 T400 135" fill="none" stroke="#fafaf9" stroke-width="1" opacity="0.65"/>',
      '  <path d="M0 190 Q100 160 200 210 T400 185" fill="none" stroke="#b45309" stroke-width="1.8" opacity="0.8"/>',
      '</svg>',
      '<h1>Culm Visual Engine</h1>',
      '<svg class="spark" viewBox="0 0 420 120"><path d="M8 100 C70 85 120 75 180 82 C240 88 300 45 412 12" fill="none" stroke="#b45309" stroke-width="2.5"/></svg>',
      '</div></body></html>',
    ].join('\n'),
  },
]

export type BenchRow = {
  id: string
  name: string
  compactOut: number
  compactTotal: number
  fullOut: number
  fullTotal: number
  codingOut: number
  codingTotal: number
  outSavingsVsCodingPct: number
  totalSavingsVsFullPct: number
}

export function runImageTokenBench(): {
  rows: BenchRow[]
  summary: {
    compactOutSum: number
    compactTotalSum: number
    fullOutSum: number
    fullTotalSum: number
    codingOutSum: number
    codingTotalSum: number
    outSavingsVsCodingPct: number
    totalSavingsVsFullPct: number
  }
} {
  const reg = createRegistry()
  const fullInChars = ['guide', 'kinds', 'operations']
    .map(w => JSON.stringify(catalogue(reg, { what: w as never })).length)
    .reduce((a, b) => a + b, 0)
  const fullInTokens = estimateTokens('x'.repeat(fullInChars))
  const compactInTokens = estimateTokens(JSON_GUIDE) + 120
  const codingInTokens = 650

  const rows: BenchRow[] = []
  for (const c of BENCH_CASES) {
    const doc = emptySite('Bench', LOOK)
    // Verify compact payload normalises, plans, and compiles cleanly with 0 problems
    const built = buildRequest(doc, reg, {
      page: 'home',
      ops: [{ op: 'insert', node: c.compactPayload.node }],
    })
    if (!built.ok || built.errors.length)
      throw new Error(
        `Benchmark ${c.id} buildRequest failed: ${JSON.stringify(built)}`,
      )
    const ops = previewOps(built.ops)
    const planned = plan(doc, reg, {
      site: 'bench',
      baseRevision: 0,
      key: c.id,
      ops: ops as never,
    })
    if (!planned.ok)
      throw new Error(
        `Benchmark ${c.id} plan failed: ${JSON.stringify(planned.problems)}`,
      )
    const node = planned.doc.pages[0]!.root.children![0]! as Node
    const frame = compileFrame(
      { node, width: c.width, height: c.height, look: LOOK, format: c.format },
      { registry: reg },
    )
    if (!frame.ok || frame.problems.length)
      throw new Error(
        `Benchmark ${c.id} compileFrame failed: ${JSON.stringify(frame)}`,
      )

    const compactOut = estimateTokens(JSON.stringify(c.compactPayload))
    const fullOut = estimateTokens(
      JSON.stringify({ baseRevision: 0, key: c.id, ops: c.fullPlanOps }),
    )
    const codingOut = estimateTokens(c.codingBaseline)
    const compactTotal = compactInTokens + compactOut
    const fullTotal = fullInTokens + fullOut
    const codingTotal = codingInTokens + codingOut

    rows.push({
      id: c.id,
      name: c.name,
      compactOut,
      compactTotal,
      fullOut,
      fullTotal,
      codingOut,
      codingTotal,
      outSavingsVsCodingPct:
        Math.round(((codingOut - compactOut) / codingOut) * 1000) / 10,
      totalSavingsVsFullPct:
        Math.round(((fullTotal - compactTotal) / fullTotal) * 1000) / 10,
    })
  }

  const sum = (f: (r: BenchRow) => number) => rows.reduce((a, r) => a + f(r), 0)
  const compactOutSum = sum(r => r.compactOut)
  const compactTotalSum = sum(r => r.compactTotal)
  const fullOutSum = sum(r => r.fullOut)
  const fullTotalSum = sum(r => r.fullTotal)
  const codingOutSum = sum(r => r.codingOut)
  const codingTotalSum = sum(r => r.codingTotal)

  return {
    rows,
    summary: {
      compactOutSum,
      compactTotalSum,
      fullOutSum,
      fullTotalSum,
      codingOutSum,
      codingTotalSum,
      outSavingsVsCodingPct:
        Math.round(((codingOutSum - compactOutSum) / codingOutSum) * 1000) / 10,
      totalSavingsVsFullPct:
        Math.round(((fullTotalSum - compactTotalSum) / fullTotalSum) * 1000) /
        10,
    },
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { rows, summary } = runImageTokenBench()
  console.log(
    '| Task | Compact Out | Coding Out | Out Savings vs Coding | Compact Total | Full Plan Total | Total Savings vs Full |',
  )
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const r of rows)
    console.log(
      `| ${r.name} | ${r.compactOut} | ${r.codingOut} | ${r.outSavingsVsCodingPct}% | ${r.compactTotal} | ${r.fullTotal} | ${r.totalSavingsVsFullPct}% |`,
    )
  console.log(
    `| **Total (6 tasks)** | **${summary.compactOutSum}** | **${summary.codingOutSum}** | **${summary.outSavingsVsCodingPct}%** | **${summary.compactTotalSum}** | **${summary.fullTotalSum}** | **${summary.totalSavingsVsFullPct}%** |`,
  )
}
