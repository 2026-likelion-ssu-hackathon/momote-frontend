// Every emotion state's thread is sampled to the SAME number of (x, y) anchor points so any two
// states can be morphed by lerping point-by-point (see EmotionThread.jsx). Point 0 and the last
// point are always pinned to the fixed left/right avatar anchors (rule 1 of the spec) — every
// generator below is built so that holds regardless of its own internal shape.
export const POINT_COUNT = 64
const LEFT_COUNT = 12
const RIGHT_COUNT = 12
const WAVE_MID_COUNT = 40 // POINT_COUNT - LEFT_COUNT - RIGHT_COUNT
const KNOT_ENTRY_COUNT = 4
const KNOT_LOOP_COUNT = 32
const KNOT_EXIT_COUNT = 4 // LEFT_COUNT + KNOT_ENTRY_COUNT + KNOT_LOOP_COUNT + KNOT_EXIT_COUNT + RIGHT_COUNT === POINT_COUNT

export const CANVAS_WIDTH = 100
export const CANVAS_HEIGHT = 100
export const BASELINE_Y = 50
// Where the flat approach on each side hands off to the "feature" region in the middle — shared by
// every generator so point[i] means roughly the same thing ("on the left flat run" / "in the
// feature") across different states, which keeps index-by-index interpolation between very
// different shapes coherent instead of streaky.
const FEATURE_X_START = 30
const FEATURE_X_END = 70

function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function linspace(a, b, n) {
  if (n === 1) return [a]
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}

function flatSegment(x0, x1, n, { jitter = 0, seed = 1 } = {}) {
  const rand = mulberry32(seed)
  return linspace(x0, x1, n).map((x) => ({ x, y: BASELINE_Y + (jitter ? (rand() - 0.5) * 2 * jitter : 0) }))
}

// --- Wave family (ANGRY / COLD / AGITATED) --------------------------------------------------
// One shared shape function driven entirely by parameters, so ANGRY<->AGITATED (both wave-family)
// can morph by cross-fading these numbers directly instead of ever building two point sets (rule 3).
export function waveParams(overrides) {
  return {
    amplitude: 0, // peak height of the oscillation
    frequency: 0, // cycles across the feature span
    centerBias: 0, // 0 = amplitude uniform across the feature span (AGITATED); 1 = concentrated at the center (ANGRY) — a number, not a boolean, so ANGRY<->AGITATED can cross-fade it directly
    irregular: 0, // extra per-point randomness layered on top of the sine, concentrated where amplitude is — "불규칙한" spike heights
    sag: 0, // downward catenary-like bulge (COLD)
    noise: 0, // fine hand-drawn jitter across the whole line
    edgeJitter: 0, // jitter on the flat approach runs specifically ("양 끝은 미세하게 떨리는 거친 직선")
    phase: 0, // horizontal shift — animated over time for AGITATED's traveling wave
    tremble: 0, // amplitude of a smooth (non-random) time-based wobble — ANGRY's continuous idle jitter
    time: 0,
    seed: 1,
    ...overrides,
  }
}

export function generateWaveThread(params) {
  const p = waveParams(params)
  const rand = mulberry32(Math.floor(p.seed * 97) + 1)
  const left = flatSegment(0, FEATURE_X_START, LEFT_COUNT, { jitter: p.edgeJitter, seed: p.seed * 3 + 1 })
  const right = flatSegment(FEATURE_X_END, CANVAS_WIDTH, RIGHT_COUNT, { jitter: p.edgeJitter, seed: p.seed * 5 + 1 })

  const mid = []
  for (let i = 0; i < WAVE_MID_COUNT; i++) {
    const t = i / (WAVE_MID_COUNT - 1)
    const x = FEATURE_X_START + (FEATURE_X_END - FEATURE_X_START) * t
    let y = BASELINE_Y
    y += p.sag * Math.sin(Math.PI * t)
    const centeredEnvelope = Math.max(0, Math.cos(Math.PI * (t - 0.5)))
    const envelope = 1 + (centeredEnvelope - 1) * p.centerBias
    if (p.amplitude) y += p.amplitude * envelope * Math.sin(2 * Math.PI * p.frequency * t + p.phase)
    if (p.irregular) y += envelope * (rand() - 0.5) * 2 * p.irregular
    if (p.noise) y += (rand() - 0.5) * 2 * p.noise
    if (p.tremble) y += p.tremble * envelope * Math.sin(x * 0.9 + p.time * 8) + p.tremble * 0.5 * Math.sin(x * 1.7 - p.time * 11)
    mid.push({ x, y })
  }

  const points = [...left, ...mid, ...right]
  points[0] = { x: 0, y: BASELINE_Y }
  points[points.length - 1] = { x: CANVAS_WIDTH, y: BASELINE_Y }
  return points
}

