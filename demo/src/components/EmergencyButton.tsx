import { motion } from 'framer-motion'

interface Props {
  onPress: () => void
}

export default function EmergencyButton({ onPress }: Props) {
  return (
    <div className="flex flex-col items-center gap-6">
      <motion.button
        onClick={onPress}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        className="relative w-[220px] h-[220px] rounded-full flex items-center justify-center"
      >
        {/* Pulse rings */}
        {[0, 0.8, 1.6].map((delay, i) => (
          <div
            key={i}
            className="absolute inset-0 rounded-full border-2 border-red-500/25 animate-pulse-ring"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}

        {/* Outer glow */}
        <div className="absolute inset-0 rounded-full bg-gradient-radial from-red-500/15 to-transparent" />

        {/* Main button */}
        <motion.div
          className="relative w-[170px] h-[170px] rounded-full flex flex-col items-center justify-center z-10"
          style={{
            background: 'linear-gradient(145deg, #ef4444, #b91c1c)',
            boxShadow:
              '0 8px 32px rgba(220,38,38,0.45), 0 0 60px rgba(220,38,38,0.15), inset 0 2px 4px rgba(255,255,255,0.2)',
          }}
        >
          <span className="text-[42px] font-black text-white tracking-[4px] drop-shadow-lg">
            SOS
          </span>
          <span className="text-[11px] font-medium text-white/80 tracking-wider mt-0.5">
            TAP FOR HELP
          </span>
        </motion.div>
      </motion.button>

      <span className="text-midnight-400 text-xs font-normal">
        Press to activate emergency response
      </span>
    </div>
  )
}
