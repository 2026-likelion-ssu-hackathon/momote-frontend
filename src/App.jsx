import arrowUpIcon from './assets/icons/arrow-up.svg'

function App() {
  return (
    <div className="flex min-h-screen justify-center bg-white">
      <div className="relative flex h-screen w-full max-w-[430px] flex-col overflow-hidden bg-white">
        <div className="h-11 shrink-0 bg-white" />
        <div className="flex h-[93px] shrink-0 items-end justify-center rounded-b-2xl bg-[#fff0f3] pb-3.5">
          <div className="h-[7px] w-[43px] rounded-[30px] bg-[#d9d9d9]" />
        </div>

        <div className="flex-1" />

        <div className="px-[7px] pb-[11px]">
          <div className="relative flex h-[51px] items-center justify-end rounded-[20px] bg-[#fffefe] pr-[9px] shadow-[2px_2px_8px_1px_rgba(0,0,0,0.25)]">
            <div className="pointer-events-none absolute inset-0 rounded-[20px] shadow-[inset_1px_1px_2px_0px_rgba(0,0,0,0.25)]" />
            <button
              type="button"
              aria-label="전송"
              className="flex size-8 items-center justify-center rounded-full bg-[#eeeeee]"
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
