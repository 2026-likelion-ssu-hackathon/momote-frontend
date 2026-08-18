"""Sample the opaque pixel colors of the Desktop GIFs so the conversion step can de-fringe
transparent pixels with the real stroke color.

    cd ~/Desktop && python momote-frontend/scripts/render/gif_colors.py
"""

import glob
from collections import Counter

from PIL import Image, ImageSequence

for path in sorted(glob.glob("*.gif")):
    img = Image.open(path)
    counts = Counter()
    for frame in ImageSequence.Iterator(img):
        rgba = frame.convert("RGBA")
        for r, g, b, a in rgba.getdata():
            if a > 0:
                counts[(r, g, b)] += 1
    print(path)
    for (r, g, b), n in counts.most_common(8):
        print(f"  #{r:02X}{g:02X}{b:02X}  x{n}")
    print("-" * 40)
