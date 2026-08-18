"""Side-by-side of the raw GIF's 1-bit alpha vs a supersampled 8-bit alpha, both composited on the
app's background colour and magnified, so the "is WebP worth 2x the bytes" call is made by eye.

    cd ~/Desktop && python momote-frontend/scripts/render/edge_compare.py
"""

import os
from collections import Counter

from PIL import Image, ImageSequence

SRC = "KakaoTalk_20260818_205908917.gif"
OUT = "momote-frontend/scripts/render/_sweep/edge-compare.png"
BG = (255, 246, 250)  # #fff6fa, the app background behind the thread
ZOOM = 5
# A slice through the knot, where the curvature makes stair-stepping worst.
CROP = (105, 0, 165, 47)

img = Image.open(SRC)
frames = [f.convert("RGBA") for f in ImageSequence.Iterator(img)]

bbox = None
for frame in frames:
    fb = frame.getbbox()
    if fb:
        bbox = list(fb) if bbox is None else [
            min(bbox[0], fb[0]), min(bbox[1], fb[1]),
            max(bbox[2], fb[2]), max(bbox[3], fb[3]),
        ]
box = (max(0, bbox[0] - 2), max(0, bbox[1] - 2),
       min(img.size[0], bbox[2] + 2), min(img.size[1], bbox[3] + 2))

counts = Counter()
for frame in frames:
    for r, g, b, a in frame.getdata():
        if a > 0:
            counts[(r, g, b)] += 1
stroke = counts.most_common(1)[0][0]

frame = frames[0].crop(box)
frame.putdata([(stroke[0], stroke[1], stroke[2], 0) if a == 0 else (r, g, b, a)
               for r, g, b, a in frame.getdata()])

raw = frame.crop(CROP)
smooth = frame.resize((frame.size[0] * 4, frame.size[1] * 4), Image.LANCZOS) \
              .resize(frame.size, Image.LANCZOS).crop(CROP)


def on_bg(im):
    plate = Image.new("RGBA", im.size, BG + (255,))
    plate.alpha_composite(im)
    return plate.convert("RGB").resize(
        (im.size[0] * ZOOM, im.size[1] * ZOOM), Image.NEAREST)


a, b = on_bg(raw), on_bg(smooth)
sheet = Image.new("RGB", (a.size[0], a.size[1] * 2 + 8), (40, 40, 40))
sheet.paste(a, (0, 0))
sheet.paste(b, (0, a.size[1] + 8))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sheet.save(OUT)
print(f"top = raw GIF (1-bit alpha), bottom = supersampled (8-bit alpha), {ZOOM}x nearest zoom")
print(f"wrote {OUT}  {sheet.size}")
