import { motion } from 'framer-motion'
import { type LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  iconBg: string
  name: string
  detail: string
  status: string
  statusColor: string
  eta: string
  delay?: number
}

const statusBg: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-400',
  indigo: 'bg-indigo-500/15 text-indigo-400',
}

export default function ChannelCard({
  icon: Icon,
  iconBg,
  name,
  detail,
  status,
  statusColor,
  eta,
  delay = 0,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 + delay * 0.12, duration: 0.4, ease: 'easeOut' }}
      className="flex items-center gap-3.5 bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3.5"
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
        <Icon size={20} className="text-current" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white/90 truncate">{name}</div>
        <div className="text-xs text-midnight-300 truncate">{detail}</div>
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-lg ${statusBg[statusColor]}`}>
          {status}
        </span>
        <span className="text-[11px] text-midnight-400">{eta}</span>
      </div>
    </motion.div>
  )
}
