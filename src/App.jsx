import { useEffect, useRef, useState } from 'react'
import arrowUpIcon from './assets/icons/arrow-up.svg'

function formatTimeKorean(date) {
  const hours = date.getHours()
  const period = hours < 12 ? '오전' : '오후'
  const h = hours % 12 || 12
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${period} ${h}:${mm}`
}

function formatDateKorean(date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`
}

const MOOD_TENSE_KEYWORDS = ['싫어', '짜증', '화나', '화났', '삐졌', '삐침', '서운', '헐', 'ㅡㅡ', '몰라', '됐어', '그만', '실망', '왜그래', '뭐라고', '싸우']
const LOVE_KEYWORDS = ['사랑해', '좋아해', '사랑']
const MOOD_HISTORY_SIZE = 6

const SUGGESTION_DATE_KEYWORDS = ['데이트', '코스', '어디', '장소', '놀러', '여행', '만나']
const SUGGESTION_VIDEO_KEYWORDS = ['영상', '유튜브', '영화', '유튭']

const DUMMY_REPLIES = [
  '오 좋다!',
  '음... 잘 모르겠는데 ㅎㅎ',
  '그래 완전 좋아!',
  '우와 진짜?',
  '나도 그렇게 생각해',
  '오키오키',
  '조금 더 생각해볼게',
  'ㅋㅋㅋ 재밌겠다',
  '좋아 그렇게 하자',
  '흠... 다른 것도 찾아볼까?',
]

const KEYWORD_REPLY_RULES = [
  // Checked first (see getReplyFor) so an aggressive message can draw an aggressive reply back —
  // the thread's tense state (see getThreadStateFromMessages) reacts to either side, so this is
  // what makes "상대방이 격한 멘트를 했을 때" actually reachable from the chat instead of only ever
  // being triggered by the user's own messages.
  { keywords: MOOD_TENSE_KEYWORDS, replies: ['됐어 그만해', '너 왜그래 진짜', '나도 화났어', '헐 실망이다 진짜', '몰라 됐어'] },
  { keywords: ['어디', '장소', '여기', '거기'], replies: ['음.. 잠실 어때?', '성수 쪽도 괜찮을 것 같아', '가까운 데로 가자!'] },
  { keywords: ['언제', '몇시', '시간'], replies: ['오늘 저녁 어때?', '주말이 좋을 것 같은데', '너 시간 될 때 아무때나!'] },
  { keywords: ['뭐', '무엇', '뭘'], replies: ['글쎄 뭐가 좋을까 ㅎㅎ', '새로운 거 해볼까?', '너 하고 싶은 거 있어?'] },
  { keywords: ['밥', '먹', '맛집', '저녁', '점심', '배고'], replies: ['오 맛집 가고 싶다!', '나 배고파 ㅋㅋ', '뭐 먹을지 찾아볼게'] },
  { keywords: ['좋아', '좋다', '콜', '가자', 'ㅇㅋ', '오케이'], replies: ['좋아 그럼 그렇게 하자!', '완전 좋지!', '콜콜!'] },
  { keywords: ['안녕', 'hi', 'hello'], replies: ['안녕! 오늘 뭐하고 있었어?', '안녕안녕 ㅎㅎ'] },
  { keywords: ['고마워', '고맙'], replies: ['ㅎㅎ 뭘 이런 걸로', '아니야 나도 좋았어!'] },
  { keywords: ['?', '？'], replies: ['음 글쎄, 잘 모르겠어 ㅎㅎ', '오 그러게? 생각해볼게'] },
]

function getReplyFor(text) {
  const rule = KEYWORD_REPLY_RULES.find((r) => r.keywords.some((k) => text.includes(k)))
  const pool = rule ? rule.replies : DUMMY_REPLIES
  return pool[Math.floor(Math.random() * pool.length)]
}

// Stand-in for the AI worker that will eventually classify the conversation (see the TODO in
// App()). Keyword-based, checked in this fixed order only as a same-message tie-break (e.g. a
// message that's somehow both angry and affectionate reads as tense) — which category actually
// wins the conversation is decided by recency, not this order (see its callers below).
function messageTopic(text) {
  if (LOVE_KEYWORDS.some((k) => text.includes(k))) return 'love'
  if (MOOD_TENSE_KEYWORDS.some((k) => text.includes(k))) return 'tense'
  if (SUGGESTION_DATE_KEYWORDS.some((k) => text.includes(k))) return 'date'
  if (SUGGESTION_VIDEO_KEYWORDS.some((k) => text.includes(k))) return 'video'
  return null
}

