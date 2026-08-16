import { useEffect, useMemo, useRef, useState } from 'react'
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

const DUMMY_REPLIES = [
  '오 좋다!',
  '음... 잘 모르겠는데 ㅎㅎ',
  '그래 완전 좋아!',
  '헐 진짜?',
  '나도 그렇게 생각해',
  '오키오키',
  '조금 더 생각해볼게',
  'ㅋㅋㅋ 재밌겠다',
  '좋아 그렇게 하자',
  '흠... 다른 것도 찾아볼까?',
]

const KEYWORD_REPLY_RULES = [
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

const MOOD_HAPPY_KEYWORDS = ['좋아', '좋다', '좋지', 'ㅋㅋ', 'ㅎㅎ', '사랑', '고마워', '고맙', '최고', '행복', '보고싶', '설레', 'ㅇㅋ', '콜', '히히']
const MOOD_TENSE_KEYWORDS = ['싫어', '짜증', '화나', '화났', '삐졌', '삐침', '서운', '헐', 'ㅡㅡ', '몰라', '됐어', '그만', '실망', '왜그래', '뭐라고', '싸우']
const MOOD_HISTORY_SIZE = 6

function getMoodFromMessages(messages) {
  // Only the user's own messages drive mood — the auto-reply is a scripted bot line,
  // not a real signal of how the conversation is actually going.
  const recent = messages.filter((m) => m.mine).slice(-MOOD_HISTORY_SIZE)
  let score = 0
  recent.forEach(({ text }) => {
    if (MOOD_HAPPY_KEYWORDS.some((k) => text.includes(k))) score += 1
    if (MOOD_TENSE_KEYWORDS.some((k) => text.includes(k))) score -= 1
  })
  if (score >= 1) return 'happy'
  if (score <= -1) return 'tense'
  return 'neutral'
}

function ThreadLine({ mood }) {
  if (mood === 'tense') {
    return (
      <svg
        className="absolute inset-x-0 top-1/2 h-[16px] w-full -translate-y-1/2"
        viewBox="0 0 100 16"
        preserveAspectRatio="none"
        fill="none"
      >
        <g className="thread-tremor">
          <path d="M10 4 L20 9 L28 6 L36 10" stroke="#c98a93" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3 2" />
          <path d="M64 7 L72 10 L80 5 L90 9" stroke="#c98a93" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3 2" />
        </g>
      </svg>
    )
  }

  if (mood === 'happy') {
    return (
      <svg
        className="absolute inset-x-0 top-1/2 h-[16px] w-full -translate-y-1/2"
        viewBox="0 0 100 16"
        preserveAspectRatio="none"
        fill="none"
      >
        <path stroke="#f3b6c2" strokeWidth="2" strokeLinecap="round" d="M10 8 Q30 0 50 8 Q70 16 90 8">
          <animate
            attributeName="d"
            values="M10 8 Q30 0 50 8 Q70 16 90 8;M10 8 Q30 16 50 8 Q70 0 90 8;M10 8 Q30 0 50 8 Q70 16 90 8"
            dur="2.2s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
    )
  }

  return (
    <svg
      className="absolute inset-x-0 top-1/2 h-[16px] w-full -translate-y-1/2"
      viewBox="0 0 100 16"
      preserveAspectRatio="none"
      fill="none"
    >
      <path d="M10 3 Q50 18 90 3" stroke="#f3b6c2" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function SkeletonBar({ width }) {
  return <div className="h-[8px] rounded-full bg-black/8" style={{ width }} />
}

// Shapes only — placeholder for the "유튜브 영상 추천" expanded-sheet state.
// Content (real video/text) is intentionally left unimplemented.
function VideoCard() {
  return (
    <div className="mx-auto w-[305px] overflow-hidden rounded-[18px] shadow-[0_4px_10px_rgba(44,25,29,0.15)]">
      <div className="relative h-[83px] bg-gradient-to-br from-[#f3c7cd] to-[#f1bec8]">
        <div className="absolute left-1/2 top-1/2 flex size-[34px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow-[0_2px_6px_rgba(44,25,29,0.2)]">
          <div className="ml-[2px] h-0 w-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-[#e8507d]" />
        </div>
        <div className="absolute bottom-[8px] right-[8px] rounded-[6px] bg-black/60 px-[6px] py-[2px] text-[10px] font-semibold text-white">
          0:00
        </div>
      </div>
      <div className="flex items-center gap-2 bg-white px-3 py-[10px]">
        <div className="flex size-[22px] shrink-0 items-center justify-center rounded-[6px] bg-[#ff3b30]">
          <div className="ml-[1px] h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-white" />
        </div>
        <div className="flex flex-1 flex-col gap-[5px]">
          <SkeletonBar width="70%" />
          <SkeletonBar width="42%" />
        </div>
      </div>
    </div>
  )
}

// Shapes only — placeholder for the "데이트 코스 추천" expanded-sheet state.
// Content (real photos/place names) is intentionally left unimplemented.
function DateCourseCard() {
  return (
    <div className="mx-auto w-[305px] rounded-[18px] bg-[#efece6] px-3 pb-3 pt-[6px] shadow-[0_4px_10px_rgba(44,25,29,0.1)]">
      <div className="mx-auto w-fit rounded-full bg-white px-4 py-[6px] shadow-sm">
        <SkeletonBar width="90px" />
      </div>
      <div className="mt-2 flex gap-[6px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1">
            <div className="aspect-[4/3] rounded-[12px] bg-gradient-to-br from-[#f3c7cd] to-[#e7c9d6]" />
            <div className="mt-1 flex items-center gap-1">
              <div className="size-[8px] shrink-0 rounded-full bg-[#e8507d]" />
              <SkeletonBar width="70%" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Shapes only — the 3 follow-up bubbles shown once the sheet is fully expanded (100%),
// below the date-course card. Content is intentionally left unimplemented.
function DateCourseFollowupBubbles() {
  return (
    <div className="mx-auto flex h-full w-[305px] flex-col justify-between">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[130px] rounded-[20px] bg-[#f8f4f1] shadow-[0_4px_4px_rgba(0,0,0,0.25)]" />
      ))}
    </div>
  )
}

// Shapes only — placeholder bubble for the "말투 교정" expanded-sheet state. Reused for both
// the 40% zone and the 100% zone as two visually separate cards (not one continuous block).
// Content is intentionally left unimplemented.
function ToneCorrectionCard() {
  return <div className="mx-auto h-full w-[305px] rounded-[20px] bg-[#f2e9e4] shadow-[0_4px_4px_rgba(0,0,0,0.25)]" />
}

function VideoDescriptionCard() {
  return (
    <div className="mx-auto flex h-full w-[305px] flex-col gap-[9px] rounded-[18px] border border-[#a0c4ff]/50 bg-[#eef2ff] px-4 py-6">
      <SkeletonBar width="100%" />
      <SkeletonBar width="92%" />
      <SkeletonBar width="60%" />
      <div className="h-[6px]" />
      <SkeletonBar width="100%" />
      <SkeletonBar width="88%" />
      <SkeletonBar width="70%" />
    </div>
  )
}

// Maps each "situation" to the components shown in the 40% zone and the 40%~100% zone.
// Which key is active will come from an AI worker classifying the conversation — see the
// suggestionType TODO in App(). For now it's fixed to a single value.
const SUGGESTION_SCREENS = {
  toneCorrection: { Primary: ToneCorrectionCard, Secondary: ToneCorrectionCard },
  dateCourse: { Primary: DateCourseCard, Secondary: DateCourseFollowupBubbles },
  video: { Primary: VideoCard, Secondary: VideoDescriptionCard },
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
      ? 'rounded-tl-[18px] rounded-tr-[18px] rounded-bl-[18px] rounded-br-[4px]'
      : 'rounded-[18px]'
    : isFirstInRun
      ? 'rounded-tl-[4px] rounded-tr-[18px] rounded-bl-[18px] rounded-br-[18px]'
      : 'rounded-[18px]'

  const bubbleAppearance = mine
    ? 'bg-gradient-to-br from-[#ff6e98] to-[#e8507d] text-white shadow-[0_3px_12px_rgba(232,80,125,0.3)]'
    : 'border border-[#ebd9dc] bg-white text-[#2c191d] shadow-[0_1px_5px_rgba(44,25,29,0.08)]'

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

const SCROLL_WHEEL_THRESHOLD = 12
// After a wheel gesture moves the sheet one level, ignore further wheel events for this long —
// a single trackpad swipe fires many rapid wheel events, which would otherwise cascade through
// multiple levels in one go.
const WHEEL_COOLDOWN_MS = 500
const DRAG_LEVEL_THRESHOLD = 60
const STATUS_BAR_HEIGHT = 40
const HEADER_HEIGHT = 132 // gap-8 + profile/thread row-40 + gap-12 + white card-64 + gap-8
const INPUT_BAR_HEIGHT = 80 // pt-[8px] + h-[52px] + pb-[20px]
const FRAME_HEIGHT = 812
const FRAME_WIDTH = 375
// Level 1 reveals exactly 40% of the frame's total height (status bar + header included). The video
// card (pt-20 + 83 thumbnail + 42 title bar + pb-8 = 153) is sized to fit that reveal with no scroll.
const VIDEO_CARD_ZONE_HEIGHT = Math.round(FRAME_HEIGHT * 0.4) - STATUS_BAR_HEIGHT - HEADER_HEIGHT
// Sheet expansion levels, as extra px grown below the header: collapsed / just enough to reveal the
// video card (no more, so it never scrolls) / the full remaining frame (message list and input bar
// are squeezed down to 0, fully covered — this also reveals the description card below the video card).
const SHEET_LEVELS_PX = [0, VIDEO_CARD_ZONE_HEIGHT, FRAME_HEIGHT - STATUS_BAR_HEIGHT - HEADER_HEIGHT]
const MAX_SHEET_LEVEL = SHEET_LEVELS_PX.length - 1

function App() {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [sheetLevel, setSheetLevel] = useState(0)
  const [dragPx, setDragPx] = useState(null)
  const bottomRef = useRef(null)
  const replyTimeoutIdsRef = useRef([])
  const wheelCooldownRef = useRef(false)
  const [scale, setScale] = useState(1)
  // TODO: an AI worker will classify the conversation into one of SUGGESTION_SCREENS' keys
  // and call setSuggestionType — e.g. useEffect(() => { classifySituation(messages).then(setSuggestionType) }, [messages]).
  const [suggestionType, setSuggestionType] = useState('toneCorrection')

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
  }, [messages])

  useEffect(() => {
    return () => replyTimeoutIdsRef.current.forEach(clearTimeout)
  }, [])

  const hasMessages = messages.length > 0
  const mood = useMemo(() => getMoodFromMessages(messages), [messages])

  function handleSend() {
    const text = inputValue.trim()
    if (!text) return
    setMessages((prev) => [...prev, { id: Date.now(), text, mine: true, time: new Date() }])
    setInputValue('')

    const timeoutId = setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), text: getReplyFor(text), mine: false, time: new Date() },
      ])
    }, 900)
    replyTimeoutIdsRef.current.push(timeoutId)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleHandlePointerDown(e) {
    const startY = e.clientY
    const startLevel = sheetLevel
    const startPx = SHEET_LEVELS_PX[startLevel]
    const maxPx = SHEET_LEVELS_PX[MAX_SHEET_LEVEL]
    setDragPx(startPx)

    function onMove(moveEvent) {
      const next = Math.min(maxPx, Math.max(0, startPx + (moveEvent.clientY - startY)))
      setDragPx(next)
    }

    function onUp(upEvent) {
      const deltaY = upEvent.clientY - startY
      let nextLevel = startLevel
      if (deltaY > DRAG_LEVEL_THRESHOLD) nextLevel = Math.min(MAX_SHEET_LEVEL, startLevel + 1)
      else if (deltaY < -DRAG_LEVEL_THRESHOLD) nextLevel = Math.max(0, startLevel - 1)
      setSheetLevel(nextLevel)
      setDragPx(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function handleHandleWheel(e) {
    if (wheelCooldownRef.current) return
    if (e.deltaY > SCROLL_WHEEL_THRESHOLD) {
      setSheetLevel((level) => Math.min(MAX_SHEET_LEVEL, level + 1))
    } else if (e.deltaY < -SCROLL_WHEEL_THRESHOLD) {
      setSheetLevel((level) => Math.max(0, level - 1))
    } else {
      return
    }
    wheelCooldownRef.current = true
    setTimeout(() => {
      wheelCooldownRef.current = false
    }, WHEEL_COOLDOWN_MS)
  }

  const currentExpandPx = dragPx !== null ? dragPx : SHEET_LEVELS_PX[sheetLevel]
  const { Primary: SuggestionPrimary, Secondary: SuggestionSecondary } = SUGGESTION_SCREENS[suggestionType]

  // Message list shrinks first as the sheet grows; only once it's fully squeezed to 0
  // does the input bar itself start shrinking (so at max level, both are fully covered).
  const remainingPx = Math.max(0, FRAME_HEIGHT - STATUS_BAR_HEIGHT - HEADER_HEIGHT - currentExpandPx)
  const inputBarHeight = Math.min(INPUT_BAR_HEIGHT, remainingPx)
  const messageAreaHeight = remainingPx - inputBarHeight
  const sizeTransition = dragPx !== null ? 'none' : 'height 300ms ease-out'

  return (
    <div className="flex h-screen items-center justify-center overflow-hidden bg-[#fff5f7]">
      <div style={{ width: FRAME_WIDTH * scale, height: FRAME_HEIGHT * scale }}>
        <div
          style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          className="relative flex flex-col overflow-hidden bg-[#fffafb]"
        >
        <div className="relative shrink-0">
          <div
            style={{
              height: `${STATUS_BAR_HEIGHT + HEADER_HEIGHT + currentExpandPx}px`,
              transition: sizeTransition,
            }}
            className="relative overflow-hidden rounded-b-[28px] bg-gradient-to-b from-[#ffe2e7] from-0% via-[#fff0f3] via-45% to-[#fffafb] to-100%"
          >
            <StatusBar />
            {hasMessages && (
              <>
                <div className="absolute left-[17px] right-[17px] top-[48px] flex h-[40px] items-center justify-between">
                  <div className="z-10 size-[28px] shrink-0 rounded-full border-2 border-white bg-gradient-to-br from-[#ffb199] to-[#ff6e98] shadow-[0_2px_6px_rgba(232,80,125,0.3)]" />
                  <ThreadLine mood={mood} />
                  <div className="z-10 size-[28px] shrink-0 rounded-full border-2 border-white bg-gradient-to-br from-[#a0c4ff] to-[#7ea6ff] shadow-[0_2px_6px_rgba(80,125,232,0.3)]" />
                </div>
                <div className="absolute left-[17px] right-[17px] top-[100px] h-[64px] rounded-[16px] bg-white px-4 py-3 shadow-[0_8px_20px_rgba(232,80,125,0.18)]" />
              </>
            )}
            {hasMessages && currentExpandPx > 0 && (
              <div
                style={{
                  top: `${STATUS_BAR_HEIGHT + HEADER_HEIGHT}px`,
                  height: `${Math.min(currentExpandPx, SHEET_LEVELS_PX[1])}px`,
                  transition: sizeTransition,
                }}
                className="absolute left-0 right-0 overflow-hidden px-[17px] pb-[8px] pt-[20px]"
              >
                <SuggestionPrimary />
              </div>
            )}
            {hasMessages && currentExpandPx > SHEET_LEVELS_PX[1] && (
              <div
                style={{
                  top: `${STATUS_BAR_HEIGHT + HEADER_HEIGHT + SHEET_LEVELS_PX[1]}px`,
                  height: `${currentExpandPx - SHEET_LEVELS_PX[1]}px`,
                  transition: sizeTransition,
                }}
                className="chat-scroll absolute left-0 right-0 overflow-y-auto px-[17px] pb-[20px] pt-[16px]"
              >
                <SuggestionSecondary />
              </div>
            )}
          </div>

          <div
            style={{
              top: `${STATUS_BAR_HEIGHT + HEADER_HEIGHT + currentExpandPx}px`,
              transition: dragPx !== null ? 'none' : 'top 300ms ease-out',
            }}
            onPointerDown={handleHandlePointerDown}
            onWheel={handleHandleWheel}
            className="absolute left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center px-3 py-1 active:cursor-grabbing"
          >
            <div className="h-[5px] w-[40px] rounded-[30px] bg-[#f6c3cc]/50" />
          </div>
        </div>

        <div
          style={{ height: `${messageAreaHeight}px`, transition: sizeTransition }}
          className="chat-scroll overflow-y-auto px-[17px] pb-[16px] pt-[14px]"
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
                <div ref={bottomRef} />
              </div>
            </>
          )}
        </div>

        <div
          style={{ height: `${inputBarHeight}px`, transition: sizeTransition }}
          className="overflow-hidden px-[12px] pb-[20px] pt-[8px]"
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
        </div>
      </div>
    </div>
  )
}

export default App
