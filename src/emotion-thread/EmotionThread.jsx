import { useEffect, useRef } from 'react'
import { motion, useAnimationFrame, useMotionValue } from 'framer-motion'
import {
  BASELINE_Y,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  EMOTION_STATES,
  generateKnotThread,
  generateThread,
  getLiveParams,
  pointsToPath,
} from './shapes'

const TRANSITION_DURATION = 1.5 // seconds — within the spec's 1.2-1.8s window
const COLOR_LEAD = 0.2 // seconds — color transition starts this much before the shape (rule 5)

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function parseColor(color) {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const m = color.match(/rgba?\(([^)]+)\)/)
  const [r, g, b, a = 1] = m[1].split(',').map((s) => parseFloat(s))
  return { r, g, b, a }
}

function lerpColor(a, b, t) {
  const ca = parseColor(a)
  const cb = parseColor(b)
  return `rgba(${Math.round(lerp(ca.r, cb.r, t))}, ${Math.round(lerp(ca.g, cb.g, t))}, ${Math.round(lerp(ca.b, cb.b, t))}, ${lerp(ca.a, cb.a, t).toFixed(3)})`
}

// Cross-fades the two wave-family parameter sets directly (rule 3: ANGRY<->AGITATED skip the
// straight-line middle and just blend amplitude/frequency/irregularity numbers).
function blendWaveParams(from, to, t) {
  const numericKeys = ['amplitude', 'frequency', 'centerBias', 'irregular', 'sag', 'noise', 'edgeJitter', 'tremble']
  const blended = {}
  for (const key of numericKeys) blended[key] = lerp(from[key] ?? 0, to[key] ?? 0, t)
  blended.phase = to.phase ?? 0
  blended.time = to.time ?? 0
  blended.seed = t < 0.5 ? from.seed : to.seed
  return blended
}

// Flattens a wave shape's deviation from baseline toward the middle of a transition — the "실이
// 풀리며 완만해지는" half of rule 2, applied only to the wave side of a wave<->knot transition (a
// knot-involved crossfade already gets its "unwinding" motion from the knot tying/untying itself).
function settleWaveTowardBaseline(points, t) {
  const factor = 1 - 0.5 * 4 * t * (1 - t)
  return points.map((p) => ({ x: p.x, y: BASELINE_Y + (p.y - BASELINE_Y) * factor }))
}

function blendedPoints(fromKey, toKey, t, timeSec) {
  const fromDef = EMOTION_STATES[fromKey]
  const toDef = EMOTION_STATES[toKey]
  const fromLive = getLiveParams(fromKey, timeSec)
  const toLive = getLiveParams(toKey, timeSec)

  if (fromDef.topology === 'wave' && toDef.topology === 'wave') {
    return generateThread(toKey, blendWaveParams(fromLive, toLive, t))
  }

  const fromPoints =
    fromDef.topology === 'knot'
      ? generateKnotThread({ ...fromLive, knotProgress: (fromLive.knotProgress ?? 1) * (1 - t) })
      : settleWaveTowardBaseline(generateThread(fromKey, fromLive), t)
  const toPoints =
    toDef.topology === 'knot'
      ? generateKnotThread({ ...toLive, knotProgress: (toLive.knotProgress ?? 1) * t })
      : settleWaveTowardBaseline(generateThread(toKey, toLive), t)

  return fromPoints.map((p, i) => ({ x: lerp(p.x, toPoints[i].x, t), y: lerp(p.y, toPoints[i].y, t) }))
}

// A hand-drawn crayon/chalk texture shared by every EmotionThread instance — same technique as the
// main app's thread filter (feTurbulence + feDisplacementMap), defined once via id.
export function EmotionThreadFilterDefs() {
  return (
    <svg width="0" height="0" className="absolute">
      <defs>
        <filter id="emotion-thread-crayon" x="-20%" y="-100%" width="140%" height="300%">
          <feTurbulence type="fractalNoise" baseFrequency="0.4" numOctaves="2" seed="5" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.3" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}

// <EmotionThread state="angry" /> — state is the whole API. Internally this owns a continuous
// requestAnimationFrame loop (via framer-motion's useAnimationFrame) that both drives idle motion
// while `state` is steady and morphs smoothly whenever `state` changes, per the transition rules
// in the spec (see blendedPoints/lerpColor above). Path `d` and colors are pushed through framer
// motion values so updates bypass React's render cycle every frame.
export default function EmotionThread({ state, width = 320, height = 130, onGlowColorChange }) {
  const currentKeyRef = useRef(state)
  const transitionRef = useRef(null) // { from, to, start } | null

  // Seeded synchronously (not left for the first rAF tick to fill in) so the thread has its correct
  // static shape from the very first paint even if the animation frame loop is delayed or throttled
  // (e.g. a backgrounded/inactive tab) — only the idle motion and transitions depend on rAF after that.
  const dMV = useMotionValue(pointsToPath(generateThread(state, getLiveParams(state, 0))))
  const strokeMV = useMotionValue(EMOTION_STATES[state].strokeColor)
  const glowMV = useMotionValue(EMOTION_STATES[state].glowColor)
  const opacityMV = useMotionValue(EMOTION_STATES[state].opacity)

  useEffect(() => {
    if (state !== currentKeyRef.current) {
      transitionRef.current = { from: currentKeyRef.current, to: state, start: null }
      currentKeyRef.current = state
    }
  }, [state])

  useAnimationFrame((t) => {
    const timeSec = t / 1000
    let fromKey = currentKeyRef.current
    let toKey = currentKeyRef.current
    let colorT = 1
    let shapeT = 1

    const active = transitionRef.current
    if (active) {
      if (active.start === null) active.start = timeSec
      const elapsed = timeSec - active.start
      fromKey = active.from
      toKey = active.to
      colorT = clamp01(elapsed / TRANSITION_DURATION)
      shapeT = clamp01((elapsed - COLOR_LEAD) / (TRANSITION_DURATION - COLOR_LEAD))
      if (elapsed >= TRANSITION_DURATION) transitionRef.current = null
    }

    const easedShapeT = easeInOutCubic(shapeT)
    const easedColorT = easeInOutCubic(colorT)

    const points = fromKey === toKey ? generateThread(toKey, getLiveParams(toKey, timeSec)) : blendedPoints(fromKey, toKey, easedShapeT, timeSec)
    dMV.set(pointsToPath(points))

    const fromDef = EMOTION_STATES[fromKey]
    const toDef = EMOTION_STATES[toKey]
    strokeMV.set(lerpColor(fromDef.strokeColor, toDef.strokeColor, easedColorT))
    const glow = lerpColor(fromDef.glowColor, toDef.glowColor, easedColorT)
    glowMV.set(glow)
    opacityMV.set(lerp(fromDef.opacity, toDef.opacity, easedColorT))
    onGlowColorChange?.(glow)
  })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      preserveAspectRatio="none"
      fill="none"
      style={{ overflow: 'visible', display: 'block' }}
    >
      <motion.path
        d={dMV}
        stroke={strokeMV}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{ opacity: opacityMV }}
        filter="url(#emotion-thread-crayon)"
      />
    </svg>
  )
}