// Stand-in for the AI worker that will eventually classify the whole conversation in one call. This
// already has the shape that call will have — async, takes the message list, returns every field it
// owns together — even though today it just resolves synchronously from the keyword heuristics
// below. Swapping in the real worker later means replacing this function's body with a network call
// (probably sending `recent` as-is); its one caller in App() already awaits it and won't need to
// change. Scans newest-first so the *most recent* topic wins each field — otherwise an older topic
// sitting anywhere in the recent window would keep outranking whatever the conversation has actually
// moved on to (see messageTopic for the same-message tie-break when one message hits multiple
// keyword lists at once).
async function classifyConversation(messages) {
  const recent = messages.slice(-MOOD_HISTORY_SIZE)
  let threadState = null
  let suggestionType = null
  let tenseTrigger = null

  for (let i = recent.length - 1; i >= 0; i--) {
    const message = recent[i]
    const topic = messageTopic(message.text)

    // Tense is the one topic that reacts to either side of the conversation — an aggressive reply
    // should tense the thread too — so it's resolved before the `mine`-only guard below. `mine`
    // decides which way the tense ThreadLine's burst travels (see its use in App()): my own
    // aggressive message crosses from my avatar to theirs, and one from them crosses back.
    if (topic === 'tense') {
      if (!tenseTrigger) tenseTrigger = { id: message.id, mine: message.mine }
      if (!threadState) threadState = 'tense'
    }
    if (!message.mine) continue

    // love/happy(date)/tangled(video) reflect the user's own tone/interest, so — unlike tense —
    // they don't count from the other person's messages.
    if (!threadState) {
      if (topic === 'love') threadState = 'love'
      else if (topic === 'date') threadState = 'happy'
      else if (topic === 'video') threadState = 'tangled'
    }
    if (!suggestionType) {
      if (topic === 'tense') suggestionType = 'toneCorrection'
      else if (topic === 'date') suggestionType = 'dateCourse'
      else if (topic === 'video') suggestionType = 'video'
    }
  }

  return {
    threadState: threadState ?? 'neutral',
    tenseTrigger,
    suggestionType: suggestionType ?? 'toneCorrection',
  }
}

// Avatar glow color per thread state (see getThreadStateFromMessages) — null means no glow,
// matching the plain look for ordinary/no-chat moments.
const THREAD_GLOW_COLORS = {
  tense: '#ff3b30',
  love: '#ff68d2',
  neutral: null,
  happy: '#31d123',
  tangled: '#3647ff',
}

// The small "feeling" line shown above the bold suggestion summary in the shared mood-card —
// one phrase per thread state, always present regardless of whether a suggestion situation is
// active, so the header text never contradicts what the thread itself is showing (e.g. a heart
// thread no longer borrows the tone-correction card's "공격적이에요" text just because that's
// suggestionType's fallback).
const THREAD_FEELING_TEXT = {
  neutral: '평온해요',
  love: '다정해 보여요',
  tangled: '서운해 보여요',
  happy: '신나 보여요',
  tense: '감정이 올라와요',
}

// The bold summary line only makes sense alongside a thread state that actually has a matching
// suggestion card behind it — love/neutral don't, so THREAD_TO_SUGGESTION has no entry for them
// and the header falls back to just the feeling line (see its use in App()).
const THREAD_TO_SUGGESTION = {
  tense: 'toneCorrection',
  happy: 'dateCourse',
  tangled: 'video',
}

// Sampled (not Bezier-approximated) sine wave for the "happy" thread — plotting exact y values at
// each x lets the amplitude reach all the way to the viewBox edges predictably, unlike a quadratic
// Bezier whose midpoint only travels halfway to its control point. `phaseOffset` shifts the whole
// curve sideways in viewBox units; animating through a sequence of offsets one period apart is what
// makes the crests visibly travel across instead of just pulsing in place.
const WAVE_PERIOD = 20
const WAVE_AMPLITUDE = 9
const WAVE_STEP_COUNT = 8
function buildWavePath(phaseOffset) {
  let d = ''
  for (let x = 0; x <= 100; x += 2.5) {
    const y = 10 + WAVE_AMPLITUDE * Math.sin((2 * Math.PI * (x - phaseOffset)) / WAVE_PERIOD)
    d += `${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(2)} `
  }
  return d.trim()
}
const WAVE_PATHS = Array.from({ length: WAVE_STEP_COUNT + 1 }, (_, i) => buildWavePath((i / WAVE_STEP_COUNT) * WAVE_PERIOD))

// Matches the user-provided reference: a tight, sharp, roughly symmetric double-spike zigzag (near
// -equal peak heights, not the deliberately irregular "삐죽삐죽" heights from an earlier iteration)
// bracketed by small approach/settle wiggles, its center offset from a flat baseline on both sides.
// Per the "격한 말이 상대에게 넘어가는" spec, the burst doesn't sit still and tremble — it travels the
// thread from the sender's side to the other person's, so `buildTenseBurstPath` re-centers the same
// burst shape at a given x and animating through a sequence of x's (see buildTensePaths) is what
// makes it read as crossing over rather than pulsing in place.
const TENSE_BURST = [
  [0, 14],
  [3, 14],
  [4.5, 17],
  [6, 14],
  [7, 2],
  [8.5, 26],
  [10, 2],
  [11.5, 26],
  [13, 14],
  [14.5, 11],
  [16, 14],
  [20, 14],
]
// One-shot, not a loop: a new tense-triggering message is meant to read as a single burst crossing
// over, not a standing animation that plays forever while the mood merely stays "tense" — see
// tenseTrigger in App(), which re-keys this path so it replays once per new aggressive message
// rather than continuously. Flat bookend frames at both ends make it ease out of and back into the
// idle flat line instead of popping in/out of the burst shape.
const TENSE_STEP_COUNT = 7
const TENSE_FLAT_PATH = 'M0 14 L100 14'
// centerX runs 8 (burst sitting inside the left avatar's own footprint, ~0-17 of the 100-wide
// viewBox) to 92 (inside the right avatar's) so the burst visibly emerges from one profile picture
// and arrives at the other's, instead of just crossing the middle stretch between them. `reversed`
// flips which avatar it starts/ends at: an aggressive message of mine crosses left (me) → right
// (them); an aggressive reply from them crosses right (them) → left (me) — see its use in
// ThreadLine, driven by tenseTrigger.mine in App().
function buildTensePaths(reversed) {
  const steps = Array.from({ length: TENSE_STEP_COUNT + 1 }, (_, i) => {
    const t = i / TENSE_STEP_COUNT
    return buildTenseBurstPath(8 + (reversed ? 1 - t : t) * 84)
  })
  return [TENSE_FLAT_PATH, ...steps, TENSE_FLAT_PATH]
}
function buildTenseBurstPath(centerX) {
  const points = TENSE_BURST.map(([dx, y]) => [centerX - 10 + dx, y])
  const first = points[0]
  const middle = points
    .slice(1)
    .map(([x, y]) => `L${x} ${y}`)
    .join(' ')
  return `M0 14 L${first[0]} ${first[1]} ${middle} L100 14`
}

