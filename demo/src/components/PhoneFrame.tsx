import { ReactNode } from 'react'

export default function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {/* Phone bezel */}
      <div
        className="w-[390px] h-[844px] rounded-[50px] border-[4px] border-midnight-600 bg-midnight-800 relative overflow-hidden"
        style={{
          boxShadow:
            '0 0 0 2px #1a1a22, 0 40px 80px rgba(0,0,0,0.6), 0 0 120px rgba(220,50,40,0.05)',
        }}
      >
        {/* Dynamic Island / Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[126px] h-[34px] bg-black rounded-b-[22px] z-50" />

        {/* Status bar */}
        <div className="absolute top-0 left-0 right-0 z-40 flex justify-between items-center px-8 pt-[14px]">
          <span className="text-white text-sm font-semibold">9:41</span>
          <div className="flex items-center gap-1.5">
            <span className="text-white text-xs font-semibold">5G</span>
            <div className="flex items-center gap-[2px]">
              {[0.4, 0.6, 0.8, 1].map((h, i) => (
                <div
                  key={i}
                  className="w-[3px] rounded-sm bg-white"
                  style={{ height: `${h * 12}px` }}
                />
              ))}
            </div>
            <svg width="25" height="12" viewBox="0 0 25 12" className="ml-1">
              <rect x="0" y="0" width="22" height="12" rx="3" stroke="white" strokeWidth="1.5" fill="none" />
              <rect x="1.5" y="1.5" width="14" height="9" rx="1.5" fill="#4ade80" />
              <rect x="23" y="3.5" width="2" height="5" rx="1" fill="white" />
            </svg>
          </div>
        </div>

        {/* Screen content */}
        <div className="absolute inset-0 overflow-hidden">
          {children}
        </div>

        {/* Home indicator */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-[134px] h-[5px] bg-white/20 rounded-full z-50" />
      </div>
    </div>
  )
}
