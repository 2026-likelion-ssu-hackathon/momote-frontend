"""Contact sheet of an animated GIF's frames on the app background — used both to identify which
mood an incoming export represents and to confirm a re-encode kept its palette and transparency
intact (a botched transparency index shows up as solid blocks).

Output goes next to this script regardless of where it is run from, so it works from whatever
directory the GIFs happen to live in:

    cd ~/Desktop/실 && python ../momote-frontend/scripts/render/gif_contact_sheet.py *.gif
"""

import os
import sys

from PIL import Image, ImageSequence

BG = (255, 246, 250)
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_sweep")
os.makedirs(OUT_DIR, exist_ok=True)

for path in sys.argv[1:]:
    img = Image.open(path)
    frames = [f.convert("RGBA") for f in ImageSequence.Iterator(img)]
    step = max(1, len(frames) // 6)
    picks = [frames[i] for i in range(0, len(frames), step)][:6]

    w, h = picks[0].size
    sheet = Image.new("RGB", (w, (h + 4) * len(picks)), (40, 40, 40))
    for i, frame in enumerate(picks):
        plate = Image.new("RGBA", frame.size, BG + (255,))
        plate.alpha_composite(frame)
        sheet.paste(plate.convert("RGB"), (0, i * (h + 4)))

    out = os.path.join(OUT_DIR, f"contact-{os.path.splitext(os.path.basename(path))[0]}.png")
    sheet.save(out)
    print(f"{path}: {len(frames)} frames, sampled {len(picks)} -> {out}")
