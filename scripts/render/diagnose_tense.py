"""Compare the tense source GIF against the converted one, frame by frame, for the two problems
reported on device: the waveform rendering black, and the thread appearing broken mid-loop.

Reports per frame the opaque colours in use and where the horizontal ink runs stop, so a gap that
exists in the artwork can be told apart from one introduced by the re-encode.

    cd ~/Desktop && python momote-frontend/scripts/render/diagnose_tense.py
"""

from PIL import Image, ImageSequence

PAIRS = [
    ("source", "실/KakaoTalk_20260818_213910045.gif"),
    ("output", "momote-frontend/src/assets/thread/tense.gif"),
]


def ink_columns(frame):
    """Columns (x) that contain any opaque pixel."""
    w, h = frame.size
    px = frame.load()
    return [any(px[x, y][3] > 0 for y in range(h)) for x in range(w)]


def gaps(cols):
    """Runs of empty columns that sit between two inked columns — i.e. breaks in the line."""
    first = next((i for i, c in enumerate(cols) if c), None)
    last = next((len(cols) - 1 - i for i, c in enumerate(reversed(cols)) if c), None)
    if first is None:
        return []
    out, run = [], None
    for x in range(first, last + 1):
        if not cols[x]:
            run = x if run is None else run
        elif run is not None:
            out.append((run, x - 1, x - run))
            run = None
    return out


for label, path in PAIRS:
    img = Image.open(path)
    frames = [f.convert("RGBA") for f in ImageSequence.Iterator(img)]
    print(f"=== {label}: {path}")
    print(f"    canvas {img.size}, {len(frames)} frames")

    for i, frame in enumerate(frames):
        colors = {}
        for r, g, b, a in frame.getdata():
            if a > 0:
                colors[(r, g, b)] = colors.get((r, g, b), 0) + 1
        dark = sum(n for (r, g, b), n in colors.items() if r < 100 and g < 100 and b < 100)
        top = sorted(colors.items(), key=lambda kv: -kv[1])[:2]
        g = gaps(ink_columns(frame))
        big = [x for x in g if x[2] >= 3]
        if i % 5 == 0 or dark or big:
            top_s = " ".join(f"#{r:02X}{g_:02X}{b:02X}x{n}" for (r, g_, b), n in top)
            print(f"    f{i:02d} dark_px={dark:<6} top={top_s:<30} gaps>=3px={big}")
    print()