// --- Knot family (HAPPY's heart / HURT's tangle) --------------------------------------------
// Both trace a closed loop that starts and ends at the same point (the tip), via a parametric
// curve sampled over s in [0, 1]. `knotProgress` scales the loop's size from that tip outward —
// 0 collapses it to a single point (fully "untied"), 1 is the full shape — which is what lets a
// transition into/out of a knot state read as the thread actually tying/untying (rule 4) rather
// than just sliding points around.
function loopOffset(kind, s, time) {
  if (kind === 'heart') {
    const t = Math.PI + s * 2 * Math.PI
    return {
      x: 16 * Math.sin(t) ** 3,
      y: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
    }
  }
  // tangle: two counter-rotating circles (spirograph-style) trace an irregular multi-loop scribble
  // that still closes up cleanly at s=0/1 since both frequencies are integers.
  const a = 2 * Math.PI * s
  const wobble = Math.sin(a * 3 + time * 0.6) * 0.15
  return {
    x: Math.cos(3 * a) * 10 + Math.cos(-5 * a + 1) * (6 + wobble),
    y: Math.sin(3 * a) * 10 + Math.sin(-5 * a + 1) * (6 + wobble),
  }
}

export function knotParams(overrides) {
  return {
    kind: 'heart', // 'heart' | 'tangle'
    knotProgress: 1,
    scale: 1,
    tipYOffset: 8, // how far below (heart) or at (tangle) the baseline the tip sits
    rotation: 0, // slow continuous spin — HURT's "조여지는" feel
    noise: 0,
    time: 0,
    seed: 1,
    ...overrides,
  }
}

export function generateKnotThread(params) {
  const p = knotParams(params)
  const rand = mulberry32(Math.floor(p.seed * 131) + 1)
  const tipX = (FEATURE_X_START + FEATURE_X_END) / 2
  const tipY = BASELINE_Y + p.tipYOffset
  const ref = loopOffset(p.kind, 0, p.time)
  const cos = Math.cos(p.rotation)
  const sin = Math.sin(p.rotation)

  function mapped(s) {
    const raw = loopOffset(p.kind, s, p.time)
    let dx = (raw.x - ref.x) * p.scale
    let dy = (raw.y - ref.y) * -p.scale // formula's +y is "up"; SVG's +y is down
    const rdx = dx * cos - dy * sin
    const rdy = dx * sin + dy * cos
    return { x: tipX + rdx * p.knotProgress, y: tipY + rdy * p.knotProgress }
  }

  const left = flatSegment(0, FEATURE_X_START, LEFT_COUNT, { seed: p.seed * 3 + 1 })
  const right = flatSegment(FEATURE_X_END, CANVAS_WIDTH, RIGHT_COUNT, { seed: p.seed * 5 + 1 })
  const entry = linspace(1 / (KNOT_ENTRY_COUNT + 1), KNOT_ENTRY_COUNT / (KNOT_ENTRY_COUNT + 1), KNOT_ENTRY_COUNT).map((t) => ({
    x: FEATURE_X_START + (tipX - FEATURE_X_START) * t,
    y: BASELINE_Y + (tipY - BASELINE_Y) * t,
  }))
  const exit = linspace(1 / (KNOT_EXIT_COUNT + 1), KNOT_EXIT_COUNT / (KNOT_EXIT_COUNT + 1), KNOT_EXIT_COUNT).map((t) => ({
    x: tipX + (FEATURE_X_END - tipX) * t,
    y: tipY + (BASELINE_Y - tipY) * t,
  }))
  const loop = linspace(0, 1, KNOT_LOOP_COUNT).map((s) => {
    const point = mapped(s)
    if (p.noise) {
      point.x += (rand() - 0.5) * 2 * p.noise
      point.y += (rand() - 0.5) * 2 * p.noise
    }
    return point
  })

  const points = [...left, ...entry, ...loop, ...exit, ...right]
  points[0] = { x: 0, y: BASELINE_Y }
  points[points.length - 1] = { x: CANVAS_WIDTH, y: BASELINE_Y }
  return points
}

