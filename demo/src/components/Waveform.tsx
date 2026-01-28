import { useMemo } from 'react'

export default function Waveform() {
  const bars = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        id: i,
        height: 15 + Math.random() * 55,
        delay: Math.random() * 1.2,
      })),
    []
  )

  return (
    <div className="flex items-center justify-center gap-[3px] h-20">
      {bars.map((bar) => (
        <div
          key={bar.id}
          className="w-1 rounded-full animate-wave"
          style={
            {
              '--wave-h': `${bar.height}px`,
              animationDelay: `${bar.delay}s`,
              background: 'linear-gradient(180deg, #f59e0b, #dc2626)',
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
