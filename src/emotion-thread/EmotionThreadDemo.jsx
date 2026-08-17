import { useState } from 'react'
import EmotionThread, { EmotionThreadFilterDefs } from './EmotionThread'
import { EMOTION_STATES } from './shapes'

const STATE_ORDER = ['angry', 'happy', 'cold', 'agitated', 'hurt']

function Avatar({ glowColor }) {
  return (
    <div className="relative flex size-[64px] shrink-0 items-center justify-center">
      <div
        className="absolute inset-[-8px] rounded-full blur-[10px] transition-colors duration-300"
        style={{ backgroundColor: glowColor }}
      />
      <div className="relative flex size-[64px] items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#d9d9d9] shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
        <svg width="36" height="36" viewBox="0 0 30 30" fill="none">
          <circle cx="15" cy="11" r="6" fill="white" fillOpacity="0.95" />
          <path d="M2 29c0-8 5.8-12.5 13-12.5S28 21 28 29" fill="white" fillOpacity="0.95" />
        </svg>
      </div>
    </div>
  )
}

export default function EmotionThreadDemo() {
  const [state, setState] = useState('cold')
  const [glowColor, setGlowColor] = useState(EMOTION_STATES.cold.glowColor)

  return (
    <div className="flex min-h-screen w-full flex-col items-center gap-8 bg-[#fff5f7] p-10 font-['Pretendard',sans-serif]">
      <EmotionThreadFilterDefs />

      <div className="flex flex-col items-center gap-1">
        <h1 className="text-[22px] font-bold text-[#562f3e]">감정의 실 — EmotionThread demo</h1>
        <p className="text-[13px] text-[#8a6f76]">상태 버튼을 아무 순서로나 눌러서 전환을 확인하세요</p>
      </div>

      <div className="flex w-full max-w-[520px] flex-col items-center gap-6 rounded-[28px] border-2 border-[#f4e0e5] bg-white/70 px-8 py-10 shadow-[0_8px_30px_rgba(92,62,98,0.12)]">
        <div className="relative flex w-full items-center justify-between">
          <Avatar glowColor={glowColor} />
          <div className="mx-2 flex-1">
            <EmotionThread state={state} width={260} height={110} onGlowColorChange={setGlowColor} />
          </div>
          <Avatar glowColor={glowColor} />
        </div>

        <p className="text-[15px] font-semibold tracking-[0.08em] text-[#7d6a71]">{EMOTION_STATES[state].label}</p>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {STATE_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setState(key)}
            className={`rounded-full border-2 px-5 py-2 text-[14px] font-semibold transition-colors duration-150 ${
              state === key
                ? 'border-transparent bg-[#f25597] text-white shadow-[0_4px_12px_rgba(242,85,151,0.35)]'
                : 'border-[#f4e0e5] bg-white text-[#7d6a71] hover:bg-[#fff0f4]'
            }`}
          >
            {EMOTION_STATES[key].label}
          </button>
        ))}
      </div>
    </div>
  )
}
