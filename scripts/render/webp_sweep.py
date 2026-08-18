"""Size/quality sweep for the animated-thread WebP encode, so the choice of scale/quality is made
against real numbers instead of a guess. Writes throwaway files into the scratch dir.

    cd ~/Desktop && python momote-frontend/scripts/render/webp_sweep.py
"""

import os
from collections import Counter

from PIL import Image, ImageSequence

SRC = "KakaoTalk_20260818_205908917.gif"
OUT = "momote-frontend/scripts/render/_sweep"
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC)
delays, frames = [], []
for frame in ImageSequence.Iterator(img):
    delays.append(frame.info.get("duration", 80))
    frames.append(frame.convert("RGBA"))

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

base = []
for frame in frames:
    c = frame.crop(box)
    c.putdata([(stroke[0], stroke[1], stroke[2], 0) if a == 0 else (r, g, b, a)
               for r, g, b, a in c.getdata()])
    base.append(c)

print(f"cropped 1x = {base[0].size[0]}x{base[0].size[1]}, {len(base)} frames")
print(f"source gif = {os.path.getsize(SRC)} bytes\n")

for scale in (1, 2):
    # For 1x, still supersample through 4x so the 1-bit alpha comes back anti-aliased.
    up = [f.resize((f.size[0] * 4, f.size[1] * 4), Image.LANCZOS) for f in base]
    target = (base[0].size[0] * scale, base[0].size[1] * scale)
    scaled = [f.resize(target, Image.LANCZOS) for f in up]
    for quality, alpha_quality in ((90, 100), (85, 90), (80, 80), (70, 70)):
        path = f"{OUT}/s{scale}_q{quality}_a{alpha_quality}.webp"
        scaled[0].save(path, save_all=True, append_images=scaled[1:], duration=delays,
                       loop=0, format="WEBP", lossless=False, quality=quality,
                       alpha_quality=alpha_quality, method=6)
        print(f"  {scale}x {target[0]}x{target[1]}  q={quality} aq={alpha_quality}"
              f"  -> {os.path.getsize(path):>7} bytes")