export function pointsToPath(points) {
  return points.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

// --- The 5 states, defined purely as parameter sets (spec: "state = 파라미터 세트") -------------
export const EMOTION_STATES = {
  angry: {
    label: 'ANGRY',
    topology: 'wave',
    strokeColor: '#FF2D78',
    glowColor: 'rgba(255, 45, 120, 0.55)',
    opacity: 1,
    base: { amplitude: 20, frequency: 7, centerBias: 1, irregular: 6, noise: 0.5, edgeJitter: 0.7, tremble: 1.6, seed: 2 },
  },
  happy: {
    label: 'HAPPY',
    topology: 'knot',
    kind: 'heart',
    strokeColor: '#FF6B9D',
    glowColor: 'rgba(255, 107, 157, 0.35)',
    opacity: 1,
    base: { kind: 'heart', scale: 1.05, tipYOffset: 9, noise: 0.15, seed: 4 },
  },
  cold: {
    label: 'COLD',
    topology: 'wave',
    strokeColor: '#FFB6C9',
    glowColor: 'rgba(255, 182, 201, 0)',
    opacity: 0.55,
    base: { sag: 15, noise: 0.15, edgeJitter: 0.1, seed: 6 },
  },
  agitated: {
    label: 'AGITATED',
    topology: 'wave',
    strokeColor: '#FF6B9D',
    glowColor: 'rgba(163, 217, 92, 0.5)',
    opacity: 1,
    base: { amplitude: 16, frequency: 3, centerBias: 0, noise: 0.25, edgeJitter: 0.2, seed: 8 },
  },
  hurt: {
    label: 'HURT',
    topology: 'knot',
    kind: 'tangle',
    strokeColor: '#E893AE',
    glowColor: 'rgba(150, 110, 220, 0.45)',
    opacity: 0.9,
    base: { kind: 'tangle', scale: 0.85, tipYOffset: 0, noise: 0.3, seed: 10 },
  },
}

// Per-state idle motion, layered on top of `base` using the current animation-frame time — this is
// what keeps every state visibly "alive" rather than frozen once a transition finishes: ANGRY
// trembles continuously, AGITATED's wave visibly travels, HAPPY's heart beats, HURT's knot
// slowly winds tighter, COLD stays nearly still.
export function getLiveParams(stateKey, timeSec) {
  const def = EMOTION_STATES[stateKey]
  if (def.topology === 'wave') {
    if (stateKey === 'agitated') return { ...def.base, phase: timeSec * 1.4, time: timeSec }
    return { ...def.base, time: timeSec }
  }
  if (stateKey === 'happy') {
    const heartbeat = 1 + 0.05 * Math.max(0, Math.sin(timeSec * ((2 * Math.PI) / 2.6)))
    return { ...def.base, scale: def.base.scale * heartbeat, time: timeSec }
  }
  // hurt
  return { ...def.base, rotation: timeSec * 0.12, time: timeSec }
}

export function generateThread(stateKey, liveParams) {
  const def = EMOTION_STATES[stateKey]
  return def.topology === 'wave' ? generateWaveThread(liveParams) : generateKnotThread(liveParams)
}
