"""Inspect animated GIFs dropped on the Desktop: size, frame count, per-frame delay, alpha usage.

Run from the Desktop (cwd must contain the .gif files) so no non-ASCII path ever
reaches the command line:
    cd ~/Desktop && python momote-frontend/scripts/render/inspect_gif.py
"""

import glob
import os

from PIL import Image, ImageSequence

for path in sorted(glob.glob("*.gif")):
    img = Image.open(path)
    frames = []
    delays = []
    for frame in ImageSequence.Iterator(img):
        delays.append(frame.info.get("duration", 0))
        frames.append(frame.convert("RGBA"))

    # Alpha usage across the whole animation.
    alphas = set()
    bbox = None
    for frame in frames:
        alpha = frame.getchannel("A")
        alphas.update(alpha.getextrema())
        fb = frame.getbbox()
        if fb:
            if bbox is None:
                bbox = list(fb)
            else:
                bbox[0] = min(bbox[0], fb[0])
                bbox[1] = min(bbox[1], fb[1])
                bbox[2] = max(bbox[2], fb[2])
                bbox[3] = max(bbox[3], fb[3])

    print(f"file      : {path}  ({os.path.getsize(path)} bytes)")
    print(f"canvas    : {img.size[0]} x {img.size[1]}")
    print(f"frames    : {len(frames)}")
    print(f"delays ms : {delays}")
    print(f"total ms  : {sum(delays)}")
    print(f"alpha ext : {sorted(alphas)}   (0=transparent, 255=opaque)")
    print(f"content bb: {bbox}")
    # Corner pixel tells us whether the background is transparent or matted to a color.
    print(f"px(0,0)   : {frames[0].getpixel((0, 0))}")
    print("-" * 60)
