"""Prepare the team's animated thread GIFs for the app.

Three things are done to each export, all of them fixes for something that showed up on device:

1. **Crop to content.** The exported canvases have the visible stroke sitting well off-centre in
   otherwise empty space (the knot's content occupies y 39-82 of a 90px canvas), and the app centres
   the thread on the avatar row with `top-1/2 -translate-y-1/2` — so an uncropped asset centres the
   empty canvas instead of the line. That is exactly the "프로필과 연결되어있지 않다" bug already
   fixed once on the SVG side, and it would come straight back.

2. **Bridge the sweeping gap.** The tense export has a 41px-wide erased segment that travels along
   the line at 9px per frame, which reads on screen as the thread snapping apart mid-loop. It is in
   the source artwork, not introduced here. Columns with no ink are refilled by copying the same
   columns out of another *real frame* — one that has the line there and no spike passing through —
   so the repair keeps the stroke's true thickness and crayon texture. An earlier version composited
   a statistical "pixels opaque in most frames" template instead, which eroded the stroke to ~71% of
   its width (3.34 vs 4.68 ink px per column) and read on screen as a dotted line.

3. **Retime where asked.** See DELAY_MS.

The stroke pixels are otherwise left alone. Re-encoding was tried (2x LANCZOS -> animated WebP) to
turn GIF's 1-bit alpha into a soft 8-bit one, but on this artwork it only blurs the stroke — the
frames already carry their own colour variation along the edge, which reads as anti-aliasing at
display size — while costing 2-8x the bytes. See webp_sweep.py and edge_compare.py for those
measurements, and diagnose_tense.py for the per-frame colour/gap check this script is verified with.

    cd ~/Desktop && python momote-frontend/scripts/render/prepare_thread_gifs.py
"""

import os

from PIL import Image, ImageSequence

# Source GIF (path relative to the Desktop) -> thread mood it represents. Identified by rendering
# a contact sheet of each export's frames — see gif_contact_sheet.py.
SOURCES = {
    "KakaoTalk_20260818_205908917.gif": "tangled",
    "실/KakaoTalk_20260818_213122593.gif": "neutral",
    "실/KakaoTalk_20260818_213122593_01.gif": "love",
    "실/KakaoTalk_20260818_213910045.gif": "tense",
    "실/KakaoTalk_20260818_214325220.gif": "happy",
}

OUT_DIR = os.path.join("momote-frontend", "src", "assets", "thread")
MARGIN = 2

# A run of blank columns touching an edge is only repaired past this length. Interior breaks are
# always repaired — a hole in the middle of the thread is never intentional — but every asset ends
# with a few blank columns from the crop margin and the stroke's own taper (2-4px on the four
# well-behaved exports). Only tense stops genuinely short, by up to 34px, so this cleanly separates
# "the artwork ends here" from "the erased segment wrapped around the loop".
EDGE_REPAIR_MIN = 8

# Per-mood frame delay in ms, overriding whatever the export carries. tense arrives at 80ms/frame
# (2.4s loop), which read as far too frantic on device; 240ms walks the spike along over a 7.2s
# loop. Moods absent here keep their exported timing.
DELAY_MS = {
    "tense": 240,
}

# Per-mood upward lift, in px, applied to the ends of the thread. The amount ramps in as the square
# of the distance from the middle, so the centre of the artwork does not move at all — on love that
# keeps the heart exactly where it was drawn while both tails curl up. Applied before cropping, on
# the full canvas, so the raised ends can't run out of the content box.
END_LIFT_PX = {
    "love": 7,
}

# tense's resting stretch (everywhere the travelling spike isn't) is a hand-drawn line whose
# thickness wanders 2-7px and whose centre drifts up to ~2px column to column — normal "crayon"
# character on the other four assets, but tense now holds each frame for 240ms (see DELAY_MS), long
# enough for that per-column wobble to read as an uneven, slightly broken line instead of texture.
# Columns at or under this ink count are "resting line"; anything thicker is the spike itself, which
# is left completely untouched — an emotional waveform is supposed to look irregular.
BASELINE_INK_MAX = {
    "tense": 8,
}

