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

function DateDivider({ label }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-[#797979]" />
      <span className="shrink-0 text-[11px] font-medium text-[#424242]">{label}</span>
      <div className="h-px flex-1 bg-[#797979]" />
    </div>
  )
}

function ChatBubbleRow({ text, mine, time, isFirstInRun, isLastInRun }) {
  const corner = mine
    ? isFirstInRun
      ? 'rounded-tl-[15px] rounded-bl-[15px] rounded-br-[15px]'
      : 'rounded-[15px]'
    : isFirstInRun
      ? 'rounded-tl-[15px] rounded-tr-[15px] rounded-br-[15px]'
      : 'rounded-[15px]'
  const bg = mine ? 'bg-[#ffe5ea]' : 'bg-white'

  const timeLabel = isLastInRun ? (
    <span className="shrink-0 pb-0.5 text-[8px] text-black">{formatTimeKorean(time)}</span>
  ) : null

  return (
    <div className={`flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
      {mine && timeLabel}
      <div
        className={`relative max-w-[70%] px-3 py-2 text-[15px] font-medium text-black ${bg} ${corner} shadow-[0px_1px_4px_0px_rgba(0,0,0,0.2)]`}
      >
        <div
          className={`pointer-events-none absolute inset-0 ${corner} shadow-[inset_0px_1px_4px_0px_rgba(0,0,0,0.05)]`}
        />
        <span className="relative whitespace-pre-wrap break-words">{text}</span>
      </div>
      {!mine && timeLabel}
    </div>
  )
}

function App() {
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const hasMessages = messages.length > 0

  function handleSend() {
    const text = inputValue.trim()
    if (!text) return
    setMessages((prev) => [...prev, { id: Date.now(), text, mine: true, time: new Date() }])
    setInputValue('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex min-h-screen justify-center bg-white">
      <div className="relative flex h-screen w-full max-w-[430px] flex-col overflow-hidden bg-white">
        <div className="h-11 shrink-0 bg-white" />

        <div className="relative flex h-[93px] shrink-0 items-end justify-center rounded-b-2xl bg-[#fff0f3] pb-1.5">
          {hasMessages && (
            <div className="absolute right-[8px] top-[10px] h-[59px] w-[305px] rounded-[20px] bg-white px-4 py-3 text-[14px] font-semibold text-black shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)]" />
          )}
          <div className="h-[7px] w-[43px] rounded-[30px] bg-[#d9d9d9]" />
        </div>

        <div className="flex-1 overflow-y-auto px-[17px] pb-4 pt-3">
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

        <div className="px-[7px] pb-[11px]">
          <div className="relative flex h-[51px] items-center gap-2 rounded-[20px] bg-[#fffefe] px-3 shadow-[2px_2px_8px_1px_rgba(0,0,0,0.25)] transition-shadow duration-150 focus-within:ring-2 focus-within:ring-[#ffb6c1]">
            <div className="pointer-events-none absolute inset-0 rounded-[20px] shadow-[inset_1px_1px_2px_0px_rgba(0,0,0,0.25)]" />
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메시지를 입력하세요"
              className="relative z-10 flex-1 bg-transparent text-[15px] text-black outline-none placeholder:text-[#b3b3b3]"
            />
            <button
              type="button"
              aria-label="전송"
              onClick={handleSend}
              className="relative z-10 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#eeeeee] transition-all duration-150 hover:bg-[#e2e2e2] active:scale-90 active:bg-[#d5d5d5]"
            >
              <img src={arrowUpIcon} alt="" className="h-[17px] w-[11px]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
