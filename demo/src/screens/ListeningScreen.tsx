import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import Waveform from '../components/Waveform'

interface Props {
  onBack: () => void
  onDispatch: () => void
}

const extractions = [
  { key: 'Emergency', value: 'Cardiac Arrest', critical: true },
  { key: 'Patient', value: 'Male, elderly (father)', critical: false },
  { key: 'Symptoms', value: 'Chest pain, collapse, unresponsive', critical: false },
  { key: 'Location', value: 'Koramangala, near MG Road', critical: false },
]

export default function ListeningScreen({ onBack, onDispatch }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -60 }}
      transition={{ duration: 0.35 }}
      className="absolute inset-0 flex flex-col bg-gradient-to-b from-midnight-800 via-[#0f0a18] to-[#1a0a18]"
    >
      {/* Header */}
      <div className="flex items-center gap-3 pt-16 px-6 pb-3">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onBack}
          className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center"
        >
          <ArrowLeft size={16} className="text-white" />
        </motion.button>
        <h2 className="text-lg font-bold text-white">Listening...</h2>
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="ml-auto px-3 py-1 rounded-xl bg-red-500/20 border border-red-500/30"
        >
          <span className="text-red-400 text-[11px] font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-blink" />
            LIVE
          </span>
        </motion.div>
      </div>

      {/* Waveform */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="px-6 py-4 flex flex-col items-center"
      >
        <Waveform />
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex items-center gap-2 mt-4 px-4 py-2 bg-golden-500/10 border border-golden-500/20 rounded-xl"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-golden-500 text-[13px] font-medium">
            Detected: Hinglish (Hindi + English)
          </span>
        </motion.div>
      </motion.div>

      {/* Transcript */}
      <div className="flex-1 px-6 overflow-y-auto pb-2">
        <p className="text-[11px] text-midnight-400 font-semibold uppercase tracking-wider mb-3">
          Live Transcript
        </p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-4 mb-3"
        >
          <p className="text-[15px] text-white/85 leading-relaxed">
            <span className="text-golden-500">Papa gir gaye,</span> he's not moving,{' '}
            <span className="text-golden-500">seena pakad rahe the...</span> we're near
            Koramangala,{' '}
            <span className="text-golden-500">MG Road ke paas</span>
          </p>
          <div className="flex justify-between mt-3 text-[11px] text-midnight-400">
            <span>Confidence: 96%</span>
            <span>0:04</span>
          </div>
        </motion.div>

        {/* AI Extraction */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="bg-indigo-500/[0.08] border border-indigo-500/[0.15] rounded-2xl p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/15 px-2 py-0.5 rounded-md tracking-wide">
              AI
            </span>
            <span className="text-xs text-midnight-300 font-medium">
              Real-time extraction
            </span>
          </div>
          <div className="space-y-2.5">
            {extractions.map((item) => (
              <div key={item.key} className="flex items-start gap-3">
                <span className="text-[11px] text-midnight-400 font-medium min-w-[72px] pt-0.5">
                  {item.key}
                </span>
                <span
                  className={`text-[13px] font-medium ${
                    item.critical ? 'text-red-400 font-bold' : 'text-white/85'
                  }`}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
          {/* Confidence bar */}
          <div className="mt-3 h-1 bg-white/[0.08] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '94%' }}
              transition={{ delay: 0.9, duration: 1, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #f59e0b, #ef4444)' }}
            />
          </div>
        </motion.div>
      </div>

      {/* Bottom actions */}
      <div className="px-6 pb-10 pt-3 space-y-2.5">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onDispatch}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.4 }}
          className="w-full py-4 rounded-2xl text-white font-bold text-base text-center"
          style={{
            background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
            boxShadow: '0 4px 24px rgba(220,38,38,0.35)',
          }}
        >
          Dispatch Emergency Response →
        </motion.button>
        <button
          onClick={onBack}
          className="w-full py-3.5 rounded-2xl bg-white/[0.06] border border-white/10 text-midnight-200 font-semibold text-[15px] text-center hover:bg-white/[0.1] transition-colors"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  )
}
