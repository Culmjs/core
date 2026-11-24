"""Join full-width viewport bands; never track or re-center a moving target."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ref, culm, out = map(Path, sys.argv[1:])
out.mkdir(parents=True, exist_ok=True)
ink, muted, paper = '#173a32', '#475d55', '#f3f4ef'
scenes = [
    ('box', '01   Traverse', 'GSAP  /  simple entry', 525, 735, ['0ms', '250ms', '500ms']),
    ('codepen', '02   Waterline', 'GreenSock  /  pinned panel', 285, 495, ['start', 'half', 'end', 'release']),
    ('codrops', '03   Reed Ledger', 'Codrops  /  effect 11', 332, 580, ['0ms', '100ms', '500ms', '1378ms']),
]
for width in (1280, 390):
    for scene, title, source, y0, y1, frames in scenes:
        col = min(width, 640)
        band = round((y1-y0) * col / width)
        canvas = Image.new('RGB', (2*col+48, 104+(band+43)*len(frames)+12), paper)
        d = ImageDraw.Draw(canvas)

        def text(x, y, s, size=17, color=ink):
            d.text((x, y), s, font=ImageFont.load_default(size=size), fill=color)

        text(16, 10, title, 27)
        text(16, 46, f'{width} x 900   |   fixed viewport band y={y0}..{y1}   |   full horizontal span', 17, muted)
        text(16, 79, 'LOCAL REFERENCE   /   '+source)
        text(col+32, 79, 'CULM   /   Fen Survey')
        for i, frame in enumerate(frames):
            y = 104 + (band+43)*i
            if scene == 'codepen':
                label = f"{frame.upper()}   /   scrollY { [1800,2250,2700,2732][i] }"
            elif scene == 'box':
                label = f'{frame}   /   scrollY 1200'
            else:
                # Original supplied PNGs predate the JSON sidecar. The two
                # recorded reference offsets were re-read in the pinned dist.
                meta = ref / f'codrops-{width}.json'
                left = json.loads(meta.read_text())['scrollY'] if meta.exists() else {1280:11219,390:8715}[width]
                right = json.loads((culm / meta.name).read_text())['scrollY']
                label = f'{frame}   /   scrollY {left} reference, {right} Culm'
            text(16, y+8, label, 17, muted)
            for j, root in enumerate((ref, culm)):
                with Image.open(root/f'{scene}-{width}-{frame}.png') as img:
                    assert img.size == (width, 900)
                    img = img.convert('RGB').crop((0, y0, width, y1)).resize((col,band), Image.Resampling.LANCZOS)
                canvas.paste(img, (16+(col+16)*j, y+34))
        canvas.save(out/f'{scene}-{width}.png', optimize=True)
