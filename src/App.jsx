import { useEffect, useRef, useState } from 'react'
import arrowUpIcon from './assets/icons/arrow-up.svg'
import speechBubbleIcon from './assets/icons/speech-bubble.svg'
import avatarBlue from './assets/avatars/avatar-blue.png'
import avatarPink from './assets/avatars/avatar-pink.png'
import threadHappyGif from './assets/thread/happy.gif'
import threadLoveGif from './assets/thread/love.gif'
import threadNeutralGif from './assets/thread/neutral.gif'
import threadTangledGif from './assets/thread/tangled.gif'
import threadTenseGif from './assets/thread/tense.gif'
import {
  currentUserId,
  fetchAiResults,
  fetchChatRoom,
  fetchEmotionAnalyses,
  fetchMessages,
  isBackendConfigured,
  newClientMessageId,
  sendMessage as postMessage,
  suggestionPropsFromResult,
  suggestionTypeFromResultType,
  threadStateFromEmotion,
} from './api'

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

// How far back a suggestion's trigger message may be before the card is retired.
//
// Wider than MOOD_HISTORY_SIZE on purpose. The AI takes 5-6s to write a tone correction and 9-12s a
// date course, and an active conversation moves several messages in that time — measured against a
// six-message window, a date course triggered by the message that asked for it was already out of
// range by the time it arrived, so the card was retired before it had ever been shown.
const SUGGESTION_TRIGGER_WINDOW = 15

// And a result that has only just been generated is always current regardless of how far its
// trigger has scrolled. This is the clause that actually holds during fast back-and-forth: the
// window alone cannot outrun people typing faster than the worker can answer.
const SUGGESTION_FRESH_MS = 120_000

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

// Display height per mood. The thread always stretches to the full avatar-to-avatar width, so this
// height is what sets how thick the stroke reads. Each value is its asset's own cropped pixel
// height, which keeps the designer's stroke weight exactly as drawn — a phone-width thread is about
// the artwork's native width, so 1:1 vertically means 1:1 overall — except where noted below.
const THREAD_HEIGHT_PX = {
  // tense and happy are the two that can't render at their native height: their peaks are 66px and
  // 58px tall, which centred on the avatar row would overrun the feeling caption below by 7px and
  // 3px (the caption starts exactly at the avatars' bottom edge — there is no slack there). 52px
  // puts both waveforms' peaks right at the avatars' top and bottom edges instead, which is where
  // the amplitude was asked to reach back when these were generated waves, and the assets' 2px
  // transparent margin keeps them off the caption. The rest render 1:1.
  tense: 52,
  happy: 52,
  love: 47,
  neutral: 26,
  tangled: 47,
}

// The designer's own animated artwork, one GIF per mood. Each carries its motion frame by frame,
// so there is no CSS animation on top — these replaced both the traced vector shapes this used to
// draw and the CSS pulses that were standing in for the real motion. Assets are cropped to their
// own content box by scripts/render/prepare_thread_gifs.py; see that script for why an uncropped
// canvas breaks the centering on the avatar row.
const THREAD_GIFS = {
  happy: threadHappyGif,
  love: threadLoveGif,
  neutral: threadNeutralGif,
  tangled: threadTangledGif,
  tense: threadTenseGif,
}

// Half an avatar (they are size-[52px]), so the thread runs between the two profile circles' centre
// x rather than their outer edges — each end starts under its own avatar and emerges from behind it.
// The avatars carry z-10 and the thread does not, so they stay on top and hide the tucked-in ends.
const THREAD_INSET_PX = 26

