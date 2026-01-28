import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Ambulance,
  Building2,
  PersonStanding,
  Smartphone,
  Stethoscope,
} from 'lucide-react'
import ChannelCard from '../components/ChannelCard'

interface Props {
  onBack: () => void
}

const channels = [
  {
    icon: Ambulance,
    iconBg: 'bg-red-500/15 text-red-400',
    name: '108 Ambulance',
    detail: 'KSRTC Unit #KA-03-2847',
    status: 'Dispatched',
    statusColor: 'green',
    eta: 'ETA 8 min',
  },
  {
    icon: Building2,
    iconBg: 'bg-indigo-500/15 text-indigo-400',
    name: 'Fortis Hospital MG Road',
    detail: 'Cath Lab on standby',
    status: 'Alerted',
    statusColor: 'amber',
    eta: '2.1 km',
  },
  {
    icon: PersonStanding,
    iconBg: 'bg-amber-500/15 text-amber-400',
    name: 'First Responder',
    detail: 'Dr. Priya S. — CPR certified',
    status: 'Responding',
    statusColor: 'green',
    eta: '3 min away',
  },
  {
    icon: Smartphone,
    iconBg: 'bg-emerald-500/15 text-emerald-400',
    name: 'Family Notified',
    detail: 'Amma, Ravi (brother)',
    status: 'SMS Sent',
    statusColor: 'indigo',
    eta: 'Just now',
  },
]

export default function DispatchScreen({ onBack }: Props) {
  const [seconds, setSeconds] = useState(107)

  useEffect(() => {
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <motion.div
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 60 }}
      transition={{ duration: 0.35 }}
      className="absolute inset-0 flex flex-col bg-gradient-to-b from-midnight-800 to-[#0d1117] overflow-hidden"
    >
      {/* Header */}
      <div className="pt-16 px-6 pb-2 text-center relative">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onBack}
          className="absolute left-6 top-16 w-9 h-9 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center"
        >
          <ArrowLeft size={16} className="text-white" />
        </motion.button>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15 }}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-500/10 border border-emerald-500/25 rounded-full mb-2.5"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-blink" />
          <span className="text-emerald-400 text-xs font-semibold">ALL CHANNELS ACTIVE</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="text-[22px] font-extrabold text-white mb-1"
        >
          Help is on the way
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="text-midnight-400 text-[13px]"
        >
          4 response channels activated in parallel
        </motion.p>
      </div>

      {/* Triage card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="mx-5 mt-3 bg-red-500/[0.08] border border-red-500/20 rounded-2xl p-4"
      >
        <div className="flex justify-between items-center mb-2.5">
          <span className="text-base font-bold text-red-400 flex items-center gap-1.5">
            <Stethoscope size={16} /> Cardiac Emergency
          </span>
          <span className="text-[11px] font-bold text-white bg-red-600 px-2.5 py-1 rounded-lg tracking-wide">
            CRITICAL
          </span>
        </div>
        <div className="flex gap-5">
          {[
            { label: 'Confidence', value: '94%' },
            { label: 'Required', value: 'Cath Lab' },
            { label: 'Location', value: 'Koramangala' },
          ].map((d) => (
            <div key={d.label}>
              <p className="text-[10px] text-midnight-400 font-medium uppercase tracking-wider">
                {d.label}
              </p>
              <p className="text-[13px] text-white/80 font-semibold">{d.value}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Map placeholder */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="mx-5 mt-3 h-[100px] rounded-2xl border border-white/[0.06] overflow-hidden relative"
        style={{
          background:
            'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(245,158,11,0.04))',
        }}
      >
        {/* Grid pattern */}
        <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="white" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Location pins */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="w-4 h-4 rounded-full bg-red-500 shadow-[0_0_20px_rgba(220,38,38,0.5)]" />
          <div className="absolute inset-0 w-4 h-4 rounded-full border-2 border-red-400/40 animate-pulse-ring" />
        </div>
        <div className="absolute top-[30%] right-[25%] w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
        <div className="absolute bottom-[35%] left-[30%] w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />

        {/* Dashed route line */}
        <svg className="absolute inset-0 w-full h-full">
          <line
            x1="50%"
            y1="50%"
            x2="75%"
            y2="30%"
            stroke="#6366f1"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            opacity="0.5"
          />
        </svg>

        <div className="absolute bottom-3 left-3 text-[11px] text-midnight-300 font-medium bg-midnight-900/80 px-2.5 py-1 rounded-lg backdrop-blur-sm">
          📍 Live tracking active
        </div>
      </motion.div>

      {/* Channel cards */}
      <div className="flex-1 px-5 mt-3 overflow-y-auto">
        <p className="text-[11px] text-midnight-400 font-semibold uppercase tracking-wider mb-3">
          Parallel Dispatch Channels
        </p>
        <div className="space-y-2.5">
          {channels.map((ch, i) => (
            <ChannelCard key={ch.name} {...ch} delay={i} />
          ))}
        </div>
      </div>

      {/* CPR Guidance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.4 }}
        className="mx-5 mt-2 bg-amber-500/[0.06] border border-amber-500/15 rounded-2xl p-3.5"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🩺</span>
          <span className="text-[13px] font-bold text-golden-500">Live CPR Guidance</span>
        </div>
        <p className="text-[13px] text-white/75 leading-relaxed">
          <span className="text-golden-500 font-bold">Step 3:</span> Push hard and fast in
          the center of the chest. 100-120 compressions per minute. I'll count with you —
          1, 2, 3...
        </p>
      </motion.div>

      {/* Timer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-center py-3 pb-10"
      >
        <p className="text-[32px] font-extrabold text-white tabular-nums tracking-tight">
          {mm}:{ss}
        </p>
        <p className="text-[11px] text-midnight-400 font-medium">
          Elapsed since activation
        </p>
      </motion.div>
    </motion.div>
  )
}
