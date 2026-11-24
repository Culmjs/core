# Replay the motion comparison

Run in the repository root with the lockfile install (`npm ci`), Node ≥22.18 and local Chrome. The browser suite intercepts navigation and serves **only** Culm's generated page. No upstream site, Python installation or image file is needed for the tests.

```sh
OUT=$(mktemp -d)
# Set CULM_CHROME if needed. For the genuine second engine, set
# CULM_COMPAT_CHROME to a Chrome 114 executable without native view().
CULM_MOTION_FRAMES="$OUT/culm" node --conditions=source --import tsx --test \
  --test-concurrency=1 packages/tools/__browser__/motion-references.spec.ts
```

This writes 22 full viewport PNGs. Start, half, end, release, reverse and onset comparisons run whether or not capture is enabled. Every run uses fresh documents. The test prints the real scroll positions and measurements. The expected values come from the [pre-implementation record](references.md); the screenshots are for human comparison, not the numeric oracle.

The plain control has an independent oracle too. To recover its two fingerprints using the **pre-motion** compiler, from the same shell:

```sh
git archive a1ca779 packages/core/package.json packages/core/src | tar -x -C "$OUT"
OUT="$OUT" node --conditions=source --import tsx --input-type=module - <<'JS'
import { scenes } from './packages/tools/__tests__/fixtures/motion-scenes.ts'
import { createHash } from 'node:crypto'
const { compilePage, compileSite, createRegistry } = await import(`${process.env.OUT}/packages/core/src/index.ts`)
const doc = await scenes.control(), options = { registry: createRegistry() }
for (const bytes of [compilePage(doc,'home',options).html, JSON.stringify(compileSite(doc,options))])
  console.log(createHash('sha256').update(bytes).digest('hex'))
JS
```

## Recreate the left column and contact sheets

For the optional **reference** replay, use installed Python Playwright, Google Chrome and Pillow ≥10.1. Put these five upstream files in `INPUTS`, using the pinned revisions (or an existing local copy):

- [`greensock/GSAP` `13e2b79` / `dist`](https://github.com/greensock/GSAP/tree/13e2b790546426a1a2e0e9b409f3f8dc6d6611f2/dist): `gsap.min.js`, `ScrollTrigger.min.js`.
- [`codrops/OnScrollTypographyAnimations` `af28d61` / `dist`](https://github.com/codrops/OnScrollTypographyAnimations/tree/af28d61d1f8d3d117f5d1e9b09d5209e20a1a212/dist): `index.html`, `index.d73f7ad5.css`, `index.e9a2d1b4.js`.

```sh
python3 docs/motion/capture-upstream.py "$INPUTS" "$OUT/reference"
python3 docs/motion/contact-sheets.py "$OUT/reference" "$OUT/culm" "$OUT/sheets"
```

[The capture script](capture-upstream.py) checks all five SHA-256 digests and the orange tween fingerprint. It serves assets from disk, shims font activation, exposes the pinned dist's ScrollTrigger to pause its actual tween, and refuses all other requests. [The sheet builder](contact-sheets.py) can also take the original Task 1 reference PNG directory as its first argument. It applies the same fixed band to every frame of a given scene; there is no per-target crop or horizontal shift. Fonts, rasterization or browser version can change pixels on replay. See the [six checked-in sheets and numeric results](exit.md).

## View a plate interactively

Choose `box`, `panel`, `type` or `control`. Generate a standalone live document to open in a disposable browser tab; closing it discards its host. Use a 900 px high viewport and scroll to the offsets in the comparison to see it in motion.

```sh
SCENE=panel node --conditions=source --import tsx --input-type=module - > "$OUT/preview.html" <<'JS'
import { scenes } from './packages/tools/__tests__/fixtures/motion-scenes.ts'
import { compilePage, createRegistry } from '@culmjs/core'
const doc = await scenes[process.env.SCENE]()
const page = compilePage(doc, 'home', {registry:createRegistry(), mode:'live'})
if (!page.ok || page.problems.length) throw Error(JSON.stringify(page.problems))
process.stdout.write(page.html)
JS
```

In an editor, keep the editing surface from `compilePage(doc, pageId, {registry, mode:'edit'})`; partial replacements use `compileSubtree(doc, pageId, nodeId, {registry})`. Both are still and script-free. For a preview button:

```js
const page = compilePage(doc, selectedPageId, { registry, mode: 'live' })
if (!page.ok || page.problems.length) throw Error(JSON.stringify(page.problems))
const preview = document.createElement('iframe')
preview.title = 'Live page preview'
preview.setAttribute('sandbox', 'allow-scripts')
preview.srcdoc = page.html
container.append(preview)
// Close action:
const closePreview = () => preview.remove()
```

Write a program in `node.motion` (or use full `setMotion`), with `trigger` and either checked `steps` or a registered `effect`. Legacy top-level `enter` and `props.motion` are still refused. Use `trigger:'enter-view'` for a once-only entrance; use `target:'letters'`, `mask:true` and `staggerMs` for a timed reveal. Legacy `props.split`, `letterHover`, `type`, `cycle`, `count`, `clock`, drag settings and `track` are not aliases for this API.