function ThreadLine({ mood }) {
  return (
    <img
      src={THREAD_GIFS[mood] ?? THREAD_GIFS.neutral}
      alt=""
      aria-hidden="true"
      className="absolute top-1/2 -translate-y-1/2"
      style={{
        left: `${THREAD_INSET_PX}px`,
        // Width is stated rather than left to `right: 26px`: an absolutely positioned *replaced*
        // element with auto width falls back to its intrinsic size instead of stretching to meet
        // the right offset, so the thread would stop short of the far avatar at its own pixel width.
        width: `calc(100% - ${THREAD_INSET_PX * 2}px)`,
        height: `${THREAD_HEIGHT_PX[mood] ?? THREAD_HEIGHT_PX.neutral}px`,
      }}
    />
  )
}

// How long the crossfade between two ThreadLine moods takes — long enough to read as a deliberate
// transition, short enough not to lag behind the mood actually changing.
const THREAD_TRANSITION_MS = 450

// Each ThreadLine mood is a structurally different SVG (different path counts, some with a
// separate heart/knot overlay) — switching `mood` directly would just pop from one to the other
// with no transition. This keeps the outgoing mood mounted just long enough to fade out while the
// incoming one fades in on top of it, instead of trying to morph between two unrelated shapes.
function ThreadLineTransition({ mood }) {
  const [layers, setLayers] = useState(() => [{ mood, key: 0 }])
  const nextKeyRef = useRef(1)

  useEffect(() => {
    setLayers((prev) => (prev[prev.length - 1].mood === mood ? prev : [...prev, { mood, key: nextKeyRef.current++ }]))
  }, [mood])

  useEffect(() => {
    if (layers.length <= 1) return
    const id = setTimeout(() => setLayers((prev) => prev.slice(-1)), THREAD_TRANSITION_MS)
    return () => clearTimeout(id)
  }, [layers])

  return layers.map((layer, i) => (
    <div key={layer.key} className={`absolute inset-0 ${i === layers.length - 1 ? 'thread-fade-in' : 'thread-fade-out'}`}>
      <ThreadLine mood={layer.mood} />
    </div>
  ))
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

// mqdefault, not hqdefault: hqdefault is 480x360 (4:3) while a video frame is 16:9, so it arrives
// with the frame boxed inside padding. mqdefault is 320x180 — exactly 16:9 — so at a 16:9 container
// the whole thumbnail shows with nothing cropped and no dead space.
function youtubeThumbnailUrl(videoId) {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
}

// YouTube's play-button mark, drawn inline rather than shipped as a file so it stays crisp at any
// size and carries the card's own currentColor-free brand red.
function YouTubeLogo({ className = '' }) {
  return (
    <svg viewBox="0 0 28 20" className={className} aria-hidden="true">
      <path
        d="M27.4 3.1A3.5 3.5 0 0 0 24.9.6C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5C5.3 20 14 20 14 20s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5C28 14.7 28 10 28 10s0-4.7-.6-6.9Z"
        fill="#FF0000"
      />
      <path d="M11.2 14.3 18.5 10l-7.3-4.3v8.6Z" fill="#fff" />
    </svg>
  )
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
        className="mt-[22px] block w-[220px] shrink-0 cursor-pointer overflow-hidden rounded-[20px] bg-white shadow-[0_4px_6px_rgba(9,9,9,0.1)] transition-transform duration-[120ms] ease-out hover:scale-[1.01] active:scale-[0.98]"
      >
        {/* aspect-video matches the thumbnail's own 16:9, so object-cover has nothing to crop. */}
        <img src={youtubeThumbnailUrl(videoId)} alt="" className="aspect-video w-full object-cover" />
        <div className="flex items-start gap-[7px] px-3 pb-[8px] pt-[10px]">
          {/* Boxed to the title's own line height (13px text at Tailwind's 1.5 leading = 19.5px) and
              centred inside it, so the logo sits on the title's midline instead of its line-box top
              — aligning to the top left it 1.8px high. */}
          <span className="flex h-[19.5px] shrink-0 items-center">
            <YouTubeLogo className="h-[14px] w-[20px]" />
          </span>
          {/* min-w-0 so the truncate below can actually shrink — a flex item's default min-width is
              its content, which would push the title past the card instead of clipping it. */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-black">{title}</p>
            <p className="mt-[2px] truncate text-[11px] font-medium text-black/50">{channel}</p>
          </div>
        </div>
      </a>

      <div aria-hidden="true" style={{ flexGrow: 1.7 }} />
      {/* break-keep so the line wraps between Korean words rather than inside one — the default
          breaks CJK at any character, which split this note as "…상대의 진짜 마음" / "을 확인하고…". */}
      <p className="w-[calc(100%-70px)] shrink-0 whitespace-pre-wrap break-keep text-center font-['MemomentKkukkukk'] text-[16px] leading-[24px] tracking-[0.16px] text-[#7d6a71]">{note}</p>
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
          {/* break-keep for the same reason as VideoCard's note — see there. */}
          <p className="whitespace-pre-wrap break-keep text-center font-['MemomentKkukkukk'] text-[16px] leading-[19px] tracking-[0.13px] text-[#7d6a71]">{note}</p>
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
        <p className="text-center text-[14px] font-semibold tracking-[0.14px] text-[#7d6a71]">이런 말투는 어때요?</p>
        <img src={speechBubbleIcon} alt="" className="size-[14px]" />
      </div>

      {/* 28px, matching the sheet panel this sits inside — the two rounded boxes are nested and
          read as one shape, so the corner curves have to agree. */}
      <div className="relative mt-[10px] w-[calc(100%-70px)] shrink-0 rounded-[28px] border-[1.2px] border-[#f4e0e5] bg-white/80 px-5 py-6 shadow-[0_2px_20px_rgba(255,207,219,0.7)]">
        {/* Mirrored on X only. rotate-180 flips the Y axis too, and this font's quote glyph is just
            7px of ink sitting at the very top of its 30px line box — so the flipped one landed 21px
            lower than its pair. scale-x-[-1] gives the same opening-quote shape at the same height. */}
        <span className="absolute left-3 top-2 scale-x-[-1] font-['MemomentKkukkukk'] text-[30px] leading-none tracking-[0.3px] text-[#562f3e]">”</span>
        <span className="absolute right-3 top-2 font-['MemomentKkukkukk'] text-[30px] leading-none tracking-[0.3px] text-[#562f3e]">”</span>
        <p className="whitespace-pre-wrap px-3 text-center text-[14px] font-semibold leading-[19px] tracking-[0.145px] text-[#562f3e]">{suggestion}</p>
      </div>

      <div aria-hidden="true" style={{ flexGrow: 1.7 }} />
      {/* break-keep for the same reason as VideoCard's note — see there. */}
      <p className="w-full shrink-0 whitespace-pre-wrap break-keep px-2 text-center font-['MemomentKkukkukk'] text-[16px] leading-[19px] tracking-[0.16px] text-[#7d6a71]">{reason}</p>
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
// bold summary text shown in the shared mood-card above it. Which key is active comes from the
// client-side keyword classifier in classifyConversation — the API call below only supplies that
// active card's actual content, it doesn't decide which card is active.
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

// How often to ask the backend for anything new. The API has no push channel, and the AI work
// happens after a message lands rather than in its response, so the partner's replies, the thread's
// mood, and the suggestion cards all arrive by polling. 3s is frequent enough that a reply doesn't
// feel stuck without hammering a free-tier host.
// The API is REST-only with no push channel, so "real time" is polling that reads as instant.
// Messages carry that illusion — a reply landing a beat late is what makes a chat feel broken — so
// they get the fast tick. Emotion and AI results are generated by a worker well after the message
// that triggered them, so polling those at the same rate would just be three times the requests for
// the same answer; they ride every third tick instead.
const MESSAGE_POLL_MS = 1500
const INSIGHT_POLL_EVERY = 3

// Right after a message lands, the AI is actively working on it — 5-6s for a tone correction, 9-12s
// for a date course — and that is the one stretch where the slower insight cadence is felt as the
// card taking too long. For this long after a send or an incoming message, emotion and results are
// fetched on every tick instead of every third, so a finished result is on screen within one poll
// of existing rather than up to three.
const INSIGHT_BURST_MS = 30000

// A backend that is down (or a wrong room id) shouldn't be hit twice a second forever, so failures
// back off exponentially and recover the moment one succeeds.
const MAX_BACKOFF_MS = 30000

// The server owns the conversation once a room is configured, so its messages replace the local
// ones wholesale rather than merging: `mine` is decided by comparing the sender against the
// configured user rather than by who typed into this tab.
function toLocalMessage(message) {
  return {
    id: message.messageId,
    text: message.content,
    mine: message.senderId === currentUserId(),
    time: new Date(message.sentAt),
    clientMessageId: message.clientMessageId,
  }
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
const HEADER_HEIGHT = 135 // gap-8 + mood card (pt-16 + avatar row-52 + gap-10 + text-35 + pb-6 = 119) + gap-8
const INPUT_BAR_HEIGHT = 80 // pt-[8px] + h-[52px] + pb-[20px]
// The real device's own OS status bar already shows above the browser viewport, so the app no
// longer draws its own — HEADER_FOOTPRINT_PX is just the mood-card header now.
const HEADER_FOOTPRINT_PX = HEADER_HEIGHT
// The suggestion panel's open height, as a percentage of the frame's own (now viewport-driven, not
// fixed) height — so it scales with whatever screen the app is actually running on instead of a
// single hardcoded design size. Tone-correction and date-course both fit within the standard 50%
// reveal — DateCourseCard's own spacing is tuned to fit its 3 place cards + closing note in that
// height (at typical phone-portrait proportions) without needing to scroll internally; video opens
// a bit taller at 55%.
const SUGGESTION_ZONE_PERCENTS = {
  toneCorrection: 43,
  dateCourse: 45,
  video: 48,
}
// Pixel floor for the revealed panel (not the whole sheet) — a pure percentage looks right on a
// normal phone-height screen, but on a short one (landscape, a small browser window) that same
// percentage can end up smaller than the tuned content, bringing back the internal scrollbar this
// was specifically tuned to avoid. `max(percent, minPx)` in sheetHeightValue keeps the percentage
// on tall screens and only floors it on short ones, so the panel's content never has to scroll —
// these numbers are the measured content height of each card plus a few px of margin.
const SUGGESTION_ZONE_MIN_PX = {
  // Measured empirically by shrinking each panel until its content stops fitting: 170 / 210 / 290
  // with a two-line closing note. A three-line one adds 24, and the flex spacers need something
  // left over or the card sits flush against both edges — hence the margin on top of that.
  toneCorrection: 210,
  dateCourse: 250,
  // video still runs tallest because its thumbnail is a full 16:9 frame — 124px at the card's 220px
  // width, narrowed from 290 precisely to buy this back. Measured minimum is 252.
  video: 292,
}

function App() {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isOtherTyping, setIsOtherTyping] = useState(false)
  const bottomRef = useRef(null)
  const replyTimeoutIdsRef = useRef([])

  // With no room/user configured the app runs entirely on its own — local messages, canned replies,
  // the keyword classifier below — so it stays demonstrable without a backend. With them set, every
  // one of those is replaced by the server's answer. See isBackendConfigured in src/api.js.
  const backendLive = isBackendConfigured()
  const [serverThread, setServerThread] = useState({ state: null, stateText: null })
  const [serverSuggestion, setServerSuggestion] = useState({ type: null, props: null, triggerMessageIds: null, createdAt: null })
  const lastMessageIdRef = useRef(null)
  const lastResultIdRef = useRef(null)
  // Lets handleSend jump the polling queue instead of waiting out the current delay — the moment
  // after you send is exactly when a reply, a new mood, and a new card are most likely to appear.
  const pollNowRef = useRef(null)
  const loggedResultShapeRef = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, isOtherTyping])

  useEffect(() => {
    return () => replyTimeoutIdsRef.current.forEach(clearTimeout)
  }, [])

  // Everything the backend has to say arrives by polling: the API exposes no push channel, and the
  // AI work runs after a message is stored rather than inside its response, so a reply, a new mood,
  // and a new suggestion card all show up on later reads rather than on the write that caused them.
  useEffect(() => {
    if (!backendLive) return
    let cancelled = false

    async function pullMessages() {
      const after = lastMessageIdRef.current
      const batch = await fetchMessages(after ? { afterMessageId: after } : { size: 50 })
      if (cancelled || !batch.length) return
      lastMessageIdRef.current = batch[batch.length - 1].messageId
      setMessages((prev) => {
        const known = new Set(prev.map((message) => message.id))
        const incoming = batch.filter((message) => !known.has(message.messageId)).map(toLocalMessage)
        if (!incoming.length) return prev
        // A message we sent optimistically is now confirmed — drop the placeholder rather than
        // showing the same text twice, matched on the id the client minted for it.
        const confirmed = new Set(incoming.map((message) => message.clientMessageId).filter(Boolean))
        if (incoming.some((message) => !message.mine)) burstUntil = Date.now() + INSIGHT_BURST_MS
        const kept = prev.filter((message) => !(message.pending && confirmed.has(message.clientMessageId)))
        return [...kept, ...incoming].sort((a, b) => a.time - b.time)
      })
    }

    async function pullEmotion() {
      const analyses = await fetchEmotionAnalyses()
      if (cancelled) return

      // The thread shows the *partner's* emotion, per the backend team: `subjectUserId` is whose
      // feeling it is, and the endpoint already returns only what this viewer is allowed to see. So
      // this picks the partner's entry rather than ranking by intensity or recency across the
      // couple — deliberately not "the strongest feeling in the room", which would sometimes show
      // the user their own state back.
      const now = Date.now()
      const live = analyses.filter((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > now)
      const partner = live.filter((a) => a.subjectUserId !== currentUserId())
      // Should be a single entry; if the server ever sends more, the newest is the current one.
      const current = partner.reduce(
        (best, candidate) =>
          !best || new Date(candidate.detectedAt) > new Date(best.detectedAt) ? candidate : best,
        null,
      )

      setServerThread(
        current
          ? { state: threadStateFromEmotion(current.emotionType), stateText: current.stateText }
          : { state: null, stateText: null },
      )
    }

    async function pullResults() {
      const after = lastResultIdRef.current
      const results = await fetchAiResults(after ? { afterResultId: after } : undefined)
      if (cancelled || !results.length) return
      lastResultIdRef.current = results[results.length - 1].resultId
      const newest = [...results].reverse().find((result) => suggestionTypeFromResultType(result.resultType))
      if (!newest) return
      if (!loggedResultShapeRef.current) {
        // resultData is an undocumented `object` in the spec, so the first real one is logged to
        // make its actual keys visible — see suggestionPropsFromResult in src/api.js.
        console.debug('[momote] first AI result payload:', newest)
        loggedResultShapeRef.current = true
      }
      setServerSuggestion({
        type: suggestionTypeFromResultType(newest.resultType),
        props: suggestionPropsFromResult(newest),
        // Kept so the card can be retired once the conversation has moved past whatever prompted
        // it — see suggestionIsCurrent below. Unlike emotion analyses, AI results carry no
        // expiresAt, so nothing else would ever take an old one off the screen.
        triggerMessageIds: newest.triggerMessageIds ?? null,
        createdAt: newest.createdAt ? new Date(newest.createdAt).getTime() : null,
      })
    }

    let timerId = null
    let tick = 0
    let failures = 0
    let burstUntil = 0

    // Self-scheduling rather than setInterval: a slow response must not stack another request on
    // top of the one still in flight, and the delay has to change with the failure count.
    function schedule(delay) {
      timerId = setTimeout(run, delay)
    }

    async function run() {
      if (cancelled) return

      // A backgrounded tab has nobody watching it, so it keeps its place in line without spending
      // requests. Coming back to the foreground polls immediately (see the listener below) so the
      // conversation is current by the time it's on screen. The first pass runs either way — a link
      // opened into a background tab should already have the conversation loaded when it's brought
      // forward, not start from an empty screen.
      if (tick > 0 && typeof document !== 'undefined' && document.hidden) {
        schedule(MESSAGE_POLL_MS)
        return
      }

      try {
        await pullMessages()
        if (tick % INSIGHT_POLL_EVERY === 0 || Date.now() < burstUntil) {
          await Promise.all([pullEmotion(), pullResults()])
        }
        failures = 0
      } catch (error) {
        failures += 1
        console.warn(`Backend poll failed (${failures}) — keeping the last known state.`, error)
      }
      tick += 1
      if (cancelled) return
      schedule(failures ? Math.min(MESSAGE_POLL_MS * 2 ** failures, MAX_BACKOFF_MS) : MESSAGE_POLL_MS)
    }

    // Poll right now instead of waiting out the current delay — used after sending a message, and
    // when the tab comes back to the foreground. `burst` additionally puts the insight reads on
    // every tick for a while, for the callers that know the AI is about to produce something.
    function pollNow({ burst = false } = {}) {
      if (cancelled) return
      if (burst) burstUntil = Date.now() + INSIGHT_BURST_MS
      clearTimeout(timerId)
      failures = 0
      run()
    }
    pollNowRef.current = pollNow

    function onVisibilityChange() {
      if (!document.hidden) pollNow()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Not rendered anywhere — called so a wrong room/user id fails loudly at startup with the
    // server's own message, instead of silently showing an empty chat that looks like "no messages
    // yet". The polling reads would otherwise just repeat the same 404 quietly.
    fetchChatRoom().catch((error) =>
      console.error('Chat room unavailable — check VITE_CHAT_ROOM_ID / VITE_USER_ID.', error),
    )
    run()

    return () => {
      cancelled = true
      clearTimeout(timerId)
      pollNowRef.current = null
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [backendLive])

  const hasMessages = messages.length > 0

  // Result of classifyConversation (see its definition for why this is async-shaped already) — the
  // thread's mood and which suggestion screen to show both come from one call over the current
  // messages. `cancelled` guards against a stale, slower-to-resolve call from an earlier `messages`
  // value clobbering a newer one once this becomes a real network call with variable latency.
  const [classification, setClassification] = useState({ threadState: 'neutral', suggestionType: 'toneCorrection' })
  useEffect(() => {
    if (backendLive) return
    let cancelled = false
    classifyConversation(messages).then((result) => {
      if (!cancelled) setClassification(result)
    })
    return () => {
      cancelled = true
    }
  }, [messages, backendLive])

  // The server's judgement wins whenever it has one. Until its first analysis lands (the AI runs
  // after a message is stored, so there is a gap on a brand-new room) this falls back to neutral
  // rather than to the keyword guess, so the thread never shows a mood the backend disagrees with.
  const threadState = backendLive ? (serverThread.state ?? 'neutral') : classification.threadState
  const suggestionType = backendLive
    ? (serverSuggestion.type ?? 'toneCorrection')
    : classification.suggestionType

  // Card content comes from the polled AI results once a room is configured (see pullResults);
  // `props` stays put between results so the card doesn't flash back to its example content while
  // the next one is still being generated, and is null only before the first one arrives.
  const suggestionData = { status: serverSuggestion.props ? 'success' : 'idle', data: serverSuggestion.props }

  // An AI result stays in /ai-results forever, so without this the last card produced would sit on
  // screen for the rest of the session — a tone correction for a message from twenty turns ago,
  // shown next to a thread that has since gone back to calm. A result counts as current while one
  // of the messages that triggered it is still inside the recent window. A result with no trigger
  // ids is shown rather than hidden: it can't be judged stale, and dropping it would lose real AI
  // output over a missing field.
  const recentMessageIds = new Set(messages.slice(-SUGGESTION_TRIGGER_WINDOW).map((message) => message.id))
  const suggestionIsCurrent =
    !serverSuggestion.triggerMessageIds?.length ||
    serverSuggestion.triggerMessageIds.some((id) => recentMessageIds.has(id)) ||
    (serverSuggestion.createdAt !== null && Date.now() - serverSuggestion.createdAt < SUGGESTION_FRESH_MS)

  function handleSend() {
    const text = inputValue.trim()
    if (!text) return
    setInputValue('')

    if (backendLive) {
      // Shown immediately and reconciled against the stored message, so the bubble doesn't wait on
      // a round trip. clientMessageId is what lets the server dedupe a retry and what matches the
      // placeholder to its confirmed version here and in pullMessages.
      const clientMessageId = newClientMessageId()
      const sentAt = new Date()
      setMessages((prev) => [
        ...prev,
        { id: `pending-${clientMessageId}`, clientMessageId, text, mine: true, time: sentAt, pending: true },
      ])
      postMessage({ content: text, clientMessageId, sentAt })
        .then((stored) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.clientMessageId === clientMessageId ? toLocalMessage(stored) : message,
            ),
          )
          pollNowRef.current?.({ burst: true })
        })
        .catch((error) => {
          console.warn('Could not send the message.', error)
          setMessages((prev) =>
            prev.map((message) =>
              message.clientMessageId === clientMessageId ? { ...message, failed: true } : message,
            ),
          )
        })
      return
    }

    setMessages((prev) => [...prev, { id: Date.now(), text, mine: true, time: new Date() }])
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

  // Whether there is a real suggestion to reveal. Off the backend, the local demo always has one.
  // On it, the sheet must stay shut until the server actually sends a result for this viewer:
  // AI results are visibility-scoped, so the partner of the person a tone correction was written
  // for receives nothing — and the cards' default props are example copy, which would read as
  // genuine AI advice if it were shown in its place.
  const hasSuggestion = backendLive ? Boolean(serverSuggestion.props) && suggestionIsCurrent : true

  const SuggestionCard = SUGGESTION_SCREENS[suggestionType]
  const sizeTransition = 'height 300ms ease-out'

  // The sheet's TOTAL height (header + revealed panel) when open, e.g. "50%" of the frame — not the
  // header footprint plus another 50% on top of it. `max()` with the panel's pixel floor (see
  // SUGGESTION_ZONE_MIN_PX) keeps it at that percentage on a normal-height screen, but stops it
  // from shrinking below what the card actually needs on a short one — so the panel never needs to
  // scroll internally regardless of screen size.
  //
  // In dvh rather than %, because the panel inside needs this same number and a percentage there
  // would resolve against the sheet (its containing block) instead of the frame. The frame is
  // exactly 100dvh tall, so the two units agree.
  const openSheetHeight = `max(${SUGGESTION_ZONE_PERCENTS[suggestionType]}dvh, ${HEADER_FOOTPRINT_PX + SUGGESTION_ZONE_MIN_PX[suggestionType]}px)`
  const sheetHeightValue = isSheetOpen && hasSuggestion ? openSheetHeight : `${HEADER_FOOTPRINT_PX}px`

  return (
    <div className="flex h-dvh w-full items-center justify-center overflow-hidden bg-[#fff5f7]">
      <div className="relative h-full w-full max-w-[480px] overflow-hidden bg-gradient-to-b from-[#fff6fa] from-[40%] to-[#ffa3c6] to-[95.056%]">
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
              // 16px, not 15 — iOS Safari auto-zooms the whole page on focus for any input whose
              // font-size is under 16px (it assumes the text is too small to type comfortably).
              className="flex-1 bg-transparent text-[16px] font-medium text-[#271518] outline-none placeholder:text-[#c9a2a8]"
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
            background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.1) 23.63%, rgba(255, 218, 227, 0.1) 100.31%)',
            transition: sizeTransition,
          }}
          className="absolute left-[6px] right-[6px] top-0 z-10 overflow-hidden rounded-[28px] border-[3px] border-[#f4e0e5] shadow-[0_4px_20px_rgba(92,62,98,0.15)] backdrop-blur-md"
        >
          {/* Header content sits directly on the sheet's own card background/border above — no
              separate box of its own, so it reads as one continuous card with the expand zone below
              (matching Figma 643:2971, where only the inner quote box is separately bordered). */}
          <div className="absolute left-[17px] right-[17px] top-[8px] px-5 pt-4 pb-[6px]">
            <div className="relative -mx-[12px] flex h-[52px] items-center justify-between">
              <DefaultAvatar glow={THREAD_GLOW_COLORS[threadState]} side="blue" />
              <ThreadLineTransition mood={threadState} />
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
                    {serverThread.stateText ?? THREAD_FEELING_TEXT[threadState]}
                  </span>
                  {/* THREAD_TO_SUGGESTION exists because the local classifier picked the mood and
                      the card separately, and this line would otherwise describe a situation the
                      thread wasn't showing. The server decides both independently — it can diagnose
                      a tone problem while the mood still reads calm — so once it has sent a label,
                      that label is the authority and the local pairing no longer applies. */}
                  {(backendLive
                    ? Boolean(serverSuggestion.props?.statusLabel) && suggestionIsCurrent
                    : THREAD_TO_SUGGESTION[threadState] === suggestionType) && (
                    <span className="text-[14px] font-semibold text-[#f25597]">
                      {suggestionData.data?.statusLabel ?? SUGGESTION_STATUS[suggestionType]}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          {hasMessages && hasSuggestion && (
            <div
              style={{
                top: `${HEADER_FOOTPRINT_PX}px`,
                // Always the panel's *open* height, even while the sheet is shut. Sizing it to the
                // sheet instead (`calc(100% - header)`) meant it grew along with the animation, and
                // the card inside lays itself out with flex-grow spacers — so every frame of the
                // open redistributed that space and the content visibly slid into place. Holding
                // the height still lets the sheet's own overflow-hidden do the work: the card sits
                // where it will end up and is uncovered rather than pushed.
                height: `calc(${openSheetHeight} - ${HEADER_FOOTPRINT_PX}px)`,
              }}
              className="chat-scroll absolute left-0 right-0 overflow-y-auto px-[10px] pb-[8px] pt-0"
            >
              {/* Undeclared fields (isRelevant, statusLabel) from the API response are just extra
                  props the card component doesn't destructure — harmless. No data yet (first load,
                  or the request failed) means an empty spread, so the card's own default param
                  values (its hardcoded example content) render instead. No loading indicator here —
                  with no backend wired up yet every fetch briefly enters "loading" on every message,
                  so it would otherwise flash on top of the example content constantly. */}
              <SuggestionCard {...suggestionData.data} />
            </div>
          )}
        </div>

        {hasMessages && hasSuggestion && (
          <button
            type="button"
            aria-label={isSheetOpen ? '제안 닫기' : '제안 열기'}
            aria-expanded={isSheetOpen}
            onClick={handleToggleSheet}
            style={{
              top: sheetHeightValue,
              transition: 'top 300ms ease-out',
            }}
            className="absolute left-1/2 z-20 flex size-[17px] -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/90 shadow-[0_2px_8px_rgba(92,62,98,0.25)] transition-transform duration-[120ms] ease-out hover:scale-[1.08] active:scale-[0.92]"
          >
            <svg
              width="7"
              height="5"
              viewBox="0 0 13 8"
              fill="none"
              className="transition-transform duration-300 ease-out"
              style={{ transform: isSheetOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <path d="M1 1L6.5 6.5L12 1" stroke="#E4598C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

export default App
