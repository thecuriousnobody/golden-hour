import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import PhoneFrame from './components/PhoneFrame'
import HomeScreen from './screens/HomeScreen'
import ListeningScreen from './screens/ListeningScreen'
import DispatchScreen from './screens/DispatchScreen'

const screens = ['home', 'listening', 'dispatch'] as const
type Screen = (typeof screens)[number]

const labels: Record<Screen, string> = {
  home: 'Home',
  listening: 'Voice Capture & AI Triage',
  dispatch: 'Parallel Dispatch',
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const currentIndex = screens.indexOf(screen)

  return (
    <div className="min-h-screen bg-midnight-950 flex flex-col items-center justify-center gap-6 p-4 select-none">
      <PhoneFrame>
        <AnimatePresence mode="wait">
          {screen === 'home' && (
            <HomeScreen key="home" onActivate={() => setScreen('listening')} />
          )}
          {screen === 'listening' && (
            <ListeningScreen
              key="listening"
              onBack={() => setScreen('home')}
              onDispatch={() => setScreen('dispatch')}
            />
          )}
          {screen === 'dispatch' && (
            <DispatchScreen key="dispatch" onBack={() => setScreen('listening')} />
          )}
        </AnimatePresence>
      </PhoneFrame>

      {/* Screen navigation dots */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-midnight-300 text-sm font-medium tracking-wide">
          {labels[screen]}
        </span>
        <div className="flex gap-3">
          {screens.map((s, i) => (
            <button
              key={s}
              onClick={() => setScreen(s)}
              className={`w-3 h-3 rounded-full transition-all duration-300 ${
                i === currentIndex
                  ? 'bg-golden-500 shadow-[0_0_12px_rgba(245,158,11,0.5)] scale-110'
                  : 'bg-midnight-600 hover:bg-midnight-400'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