// Chromium doesn't reliably auto-(re)start a `repeatCount="1"` <animate> just because a fresh
// element with new `values` was inserted — after the first burst ever plays in the document, later
// ones silently no-op (the `d` attribute updates but never animates). `begin="indefinite"` opts out
// of the unreliable implicit auto-start entirely, and the effect below explicitly calls
// `beginElement()` on every new tenseTrigger — which reliably (re)starts it regardless of how many
// times it's already played.
function TenseThreadLine({ tenseTrigger }) {
  const animateRef = useRef(null)
  const reversed = tenseTrigger ? !tenseTrigger.mine : false

  useEffect(() => {
    if (tenseTrigger) animateRef.current?.beginElement()
  }, [tenseTrigger?.id])

  return (
    <svg
      className="absolute inset-x-0 top-1/2 h-[28px] w-full -translate-y-1/2"
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      fill="none"
    >
      <path filter="url(#thread-crayon)" stroke="#f25597" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d={TENSE_FLAT_PATH}>
        <animate
          ref={animateRef}
          attributeName="d"
          values={buildTensePaths(reversed).join(';')}
          dur="4.5s"
          begin="indefinite"
          repeatCount="1"
          calcMode="linear"
        />
      </path>
    </svg>
  )
}

// Roughens an otherwise-clean stroke into a crayon/marker-like line — displacing the path through
// fractal noise instead of drawing a perfectly smooth vector. Defined once (see its use in App())
// and shared by every ThreadLine variant via `filter="url(#thread-crayon)"` so the whole thread
// has one consistent hand-drawn texture rather than a mix of smooth and rough strokes.
function ThreadCrayonFilter() {
  return (
    <svg width="0" height="0" className="absolute">
      <defs>
        {/* filterUnits is userSpaceOnUse, not the objectBoundingBox default, on purpose: several
            ThreadLine paths are perfectly horizontal (the flat seam runs into the love/tangled
            overlays) and so have a zero-height bounding box — a percentage-based region resolves
            its height to 0% of that and silently clips the entire filtered stroke invisible. Fixed
            bounds sized to comfortably cover every viewBox this filter is used in (up to "0 0 100
            16") sidesteps the issue for all of them at once. */}
        <filter id="thread-crayon" x="-20" y="-30" width="140" height="80" filterUnits="userSpaceOnUse">
          <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}

function ThreadLine({ mood, tenseTrigger }) {
  if (mood === 'tense') return <TenseThreadLine tenseTrigger={tenseTrigger} />

  if (mood === 'happy') {
    // Matches Figma 593:2214 — a continuous multi-hump sound wave whose crests visibly travel
    // across (see WAVE_PATHS) rather than pulsing in place.
    return (
      <svg
        className="absolute inset-x-0 top-1/2 h-[20px] w-full -translate-y-1/2"
        viewBox="0 0 100 20"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          filter="url(#thread-crayon)"
          stroke="#f3b6c2"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          d={WAVE_PATHS[0]}
        >
          <animate attributeName="d" values={WAVE_PATHS.join(';')} dur="1.4s" repeatCount="indefinite" calcMode="linear" />
        </path>
      </svg>
    )
  }

  // love/tangled: the connecting line itself stays two plain runs (drawn inside the same stretched
  // viewBox as the other states, where a constant-y or gently-curved segment isn't distorted by
  // the non-uniform x/y scale) with the heart/knot itself overlaid at the midpoint in its own
  // undistorted SVG, tails reaching to its edges so the string reads as continuous — a shape this
  // detailed would smear into an unrecognizable sliver if drawn directly inside the ~3:1
  // horizontally-stretched viewBox the other states use. The overlay is positioned with explicit
  // left/top/width/height (not the usual center-transform) and sized so its viewBox has no
  // letterboxing, so the exact pixel where its tail meets the main line can be computed and
  // matched instead of eyeballed — otherwise the seam shows a visible gap or thickness jump.
  if (mood === 'love') {
    return (
      <>
        <svg
          className="absolute inset-x-0 top-1/2 h-[16px] w-full -translate-y-1/2"
          viewBox="0 0 100 16"
          preserveAspectRatio="none"
          fill="none"
        >
          <path filter="url(#thread-crayon)" d="M0 8 L44 8" stroke="#f25597" strokeWidth="2" strokeLinecap="round" />
          <path filter="url(#thread-crayon)" d="M56 8 L100 8" stroke="#f25597" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {/* viewBox height grew from 24 to 26, and the container's from 30px to 32.5px, to fit the
            tip now hanging below the tail line (24 vs the tails' 21) without clipping — `top`
            stays the same -0.25px since that's anchored to the tails' y (still 21), not the tip. */}
        <svg className="heart-pulse absolute left-[128px] top-[-0.25px] h-[32.5px] w-[45px]" viewBox="0 0 36 26" fill="none">
          <path
            filter="url(#thread-crayon)"
            d="M0,21 L4,21 L18,24 C13,19 7,14 7,8 C7,4 10.5,2 14,2 C16,2 18,4 18,7 C18,4 20,2 22,2 C25.5,2 29,4 29,8 C29,14 23,19 18,24 L32,21 L36,21"
            stroke="#f25597"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </>
    )
  }

  // Matches Figma 620:2887 — a wavy string that ties itself into one big, clearly visible knot at
  // the midpoint rather than a small disconnected squiggle. The knot's own SVG is scaled up
  // (nearly as tall as the 52px avatar row) so it reads immediately, but that means it's scaled
  // uniformly (1.75x) while the wavy runs sit in a viewBox stretched non-uniformly (~3x horizontally
  // vs vertically) — matching stroke width takes dividing back by that 1.75x, and matching the seam
  // angle takes ending/starting both pieces on a perfectly flat (horizontal) tangent, since a flat
  // line stays flat under any independent x/y scaling. Without both fixes the join reads as a
  // visible kink with a sudden thickness change even when the endpoints line up exactly.
  if (mood === 'tangled') {
    return (
      <>
        <svg
          className="absolute inset-x-0 top-1/2 h-[16px] w-full -translate-y-1/2"
          viewBox="0 0 100 16"
          preserveAspectRatio="none"
          fill="none"
        >
          <path filter="url(#thread-crayon)" d="M0 8 Q11 3 22 8 Q30 13 36 8 L43 8" stroke="#f25597" strokeWidth="2" strokeLinecap="round" />
          <path filter="url(#thread-crayon)" d="M57 8 L64 8 Q72 3 78 8 Q89 13 100 8" stroke="#f25597" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {/* Centering (translate -50%/-50%) lives on this static outer wrapper, separate from the
            knot-strain animation's own transform on the inner svg below, so the two don't clobber
            each other (both would otherwise fight over the single `transform` property). */}
        <div className="absolute left-1/2 top-1/2 h-[42px] w-[42px] -translate-x-1/2 -translate-y-1/2">
          <svg className="knot-strain size-full" viewBox="0 0 24 24" fill="none">
            <path
              filter="url(#thread-crayon)"
              d="M0,12 C4,12 5,7 9,8 C13,9 16,6 14,10 C12.5,12.7 8,11 9,15 C10,19 16,18 17,14 C17.8,10.8 13,10 15,7 C16.5,4.7 20,6 20,10 C20,12 22,12 24,12"
              stroke="#f25597"
              strokeWidth="1.15"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </>
    )
  }

  return (
    <svg
      className="absolute inset-x-0 top-1/2 h-[16px] w-full -translate-y-1/2"
      viewBox="0 0 100 16"
      preserveAspectRatio="none"
      fill="none"
    >
      <path filter="url(#thread-crayon)" d="M10 3 Q50 18 90 3" stroke="#f3b6c2" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// KakaoTalk-style default profile — a plain silhouette on a solid color, no photo. `glow` (see
// THREAD_GLOW_COLORS) renders a soft colored halo behind it that changes with the thread state and
// pulses (see .avatar-glow in index.css) like a light flickering on/off, rather than sitting as a
// static blur; null/undefined leaves the avatar plain.
function DefaultAvatar({ glow }) {
  return (
    <div className="relative z-10 flex size-[52px] shrink-0 items-center justify-center">
      {glow && <div className="avatar-glow absolute inset-[-3px] rounded-full blur-[5px]" style={{ backgroundColor: glow }} />}
      <div className="relative flex size-[52px] items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#d9d9d9] shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
          <circle cx="15" cy="11" r="6" fill="white" fillOpacity="0.95" />
          <path d="M2 29c0-8 5.8-12.5 13-12.5S28 21 28 29" fill="white" fillOpacity="0.95" />
        </svg>
      </div>
    </div>
  )
}

function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`
}

function youtubeThumbnailUrl(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
}

// "유튜브 영상 추천" expanded-sheet state. `videoId`/`title`/`channel`/`note` come from an AI
// worker — the thumbnail image and click-through link are both derived from `videoId` via
// YouTube's public thumbnail CDN and watch URL, not separately generated. Title/channel truncate
// to one line (matches the design) instead of breaking the card's layout when the worker's text
// runs long; `note` wraps freely since it has no such length hint.
function VideoCard({
  videoId = 'dQw4w9WgXcQ',
  title = '연락문제로 속상할 때 봐야할 영상: 심리상담사가 알려주는 대화법',
  channel = '마음심리상담소',
  note = '연락 문제로 속상할 때 어떻게 상대의 진짜 마음을 확인하고 대화할지 구체적인 방법을 알려줘요',
}) {
  return (
    <div className="mx-auto flex w-[305px] flex-col items-center">
      <div className="h-px w-full bg-[#f4e0e5]" />

      <a
        href={youtubeWatchUrl(videoId)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-[10px] block w-full cursor-pointer overflow-hidden rounded-[16px] bg-white shadow-[0_4px_6px_rgba(9,9,9,0.1)] transition-transform duration-[120ms] ease-out hover:scale-[1.01] active:scale-[0.98]"
      >
        <img src={youtubeThumbnailUrl(videoId)} alt="" className="mx-auto mt-[8px] h-[112px] w-[266px] rounded-[10px] object-cover" />
        <div className="px-3 pb-[8px] pt-[14px]">
          <p className="truncate text-[12px] font-semibold text-black">{title}</p>
          <p className="mt-[2px] truncate text-[10px] font-medium text-black/50">{channel}</p>
        </div>
      </a>

      <p className="mt-[10px] whitespace-pre-wrap px-2 text-center text-[14px] leading-[18px] text-[#7d6a71]">{note}</p>
    </div>
  )
}

// Links out to a Kakao Map search for the place name — we only have the AI-worker's free-text
// name/description, not a real place ID or coordinates, so a keyword search is the closest we
// can get to "open this place on the map".
function kakaoMapSearchUrl(query) {
  return `https://map.kakao.com/link/search/${encodeURIComponent(query)}`
}

// Fixed h-44 + truncated single-line text (not whitespace-pre-wrap) so the card's size/shape never
// shifts once the AI worker starts filling in real place names/descriptions of varying length —
// only the text content changes, not the layout. Height (and the gaps in DateCourseCard around it)
// are tuned tight so 3 of these plus the closing note fit inside the 50% reveal zone without the
// panel needing to scroll internally.
function PlaceCard({ name, description }) {
  return (
    <a
      href={kakaoMapSearchUrl(name)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-[44px] w-full shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[15px] border-[3px] border-[#f4e0e5] bg-white/60 px-4 shadow-[0_3px_4px_rgba(43,43,43,0.25)] transition-transform duration-[120ms] ease-out hover:scale-[1.015] active:scale-[0.98]"
    >
      <p className="w-full truncate text-center text-[14px] font-semibold leading-[18px] text-[#562f3e]">{name}</p>
      <p className="w-full truncate text-center text-[11px] tracking-[0.11px] text-[#7d6a71]">{description}</p>
    </a>
  )
}

// "데이트 코스 추천" expanded-sheet state. `places`/`note` come from an AI worker, so place count
// and text length can vary — the spacing below is tuned for the default 3-place/1-line-note case to
// fit the shared 50% reveal zone with no internal scroll (see SUGGESTION_ZONE_HEIGHT); a worker
// response with noticeably more content would still fall back to scrolling. The summary line renders
// in the shared mood-card above (see DATE_COURSE_STATUS in App()), not duplicated here.
function DateCourseCard({
  places = [
    { name: '롯데시네마 월드타워', description: '서울 송파구 올림픽로의 영화관' },
    { name: '잠실 석촌호수', description: '벚꽃길이 예쁜 산책 코스' },
    { name: '롯데월드타워 서울스카이', description: '야경이 멋진 전망대' },
  ],
  note = '롯데월드 가고 싶다고 하신 주말 계획을 반영했어요',
}) {
  return (
    <div className="mx-auto flex w-[305px] flex-col items-center">
      <div className="h-px w-full bg-[#f4e0e5]" />

      <div className="mt-[8px] flex w-full flex-col gap-[10px]">
        {places.map((place, i) => (
          <PlaceCard key={i} name={place.name} description={place.description} />
        ))}
      </div>

      <div className="mt-[10px] w-full px-[24px]">
        <p className="whitespace-pre-wrap text-center text-[13px] leading-[16px] tracking-[0.13px] text-[#7d6a71]">{note}</p>
      </div>
    </div>
  )
}

// "말투 교정" expanded-sheet state. `suggestion`/`reason` come from an AI worker — `suggestion`
// can run a few lines, but `reason` is capped at 2 lines by the worker's prompt, so this never
// needs to scroll. The summary line for this same suggestion renders in the shared mood-card above
// (see TONE_CORRECTION_STATUS in App()), not duplicated here.
function ToneCorrectionCard({
  suggestion = '네가 약속 시간에 늦을 때, 내가 기다리느라 시간이 많이 걸리고 힘들어. 그래서 많이 속상했어. 다음에는 미리 연락해 주면 좋겠어.',
  reason = "'돼지같은 소리'라는 표현이 공격적으로 들릴 수 있어요.",
}) {
  return (
    <div className="mx-auto flex w-[305px] flex-col items-center">
      <div className="h-px w-full bg-[#f4e0e5]" />

      <p className="mt-[12px] text-center text-[17px] font-bold tracking-[0.17px] text-[#7d6a71]">대신 이렇게 말해보세요!</p>

      <div className="relative mt-[10px] w-full rounded-[29px] border-[3px] border-[#f4e0e5] bg-white/60 px-5 py-6 shadow-[0_3px_4px_rgba(43,43,43,0.25)]">
        <span className="absolute left-3 top-[-14px] rotate-180 text-[30px] leading-none tracking-[0.3px] text-[#562f3e]">”</span>
        <span className="absolute right-3 top-[-14px] text-[30px] leading-none tracking-[0.3px] text-[#562f3e]">”</span>
        <p className="whitespace-pre-wrap text-center text-[14.5px] font-semibold leading-[19px] tracking-[0.145px] text-[#562f3e]">{suggestion}</p>
      </div>

      <p className="mt-[12px] whitespace-pre-wrap px-2 text-center text-[16px] leading-[19px] tracking-[0.16px] text-[#7d6a71]">{reason}</p>
    </div>
  )
}

// Feeling/summary shown in the shared mood-card when the tone-correction suggestion is active —
// same AI-worker output as ToneCorrectionCard's suggestion/reason, surfaced up top as the mood-card's
// bold summary line instead of repeated inside the card below. The feeling line above it now comes
// from THREAD_FEELING_TEXT instead (one per thread state, not per suggestion) — see its use in App().
const TONE_CORRECTION_STATUS = '지금 표현이 너무 공격적이에요'

// Same idea as TONE_CORRECTION_STATUS, for when the "데이트 코스 추천" suggestion is active — same
// AI-worker output as DateCourseCard's places/note.
const DATE_COURSE_STATUS = '잠실 롯데월드 영화 데이트 코스'

// Same idea, for when the "유튜브 영상 추천" suggestion is active.
const VIDEO_STATUS = '비슷한 상황을 다룬 추천 영상이에요'

// Maps each "situation" to the single card shown in the one shared 50% reveal zone, and to the
// bold summary text shown in the shared mood-card above it. Which key is active will come from
// an AI worker classifying the conversation — see the suggestionType TODO in App().
const SUGGESTION_SCREENS = {
  toneCorrection: ToneCorrectionCard,
  dateCourse: DateCourseCard,
  video: VideoCard,
}

const SUGGESTION_STATUS = {
  toneCorrection: TONE_CORRECTION_STATUS,
  dateCourse: DATE_COURSE_STATUS,
  video: VIDEO_STATUS,
}

function StatusBar() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(id)
  }, [])

  const timeText = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`

  return (
    <div className="relative flex h-[40px] shrink-0 items-center justify-between px-[18px]">
      <span className="text-[13px] font-semibold tracking-tight text-[#1a1a1a]">{timeText}</span>

      <div className="absolute left-1/2 top-1/2 h-[26px] w-[84px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black" />

      <div className="flex items-center gap-[6px]">
        <svg width="16" height="11" viewBox="0 0 18 12" fill="none">
          <rect x="0" y="7" width="3" height="5" rx="0.7" fill="#1a1a1a" />
          <rect x="5" y="5" width="3" height="7" rx="0.7" fill="#1a1a1a" />
          <rect x="10" y="3" width="3" height="9" rx="0.7" fill="#1a1a1a" />
          <rect x="15" y="0" width="3" height="12" rx="0.7" fill="#1a1a1a" />
        </svg>
        <svg width="15" height="11" viewBox="0 0 16 12" fill="none">
          <circle cx="8" cy="10.5" r="1.3" fill="#1a1a1a" />
          <path
            d="M4.7 8a4.7 4.7 0 016.6 0L9.9 9.4a2.7 2.7 0 00-3.8 0L4.7 8z"
            fill="#1a1a1a"
          />
          <path
            d="M1.8 5.1a8.7 8.7 0 0112.4 0l-1.4 1.4a6.7 6.7 0 00-9.6 0L1.8 5.1z"
            fill="#1a1a1a"
          />
        </svg>
        <svg width="22" height="11" viewBox="0 0 25 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="2.5" stroke="#1a1a1a" strokeOpacity="0.4" />
          <rect x="2" y="2" width="18" height="8" rx="1.5" fill="#1a1a1a" />
          <rect x="22.5" y="4" width="1.5" height="4" rx="0.7" fill="#1a1a1a" fillOpacity="0.4" />
        </svg>
      </div>
    </div>
  )
}

function DateDivider({ label }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-[#e0cbce]" />
      <span className="shrink-0 font-['Instrument_Sans',sans-serif] text-[11px] font-semibold text-[#907177]">
        {label}
      </span>
      <div className="h-px flex-1 bg-[#e0cbce]" />
    </div>
  )
}

function ChatBubbleRow({ text, mine, time, isFirstInRun, isLastInRun }) {
  const corner = mine
    ? isFirstInRun
      ? 'rounded-tl-[22px] rounded-tr-[22px] rounded-bl-[22px] rounded-br-[9px]'
      : 'rounded-[22px]'
    : isFirstInRun
      ? 'rounded-tl-[22px] rounded-tr-[22px] rounded-bl-[9px] rounded-br-[22px]'
      : 'rounded-[22px]'

  const bubbleAppearance = mine
    ? 'border border-[#e3d7f8]/60 bg-white/50 text-[#23302f] shadow-[0_2px_8px_rgba(92,62,98,0.1)]'
    : 'border border-[#e3d7f8] bg-[#fefefe] text-[#23302f] shadow-[0_2px_8px_rgba(92,62,98,0.08)]'

  const timeLabel = isLastInRun ? (
    <span className="shrink-0 pb-0.5 font-['Instrument_Sans',sans-serif] text-[10px] text-[#907177]">
      {formatTimeKorean(time)}
    </span>
  ) : null

  return (
    <div className={`flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
      {mine && timeLabel}
      <div className={`max-w-[70%] px-[15px] py-[8px] text-[15px] font-medium ${bubbleAppearance} ${corner}`}>
        <span className="whitespace-pre-wrap break-words">{text}</span>
      </div>
      {!mine && timeLabel}
    </div>
  )
}