# Fixed thickness the resting stretch is redrawn at, per mood — the median measured across all
# tense frames' resting columns (mean 4.8px, stdev 0.5px), so this reads as the same line weight the
# artwork already mostly draws, just without the ±1-2px per-column jitter.
BASELINE_STROKE_PX = {
    "tense": 5,
}


def smooth_baseline(frames, ink_max, stroke_px):
    """Flatten a mood's resting stretch to one constant-height, constant-thickness line per frame.

    A first version redrew each resting column at its own locally-averaged height instead of one
    shared height, on the assumption the line curves gently and only needed its noise smoothed out.
    Measuring the resting stretch's centre across the whole width and several frames showed
    otherwise — it never actually moves (32.0-36.0px for every frame checked, no drift between the
    two sides of the travelling spike) — so the per-column differences are pure noise, not a curve.
    Redrawing each column at its own (still slightly different, still rounded-to-the-pixel) height
    just traded soft hand-drawn wobble for hard-edged steps, which read worse. Collapsing the whole
    stretch to one shared height removes the steps instead of narrowing them.

    Per frame, independently: columns with ink at or under `ink_max` are "resting" and get replaced;
    columns above it are the spike itself and are left exactly as the artwork drew them — an
    emotional waveform is supposed to look irregular, only the line resting on either side of it
    isn't. The shared height is the median centre of the resting columns that have any ink at all,
    and the colour is sampled from the first such column — the assets are palette GIFs with no
    anti-aliasing gradient, so every resting pixel is already the identical solid colour.
    """
    w, h = frames[0].size
    out = []
    for frame in frames:
        ink = column_ink(frame)
        px = frame.load()
        baseline_xs = [x for x in range(w) if ink[x] <= ink_max]
        centers, color = [], None
        for x in baseline_xs:
            if ink[x] == 0:
                continue
            ys = [y for y in range(h) if px[x, y][3] > 0]
            centers.append((ys[0] + ys[-1]) / 2)
            if color is None:
                color = px[x, ys[len(ys) // 2]]
        if not centers:
            out.append(frame)
            continue

        centers.sort()
        mid = len(centers) // 2
        median_y = centers[mid] if len(centers) % 2 else (centers[mid - 1] + centers[mid]) / 2
        top = round(median_y - stroke_px / 2)

        new_frame = frame.copy()
        npx = new_frame.load()
        for x in baseline_xs:
            for y in range(h):
                npx[x, y] = (0, 0, 0, 0)
            for y in range(top, top + stroke_px):
                if 0 <= y < h:
                    npx[x, y] = color
        out.append(new_frame)
    return out


def load(path):
    img = Image.open(path)
    delays, frames = [], []
    for frame in ImageSequence.Iterator(img):
        delays.append(frame.info.get("duration", 80))
        frames.append(frame.convert("RGBA"))
    return img.size, delays, frames


def content_box(frames, canvas):
    """Union bounding box, so a stroke that only swings out mid-loop isn't clipped."""
    bbox = None
    for frame in frames:
        fb = frame.getbbox()
        if not fb:
            continue
        bbox = list(fb) if bbox is None else [
            min(bbox[0], fb[0]), min(bbox[1], fb[1]),
            max(bbox[2], fb[2]), max(bbox[3], fb[3]),
        ]
    return (
        max(0, bbox[0] - MARGIN), max(0, bbox[1] - MARGIN),
        min(canvas[0], bbox[2] + MARGIN), min(canvas[1], bbox[3] + MARGIN),
    )


def lift_ends(frames, lift):
    """Curl both ends of the thread upward by `lift` px, easing to nothing in the middle.

    The horizontal span is measured once across every frame so all of them bend along the same
    curve — measuring per frame would make the profile breathe as the artwork animates.
    """
    w, h = frames[0].size
    inked = [
        any(frame.load()[x, y][3] > 0 for frame in frames for y in range(h))
        for x in range(w)
    ]
    x0, x1 = inked.index(True), w - 1 - inked[::-1].index(True)
    centre = (x0 + x1) / 2
    half = max(1.0, (x1 - x0) / 2)

    out = []
    for frame in frames:
        src = frame.load()
        lifted = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        dst = lifted.load()
        for x in range(w):
            t = min(1.0, abs(x - centre) / half)
            dy = -round(lift * t * t)
            for y in range(h):
                if src[x, y][3] and 0 <= y + dy < h:
                    dst[x, y + dy] = src[x, y]
        out.append(lifted)
    return out


def column_ink(frame):
    """Opaque pixel count per column."""
    w, h = frame.size
    px = frame.load()
    return [sum(1 for y in range(h) if px[x, y][3] > 0) for x in range(w)]


def empty_runs(ink):
    """Maximal runs of columns with no ink, as (start, end) inclusive.

    Deliberately includes runs touching the left and right edges, not just breaks in the middle: the
    tense export's erased segment straddles the loop boundary, so on 4 of its 30 frames the line
    stops up to 34px short of an edge instead of showing an interior gap. Stretched avatar-to-avatar
    that reads as the thread coming away from a profile circle — the same defect, at the ends.
    """
    runs, start = [], None
    for x, n in enumerate(ink):
        if n == 0 and start is None:
            start = x
        elif n and start is not None:
            runs.append((start, x - 1))
            start = None
    if start is not None:
        runs.append((start, len(ink) - 1))
    return runs


def column_center_y(frame, x):
    """Vertical centre of a column's ink, or None if the column is blank."""
    w, h = frame.size
    px = frame.load()
    ys = [y for y in range(h) if px[x, y][3] > 0]
    return (min(ys) + max(ys)) / 2 if ys else None


def seam_offsets(frame, donor, a, b, w):
    """How far to shift the donated block vertically at each end so it meets the surviving line.

    Copying a donor's columns in unshifted lines up in thickness but not in height — the baseline
    wanders a little between frames, which left a ~3px step at the seam that reads as a kink. The
    two ends are matched independently and the shift is ramped across the span, so the repair leaves
    the line's height continuous at both joins instead of trading one break for two smaller ones.
    """
    left = right = None
    if a > 0:
        mine, theirs = column_center_y(frame, a - 1), column_center_y(donor, a)
        if mine is not None and theirs is not None:
            left = mine - theirs
    if b < w - 1:
        mine, theirs = column_center_y(frame, b + 1), column_center_y(donor, b)
        if mine is not None and theirs is not None:
            right = mine - theirs
    if left is None and right is None:
        return 0.0, 0.0
    if left is None:
        return right, right
    if right is None:
        return left, left
    return left, right


def pick_donor(inks, self_index, a, b):
    """Frame to copy columns a..b from: one that has the line across the whole span, carrying the
    least ink in it. Least ink means the flat baseline rather than the spike, so the repair splices
    in plain line and never a stray fragment of waveform. None if no frame covers the whole span."""
    best, best_ink = None, None
    for i, ink in enumerate(inks):
        if i == self_index or any(ink[x] == 0 for x in range(a, b + 1)):
            continue
        total = sum(ink[a:b + 1])
        if best_ink is None or total < best_ink:
            best, best_ink = i, total
    return best


def to_palette_frames(frames):
    """Quantise every frame against one shared palette, with index 0 reserved for transparency.

    Saving RGBA straight to GIF drops the alpha onto whatever colour lands on index 0, painting the
    background solid. The index shuffle is done explicitly here rather than with `point(i + 1)` on a
    P-mode image: that shifts pixel indices while leaving the palette in place, so every colour ends
    up reading one entry over — and on a flat single-colour export like the tense one, the only
    colour lands on an unset entry and the whole waveform renders black.
    """
    w, h = frames[0].size
    strip = Image.new("RGB", (w * len(frames), h))
    for i, frame in enumerate(frames):
        strip.paste(frame.convert("RGB"), (i * w, 0))
    master = strip.quantize(colors=255, method=Image.MEDIANCUT)
    palette = master.getpalette()[: 255 * 3]

    out = []
    for frame in frames:
        idx = frame.convert("RGB").quantize(palette=master, dither=Image.NONE).getdata()
        alpha = frame.getchannel("A").getdata()
        p = Image.new("P", (w, h))
        p.putpalette([0, 0, 0] + palette)  # index 0 is the transparent slot
        p.putdata([0 if a == 0 else i + 1 for i, a in zip(idx, alpha)])
        out.append(p)
    return out


os.makedirs(OUT_DIR, exist_ok=True)

for filename, mood in SOURCES.items():
    canvas, delays, frames = load(filename)
    if mood in END_LIFT_PX:
        frames = lift_ends(frames, END_LIFT_PX[mood])
    box = content_box(frames, canvas)
    cropped = [frame.crop(box) for frame in frames]
    w, h = cropped[0].size

    # Snapshot every frame before any repair, so donors are always original artwork and a repaired
    # frame can never end up patching another one.
    original = [frame.copy() for frame in cropped]
    inks = [column_ink(frame) for frame in original]

    filled_frames, filled_cols, fallbacks = 0, 0, 0
    for i, frame in enumerate(cropped):
        runs = [
            (a, b) for a, b in empty_runs(inks[i])
            if not (a == 0 or b == w - 1) or (b - a + 1) >= EDGE_REPAIR_MIN
        ]
        if not runs:
            continue
        px = frame.load()
        touched = 0
        for a, b in runs:
            donor = pick_donor(inks, i, a, b)
            left_dy, right_dy = (
                seam_offsets(frame, original[donor], a, b, w) if donor is not None else (0.0, 0.0)
            )
            span = max(1, b - a)
            for x in range(a, b + 1):
                # Whole-span donor when one exists; otherwise the thinnest frame covering this one
                # column. Real pixels either way — never a synthesised average.
                src_index, dy = donor, 0
                if src_index is None:
                    candidates = [j for j, ink in enumerate(inks) if j != i and ink[x]]
                    if not candidates:
                        continue
                    src_index = min(candidates, key=lambda j: inks[j][x])
                    fallbacks += 1
                else:
                    dy = round(left_dy + (right_dy - left_dy) * (x - a) / span)
                src = original[src_index].load()
                for y in range(h):
                    if src[x, y][3] and 0 <= y + dy < h:
                        px[x, y + dy] = src[x, y]
                touched += 1
        if touched:
            filled_frames += 1
            filled_cols += touched

    if mood in BASELINE_INK_MAX:
        cropped = smooth_baseline(cropped, BASELINE_INK_MAX[mood], BASELINE_STROKE_PX[mood])

    if mood in DELAY_MS:
        delays = [DELAY_MS[mood]] * len(delays)

    out_frames = to_palette_frames(cropped)
    out_path = os.path.join(OUT_DIR, f"{mood}.gif")
    out_frames[0].save(
        out_path,
        save_all=True,
        append_images=out_frames[1:],
        duration=delays,
        loop=0,
        format="GIF",
        transparency=0,
        disposal=2,
        optimize=False,
    )

    print(f"{filename} -> {out_path}")
    print(f"  crop   : {box}  (source canvas {canvas[0]}x{canvas[1]})")
    print(f"  output : {w}x{h}   aspect {(w / h):.3f}")
    print(f"  frames : {len(out_frames)}, {sum(delays)}ms loop ({delays[0]}ms/frame)")
    print(f"  repair : {filled_cols} columns across {filled_frames} frames ({fallbacks} fallbacks)")
    print(f"  size   : {os.path.getsize(out_path)} bytes (source {os.path.getsize(filename)})")
