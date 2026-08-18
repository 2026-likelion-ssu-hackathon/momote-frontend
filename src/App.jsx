import { useEffect, useRef, useState } from 'react'
import arrowUpIcon from './assets/icons/arrow-up.svg'
import speechBubbleIcon from './assets/icons/speech-bubble.svg'
import avatarBlue from './assets/avatars/avatar-blue.png'
import avatarPink from './assets/avatars/avatar-pink.png'

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

  for (let i = recent.length - 1; i >= 0; i--) {
    const message = recent[i]
    const topic = messageTopic(message.text)

    // Tense is the one topic that reacts to either side of the conversation — an aggressive reply
    // should tense the thread too — so it's resolved before the `mine`-only guard below.
    if (topic === 'tense' && !threadState) threadState = 'tense'
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
  tense: '감정이 올라왔어요',
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

// A tight, sharp zigzag bracketed by small approach/settle wiggles, its center offset from a flat
// baseline on both sides. Peak/valley heights are deliberately uneven (not a clean double-spike of
// matching amplitude) — an even, metronome-like burst reads as too controlled for "감정이 격해진"
// agitation; irregular heights read as more chaotic. Unlike a one-shot reaction to a single message,
// this loops continuously (see its use in ThreadLine below) so the tense mood reads as ongoing
// agitation for as long as the thread stays tense, not a burst that fires once and goes still.
const TENSE_BURST = [
  [0, 14],
  [3, 14],
  [4.5, 18],
  [6, 10],
  [7, 25],
  [8.5, 3],
  [10, 20],
  [11.5, 7],
  [13, 16],
  [14.5, 12],
  [16, 14],
  [20, 14],
]
const TENSE_STEP_COUNT = 7
const TENSE_FLAT_PATH = 'M0 14 L100 14'
// centerX runs 8 (burst sitting inside the left avatar's own footprint, ~0-17 of the 100-wide
// viewBox) to 92 (inside the right avatar's) so the burst visibly emerges from one profile picture
// and arrives at the other's, instead of just crossing the middle stretch between them.
function buildTenseBurstPath(centerX) {
  const points = TENSE_BURST.map(([dx, y]) => [centerX - 10 + dx, y])
  const first = points[0]
  const middle = points
    .slice(1)
    .map(([x, y]) => `L${x} ${y}`)
    .join(' ')
  return `M0 14 L${first[0]} ${first[1]} ${middle} L100 14`
}
const TENSE_PATHS = [
  TENSE_FLAT_PATH,
  ...Array.from({ length: TENSE_STEP_COUNT + 1 }, (_, i) => buildTenseBurstPath(8 + (i / TENSE_STEP_COUNT) * 84)),
  TENSE_FLAT_PATH,
]

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

function ThreadLine({ mood }) {
  if (mood === 'tense') {
    // Loops via repeatCount="indefinite" instead of firing once per aggressive message — the tense
    // mood itself should read as continuously agitated for as long as the thread stays tense.
    return (
      <svg
        className="absolute inset-x-0 top-1/2 h-[28px] w-full -translate-y-1/2"
        viewBox="0 0 100 28"
        preserveAspectRatio="none"
        fill="none"
      >
        <path filter="url(#thread-crayon)" stroke="#f25597" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d={TENSE_PATHS[0]}>
          <animate attributeName="d" values={TENSE_PATHS.join(';')} dur="3.2s" repeatCount="indefinite" calcMode="linear" />
        </path>
      </svg>
    )
  }

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
        {/* Percentage left/width, not fixed px — the container is now a responsive-width row (see the
            app's viewport conversion), so a hardcoded px offset drifts out of alignment with the gap
            left in the percentage-based main line above as the screen width changes. */}
        <svg className="heart-pulse absolute left-[42.52%] top-[-0.25px] h-[32.5px] w-[14.95%]" viewBox="0 0 36 26" fill="none">
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

// Default profile photo — the user's own placeholder artwork, recolored per side (see
// AVATAR_IMAGES) instead of hand-drawn, so the two participants read as a couple (blue/pink) rather
// than two identical gray silhouettes. `glow` (see THREAD_GLOW_COLORS) renders a soft colored halo
// behind it that changes with the thread state and pulses (see .avatar-glow in index.css) like a
// light flickering on/off, rather than sitting as a static blur; null/undefined leaves it plain.
const AVATAR_IMAGES = {
  blue: avatarBlue,
  pink: avatarPink,
}

function DefaultAvatar({ glow, side = 'blue' }) {
  return (
    <div className="relative z-10 flex size-[52px] shrink-0 items-center justify-center">
      {glow && <div className="avatar-glow absolute inset-[-3px] rounded-full blur-[5px]" style={{ backgroundColor: glow }} />}
      <div className="relative flex size-[52px] items-center justify-center overflow-hidden rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
        <img src={AVATAR_IMAGES[side]} alt="" className="size-full object-cover" />
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
    // Same fill-the-panel approach as DateCourseCard: h-full + a flex-grow spacer on each side of
    // the trailing note center it between the video card and the zone's bottom edge, in whatever
    // space is left, instead of a fixed margin that leaves dead space on a taller screen.
    <div className="mx-auto flex h-full w-full flex-col items-center">
      <div className="h-[1.2px] w-[calc(100%-70px)] shrink-0 bg-[#a6868e]/50" />

      <a
        href={youtubeWatchUrl(videoId)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-[10px] block w-[calc(100%-70px)] shrink-0 cursor-pointer overflow-hidden rounded-[20px] bg-white shadow-[0_4px_6px_rgba(9,9,9,0.1)] transition-transform duration-[120ms] ease-out hover:scale-[1.01] active:scale-[0.98]"
      >
        <img src={youtubeThumbnailUrl(videoId)} alt="" className="h-[112px] w-full object-cover" />
        <div className="px-3 pb-[8px] pt-[10px]">
          <p className="truncate text-[13px] font-semibold text-black">{title}</p>
          <p className="mt-[2px] truncate text-[11px] font-medium text-black/50">{channel}</p>
        </div>
      </a>

      <div aria-hidden="true" style={{ flexGrow: 1.7 }} />
      <p className="w-[calc(100%-70px)] shrink-0 whitespace-pre-wrap text-center font-['MemomentKkukkukk'] text-[16px] leading-[24px] tracking-[0.16px] text-[#7d6a71]">{note}</p>
      <div aria-hidden="true" style={{ flexGrow: 1.7 }} />
    </div>
  )
}

// Links out to a Kakao Map search for the place name — we only have the AI-worker's free-text
// name/description, not a real place ID or coordinates, so a keyword search is the closest we
// can get to "open this place on the map".
function kakaoMapSearchUrl(query) {
  return `https://map.kakao.com/link/search/${encodeURIComponent(query)}`
}

// Fixed h-52 (Figma 709:2538) + truncated single-line text (not whitespace-pre-wrap) so the card's
// size/shape never shifts once the AI worker starts filling in real place names/descriptions of
// varying length — only the text content changes, not the layout.
function PlaceCard({ name, description }) {
  return (
    <a
      href={kakaoMapSearchUrl(name)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-[52px] w-full shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[15px] border-2 border-[#f4e0e5] bg-white/80 px-4 shadow-[0_3px_4px_#ffcfdb] transition-transform duration-[120ms] ease-out hover:scale-[1.015] active:scale-[0.98]"
    >
      <p className="w-full truncate text-center text-[14px] font-semibold leading-[18px] text-[#562f3e]">{name}</p>
      <p className="w-full truncate text-center text-[11px] tracking-[0.11px] text-[#7d6a71]">{description}</p>
    </a>
  )
}

// "데이트 코스 추천" expanded-sheet state, spacing matched to Figma 709:2538 (divider→cards 15px,
// cards h-52 with a 10px gap between them, cards→note 21px). `places`/`note` come from an AI
// worker, so place count and text length can vary — a response with noticeably more content than
// the default 3-place/1-line-note case would fall back to scrolling (see SUGGESTION_ZONE_PERCENTS).
// The summary line renders in the shared mood-card above (see DATE_COURSE_STATUS in App()), not
// duplicated here.
function DateCourseCard({
  places = [
    { name: '롯데시네마 월드타워', description: '서울 송파구 올림픽로의 영화관' },
    { name: '잠실 석촌호수', description: '벚꽃길이 예쁜 산책 코스' },
    { name: '롯데월드타워 서울스카이', description: '야경이 멋진 전망대' },
  ],
  note = '롯데월드 가고 싶다고 하신 주말 계획을 반영했어요',
}) {
  return (
    // h-full + the flex-1 group below let the panel's actual available height (divider → the
    // bottom of the scroll zone, which varies with viewport/percent-vs-floor sizing) drive the
    // gaps directly via flex-grow spacers, not fixed px margins that would leave dead space on any
    // screen taller than the tuned minimum. Card→card spacers use a smaller grow value than the
    // two spacers straddling the note, so cards sit closer together while the note lands exactly
    // centered between the last card and the zone's bottom edge, in whatever space is left.
    <div className="mx-auto flex h-full w-full flex-col items-center">
      {/* The shared expand-zone scroll container already has its own 10px side padding — these
          calc() widths subtract that out so the FINAL visible margin from the sheet edge lands
          exactly on the requested 45px / 32px / 38px, not 10px more than that. */}
      <div className="h-[1.2px] w-[calc(100%-70px)] shrink-0 bg-[#a6868e]/50" />

      <div className="mt-[15px] flex w-full flex-1 flex-col items-center">
        {places.flatMap((place, i) => [
          <div key={`card-${i}`} className="w-[calc(100%-44px)] shrink-0">
            <PlaceCard name={place.name} description={place.description} />
          </div>,
          <div key={`gap-${i}`} aria-hidden="true" style={{ flexGrow: i === places.length - 1 ? 1.7 : 0.6 }} />,
        ])}
        <div className="w-[calc(100%-56px)] shrink-0">
          <p className="whitespace-pre-wrap text-center font-['MemomentKkukkukk'] text-[16px] leading-[19px] tracking-[0.13px] text-[#7d6a71]">{note}</p>
        </div>
        <div aria-hidden="true" style={{ flexGrow: 1.7 }} />
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
    // Same fill-the-panel approach as DateCourseCard: h-full + a flex-grow spacer on each side of
    // the trailing reason text center it between the quote box and the zone's bottom edge, in
    // whatever space is left, instead of a fixed margin that leaves dead space on a taller screen.
    <div className="mx-auto flex h-full w-full flex-col items-center">
      <div className="h-[1.2px] w-[calc(100%-70px)] shrink-0 bg-[#a6868e]/50" />

      <div className="mt-[12px] flex shrink-0 items-center gap-[3px]">
        <p className="text-center text-[14px] font-semibold tracking-[0.14px] text-[#7d6a71]">대신 이렇게 말해보세요!</p>
        <img src={speechBubbleIcon} alt="" className="size-[14px]" />
      </div>

      <div className="relative mt-[10px] w-[calc(100%-70px)] shrink-0 rounded-[29px] border-[1.2px] border-[#f4e0e5] bg-white/80 px-5 py-6 shadow-[0_2px_20px_rgba(255,207,219,0.7)]">
        <span className="absolute left-3 top-2 rotate-180 font-['MemomentKkukkukk'] text-[30px] leading-none tracking-[0.3px] text-[#562f3e]">”</span>
        <span className="absolute right-3 top-2 font-['MemomentKkukkukk'] text-[30px] leading-none tracking-[0.3px] text-[#562f3e]">”</span>
        <p className="whitespace-pre-wrap px-3 text-center text-[14px] font-semibold leading-[19px] tracking-[0.145px] text-[#562f3e]">{suggestion}</p>
      </div>

      <div aria-hidden="true" style={{ flexGrow: 1.7 }} />
      <p className="w-full shrink-0 whitespace-pre-wrap px-2 text-center font-['MemomentKkukkukk'] text-[16px] leading-[19px] tracking-[0.16px] text-[#7d6a71]">{reason}</p>
      <div aria-hidden="true" style={{ flexGrow: 1.7 }} />
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

  // Figma (node 709:2576/2601/2626) specs received bubbles as SemiBold and sent bubbles as
  // Medium — a real weight difference, not just an accident of which side happens to render first.
  const bubbleAppearance = mine
    ? 'border border-[#e3d7f8]/60 bg-white/50 text-[#23302f] shadow-[0_2px_8px_rgba(92,62,98,0.1)] font-medium'
    : 'border border-[#e3d7f8] bg-[#fefefe] text-[#23302f] shadow-[0_2px_8px_rgba(92,62,98,0.08)] font-semibold'

  const timeLabel = isLastInRun ? (
    <span className="shrink-0 pb-0.5 font-['MemomentKkukkukk'] text-[11.4px] text-[#907177]">
      {formatTimeKorean(time)}
    </span>
  ) : null

  return (
    <div className={`flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
      {mine && timeLabel}
      <div className={`max-w-[70%] px-[15px] py-[8px] text-[15px] ${bubbleAppearance} ${corner}`}>
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
const HEADER_FOOTPRINT_PX = STATUS_BAR_HEIGHT + HEADER_HEIGHT
// The suggestion panel's open height, as a percentage of the frame's own (now viewport-driven, not
// fixed) height — so it scales with whatever screen the app is actually running on instead of a
// single hardcoded design size. Tone-correction and date-course both fit within the standard 50%
// reveal — DateCourseCard's own spacing is tuned to fit its 3 place cards + closing note in that
// height (at typical phone-portrait proportions) without needing to scroll internally; video opens
// a bit taller at 55%.
const SUGGESTION_ZONE_PERCENTS = {
  toneCorrection: 50,
  dateCourse: 50,
  video: 55,
}
// Pixel floor for the revealed panel (not the whole sheet) — a pure percentage looks right on a
// normal phone-height screen, but on a short one (landscape, a small browser window) that same
// percentage can end up smaller than the tuned content, bringing back the internal scrollbar this
// was specifically tuned to avoid. `max(percent, minPx)` in sheetHeightValue keeps the percentage
// on tall screens and only floors it on short ones, so the panel's content never has to scroll —
// these numbers are the measured content height of each card plus a few px of margin.
const SUGGESTION_ZONE_MIN_PX = {
  toneCorrection: 230,
  dateCourse: 270,
  video: 270,
}

function App() {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isOtherTyping, setIsOtherTyping] = useState(false)
  const bottomRef = useRef(null)
  const replyTimeoutIdsRef = useRef([])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, isOtherTyping])

  useEffect(() => {
    return () => replyTimeoutIdsRef.current.forEach(clearTimeout)
  }, [])

  const hasMessages = messages.length > 0

  // Result of classifyConversation (see its definition for why this is async-shaped already) — the
  // thread's mood and which suggestion screen to show both come from one call over the current
  // messages. `cancelled` guards against a stale, slower-to-resolve call from an earlier `messages`
  // value clobbering a newer one once this becomes a real network call with variable latency.
  const [classification, setClassification] = useState({ threadState: 'neutral', suggestionType: 'toneCorrection' })
  useEffect(() => {
    let cancelled = false
    classifyConversation(messages).then((result) => {
      if (!cancelled) setClassification(result)
    })
    return () => {
      cancelled = true
    }
  }, [messages])
  const { threadState, suggestionType } = classification

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

  const currentExpandPercent = isSheetOpen ? SUGGESTION_ZONE_PERCENTS[suggestionType] : 0
  const SuggestionCard = SUGGESTION_SCREENS[suggestionType]
  const sizeTransition = 'height 300ms ease-out'
  // The sheet's TOTAL height (status bar + header + revealed panel) when open, e.g. "50%" of the
  // frame — not the header footprint plus another 50% on top of it. `max()` with the panel's pixel
  // floor (see SUGGESTION_ZONE_MIN_PX) keeps it at that percentage on a normal-height screen, but
  // stops it from shrinking below what the card actually needs on a short one — so the panel never
  // needs to scroll internally regardless of screen size. Closed, it's just the fixed header
  // footprint.
  const sheetHeightValue = isSheetOpen
    ? `max(${currentExpandPercent}%, ${HEADER_FOOTPRINT_PX + SUGGESTION_ZONE_MIN_PX[suggestionType]}px)`
    : `${HEADER_FOOTPRINT_PX}px`

  return (
    <div className="flex h-dvh w-full items-center justify-center overflow-hidden bg-[#fff5f7]">
      <div className="relative h-full w-full max-w-[480px] overflow-hidden bg-gradient-to-b from-[#fff6fa] from-[40%] to-[#ffa3c6] to-[95.056%]">
        <ThreadCrayonFilter />
        {/* Message list and input bar keep their full natural size at all times — the sheet is a
            translucent, blurred overlay that floats above them as it grows, rather than shrinking
            them. Positioned with top+bottom (not a JS-computed height) so it fills whatever space
            is actually available on the current screen instead of assuming one fixed frame size. */}
        <div
          style={{ top: `${HEADER_FOOTPRINT_PX}px`, bottom: `${INPUT_BAR_HEIGHT}px` }}
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
          style={{ bottom: 0, height: `${INPUT_BAR_HEIGHT}px` }}
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
              className="flex size-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#f8e6eb] transition-transform duration-[120ms] ease-out hover:scale-[1.06] active:scale-[0.92]"
            >
              <img src={arrowUpIcon} alt="" className="h-[17px] w-[12px]" />
            </button>
          </div>
        </div>

        <div
          style={{
            height: sheetHeightValue,
            background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.50) 23.63%, rgba(255, 218, 227, 0.50) 100.31%)',
            transition: sizeTransition,
          }}
          className="absolute left-[6px] right-[6px] top-0 z-10 overflow-hidden rounded-[28px] border-[3px] border-[#f4e0e5] shadow-[0_4px_20px_rgba(92,62,98,0.15)] backdrop-blur-md"
        >
          <StatusBar />
          {/* Header content sits directly on the sheet's own card background/border above — no
              separate box of its own, so it reads as one continuous card with the expand zone below
              (matching Figma 643:2971, where only the inner quote box is separately bordered). */}
          <div className="absolute left-[17px] right-[17px] top-[48px] px-5 pt-4 pb-[6px]">
            <div className="relative -mx-[12px] flex h-[52px] items-center justify-between">
              <DefaultAvatar glow={THREAD_GLOW_COLORS[threadState]} side="blue" />
              <ThreadLine mood={threadState} />
              <DefaultAvatar glow={THREAD_GLOW_COLORS[threadState]} side="pink" />
            </div>
            <div className="mt-0 flex h-[35px] flex-col items-center justify-start gap-[3px] text-center">
              {!hasMessages ? (
                <span className="font-['Instrument_Sans',sans-serif] text-[13px] font-medium text-[#8a6f76]/70">
                  대화를 시작해보세요
                </span>
              ) : (
                <>
                  <span className="font-['MemomentKkukkukk'] text-[12px] tracking-[0.08em] text-[#8a6f76]/70">
                    {THREAD_FEELING_TEXT[threadState]}
                  </span>
                  {THREAD_TO_SUGGESTION[threadState] === suggestionType && (
                    <span className="text-[14px] font-semibold text-[#f25597]">{SUGGESTION_STATUS[suggestionType]}</span>
                  )}
                </>
              )}
            </div>
          </div>
          {hasMessages && currentExpandPercent > 0 && (
            <div
              style={{
                top: `${HEADER_FOOTPRINT_PX}px`,
                // "100%" here means 100% of THIS element's own containing block, which is the
                // sheet div right above (not the frame) — the sheet's own height already equals
                // currentExpandPercent% of the frame, so "all of the sheet minus the header" is
                // exactly the revealed panel's height. Using currentExpandPercent% directly here
                // would compound against the sheet's height a second time and come out far short.
                height: `calc(100% - ${HEADER_FOOTPRINT_PX}px)`,
                transition: sizeTransition,
              }}
              className="chat-scroll absolute left-0 right-0 overflow-y-auto px-[10px] pb-[8px] pt-0"
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
              top: sheetHeightValue,
              transition: 'top 300ms ease-out',
            }}
            // A plain drag-handle bar (matches the Figma sheet's own handle), not a circular
            // icon-button — the padding here keeps the tap target comfortably large even though the
            // visible bar itself is thin.
            className="absolute left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center px-[14px] py-[10px] transition-transform duration-[120ms] ease-out hover:scale-[1.08] active:scale-[0.92]"
          >
            <span className="block h-[4px] w-[43px] rounded-full bg-white/90 shadow-[0_2px_6px_rgba(92,62,98,0.25)]" />
          </button>
        )}
      </div>
    </div>
  )
}

export default App