// Shown in place of the reply while it's "being typed" — same bubble shape/position an incoming
// message from the other person would use, so it reads as a placeholder for one.
function TypingIndicator() {
  return (
    <div className="flex items-end justify-start gap-1.5">
      <div className="flex items-center gap-[4px] rounded-tl-[22px] rounded-tr-[22px] rounded-bl-[9px] rounded-br-[22px] border border-[#e3d7f8] bg-[#fefefe] px-[15px] py-[11px] shadow-[0_2px_8px_rgba(92,62,98,0.08)]">
        <span className="typing-dot size-[6px] rounded-full bg-[#907177]" />
        <span className="typing-dot size-[6px] rounded-full bg-[#907177]" />
        <span className="typing-dot size-[6px] rounded-full bg-[#907177]" />
      </div>
    </div>
  )
}

// How long the "typing..." indicator (see TypingIndicator) shows before the auto-reply lands.
const TYPING_REPLY_DELAY_MS = 1500
const STATUS_BAR_HEIGHT = 40
const HEADER_HEIGHT = 135 // gap-8 + mood card (pt-16 + avatar row-52 + gap-10 + text-35 + pb-6 = 119) + gap-8
const INPUT_BAR_HEIGHT = 80 // pt-[8px] + h-[52px] + pb-[20px]
const FRAME_HEIGHT = 812
const FRAME_WIDTH = 375
// The suggestion panel's open height, as a fraction of the frame's total height (status bar +
// header included). Tone-correction and date-course both fit within the standard 50% reveal —
// DateCourseCard's own spacing is tuned to fit its 3 place cards + closing note in that height
// without needing to scroll internally; video opens a bit taller at 55%.
const SUGGESTION_ZONE_HEIGHT = Math.round(FRAME_HEIGHT * 0.5) - STATUS_BAR_HEIGHT - HEADER_HEIGHT
const VIDEO_ZONE_HEIGHT = Math.round(FRAME_HEIGHT * 0.55) - STATUS_BAR_HEIGHT - HEADER_HEIGHT
const SUGGESTION_ZONE_HEIGHTS = {
  toneCorrection: SUGGESTION_ZONE_HEIGHT,
  dateCourse: SUGGESTION_ZONE_HEIGHT,
  video: VIDEO_ZONE_HEIGHT,
}

function App() {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isOtherTyping, setIsOtherTyping] = useState(false)
  const bottomRef = useRef(null)
  const replyTimeoutIdsRef = useRef([])
  const [scale, setScale] = useState(1)

  useEffect(() => {
    function updateScale() {
      setScale(Math.min(1, window.innerHeight / FRAME_HEIGHT, window.innerWidth / FRAME_WIDTH))
    }
    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, isOtherTyping])

  useEffect(() => {
    return () => replyTimeoutIdsRef.current.forEach(clearTimeout)
  }, [])

  const hasMessages = messages.length > 0

  // Result of classifyConversation (see its definition for why this is async-shaped already) — the
  // thread's mood, which suggestion screen to show, and what triggered the tense burst all come
  // from one call over the current messages. `cancelled` guards against a stale, slower-to-resolve
  // call from an earlier `messages` value clobbering a newer one once this becomes a real network
  // call with variable latency.
  const [classification, setClassification] = useState({ threadState: 'neutral', tenseTrigger: null, suggestionType: 'toneCorrection' })
  useEffect(() => {
    let cancelled = false
    classifyConversation(messages).then((result) => {
      if (!cancelled) setClassification(result)
    })
    return () => {
      cancelled = true
    }
  }, [messages])
  const { threadState, tenseTrigger, suggestionType } = classification

  function handleSend() {
    const text = inputValue.trim()
    if (!text) return
    setMessages((prev) => [...prev, { id: Date.now(), text, mine: true, time: new Date() }])
    setInputValue('')
    setIsOtherTyping(true)

    const timeoutId = setTimeout(() => {
      setIsOtherTyping(false)
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), text: getReplyFor(text), mine: false, time: new Date() },
      ])
    }, TYPING_REPLY_DELAY_MS)
    replyTimeoutIdsRef.current.push(timeoutId)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleToggleSheet() {
    setIsSheetOpen((open) => !open)
  }

  const currentExpandPx = isSheetOpen ? SUGGESTION_ZONE_HEIGHTS[suggestionType] : 0
  const SuggestionCard = SUGGESTION_SCREENS[suggestionType]

  // Message list and input bar keep their full natural size at all times — the sheet is a
  // translucent, blurred overlay that floats above them as it grows, rather than shrinking them.
  const remainingPx = FRAME_HEIGHT - STATUS_BAR_HEIGHT - HEADER_HEIGHT
  const inputBarHeight = INPUT_BAR_HEIGHT
  const messageAreaHeight = remainingPx - inputBarHeight
  const sizeTransition = 'height 300ms ease-out'

  return (
    <div className="flex h-screen items-center justify-center overflow-hidden bg-[#fff5f7]">
      <div style={{ width: FRAME_WIDTH * scale, height: FRAME_HEIGHT * scale }}>
        <div
          style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          className="relative overflow-hidden bg-gradient-to-b from-[#fff6fa] to-[#ffa3c6]"
        >
        <ThreadCrayonFilter />
        {/* Message list and input bar sit at their full natural size underneath the sheet at all
            times — the sheet overlays them with blur/transparency instead of shrinking them away. */}
        <div
          style={{ top: `${STATUS_BAR_HEIGHT + HEADER_HEIGHT}px`, height: `${messageAreaHeight}px` }}
          className="chat-scroll absolute left-0 right-0 overflow-y-auto px-[17px] pb-[16px] pt-[14px]"
        >
          {hasMessages && (
            <>
              <DateDivider label={formatDateKorean(messages[0].time)} />
              <div className="mt-3 flex flex-col gap-1.5">
                {messages.map((message, i) => {
                  const prev = messages[i - 1]
                  const next = messages[i + 1]
                  return (
                    <ChatBubbleRow
                      key={message.id}
                      text={message.text}
                      mine={message.mine}
                      time={message.time}
                      isFirstInRun={!prev || prev.mine !== message.mine}
                      isLastInRun={!next || next.mine !== message.mine}
                    />
                  )
                })}
                {isOtherTyping && <TypingIndicator />}
                <div ref={bottomRef} />
              </div>
            </>
          )}
        </div>

        <div
          style={{ top: `${STATUS_BAR_HEIGHT + HEADER_HEIGHT + messageAreaHeight}px`, height: `${inputBarHeight}px` }}
          className="absolute left-0 right-0 overflow-hidden px-[12px] pb-[20px] pt-[8px]"
        >
          <div className="relative flex h-[52px] items-center gap-2 rounded-[26px] bg-white py-0 pl-[18px] pr-[8px] shadow-[0_6px_20px_rgba(232,80,125,0.16)]">
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메시지를 입력하세요"
              className="flex-1 bg-transparent text-[15px] font-medium text-[#271518] outline-none placeholder:text-[#c9a2a8]"
            />
            <button
              type="button"
              aria-label="전송"
              onClick={handleSend}
              className="flex size-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-gradient-to-br from-[#ff6e98] to-[#e8507d] shadow-[0_4px_12px_rgba(232,80,125,0.4)] transition-transform duration-[120ms] ease-out hover:scale-[1.06] active:scale-[0.92]"
            >
              <img src={arrowUpIcon} alt="" className="h-[17px] w-[12px] brightness-0 invert" />
            </button>
          </div>
        </div>

        <div
          style={{
            height: `${STATUS_BAR_HEIGHT + HEADER_HEIGHT + currentExpandPx}px`,
            transition: sizeTransition,
          }}
          className="absolute left-[10px] right-[10px] top-0 z-10 overflow-hidden rounded-[28px] border-2 border-[#f4e0e5] bg-gradient-to-br from-[#ffd6e0]/60 to-[#ffe6ec]/60 shadow-[0_4px_20px_rgba(92,62,98,0.15)] backdrop-blur-md"
        >
          <StatusBar />
          {/* Header content sits directly on the sheet's own card background/border above — no
              separate box of its own, so it reads as one continuous card with the expand zone below
              (matching Figma 643:2971, where only the inner quote box is separately bordered). */}
          <div className="absolute left-[17px] right-[17px] top-[48px] px-5 pt-4 pb-[6px]">
            <div className="relative -mx-[12px] flex h-[52px] items-center justify-between">
              <DefaultAvatar glow={THREAD_GLOW_COLORS[threadState]} />
              <ThreadLine mood={threadState} tenseTrigger={tenseTrigger} />
              <DefaultAvatar glow={THREAD_GLOW_COLORS[threadState]} />
            </div>
            <div className="mt-[10px] flex h-[35px] flex-col items-center justify-center gap-[3px] text-center">
              {!hasMessages ? (
                <span className="font-['Instrument_Sans',sans-serif] text-[13px] font-medium text-[#8a6f76]/70">
                  대화를 시작해보세요
                </span>
              ) : (
                <>
                  <span className="font-['Instrument_Sans',sans-serif] text-[12px] tracking-[0.08em] text-[#8a6f76]/70">
                    {THREAD_FEELING_TEXT[threadState]}
                  </span>
                  {THREAD_TO_SUGGESTION[threadState] === suggestionType && (
                    <span className="text-[14px] font-semibold text-[#f25597]">{SUGGESTION_STATUS[suggestionType]}</span>
                  )}
                </>
              )}
            </div>
          </div>
          {hasMessages && currentExpandPx > 0 && (
            <div
              style={{
                top: `${STATUS_BAR_HEIGHT + HEADER_HEIGHT}px`,
                height: `${currentExpandPx}px`,
                transition: sizeTransition,
              }}
              className="chat-scroll absolute left-0 right-0 overflow-y-auto px-[17px] pb-[8px] pt-0"
            >
              <SuggestionCard />
            </div>
          )}
        </div>

        {hasMessages && (
          <button
            type="button"
            aria-label={isSheetOpen ? '제안 닫기' : '제안 열기'}
            aria-expanded={isSheetOpen}
            onClick={handleToggleSheet}
            style={{
              top: `${STATUS_BAR_HEIGHT + HEADER_HEIGHT + currentExpandPx}px`,
              transition: 'top 300ms ease-out',
            }}
            className="absolute left-1/2 z-20 flex size-[16px] -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white shadow-[0_3px_10px_rgba(92,62,98,0.3)] transition-transform duration-[120ms] ease-out hover:scale-[1.08] active:scale-[0.92]"
          >
            <svg
              width="7"
              height="4.3"
              viewBox="0 0 13 8"
              fill="none"
              className="transition-transform duration-300 ease-out"
              style={{ transform: isSheetOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <path d="M1 1L6.5 6.5L12 1" stroke="#e8507d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        </div>
      </div>
    </div>
  )
}

export default App
