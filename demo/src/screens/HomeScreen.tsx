import { motion } from 'framer-motion'
import {
  Heart,
  Car,
  Bug,
  Baby,
  Home,
  ClipboardList,
  User,
  Settings,
} from 'lucide-react'
import EmergencyButton from '../components/EmergencyButton'

interface Props {
  onActivate: () => void
}

const languages = [
  { label: 'English', active: true },
  { label: '\u0939\u093F\u0902\u0926\u0940', active: false },
  { label: '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD', active: false },
  { label: '\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41', active: false },
  { label: '\u0C95\u0CA8\u0CCD\u0CA8\u0CA1', active: false },
]

const quickActions = [
  { icon: Heart, label: 'Heart', color: 'text-red-400' },
  { icon: Car, label: 'Accident', color: 'text-amber-400' },
  { icon: Bug, label: 'Snakebite', color: 'text-emerald-400' },
  { icon: Baby, label: 'Child', color: 'text-sky-400' },
]

const navItems = [
  { icon: Home, label: 'Home', active: true },
  { icon: ClipboardList, label: 'History', active: false },
  { icon: User, label: 'Profile', active: false },
  { icon: Settings, label: 'Settings', active: false },
]

export default function HomeScreen({ onActivate }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -60 }}
      transition={{ duration: 0.35 }}
      className="absolute inset-0 flex flex-col bg-gradient-to-b from-midnight-800 via-[#16111e] to-[#1a1018]"
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
        className="text-center pt-16 pb-4 px-8"
      >
        <div className="flex items-center justify-center gap-2.5 mb-1">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #ff6b35, #dc2626)' }}
          >
            <Heart size={18} className="text-white" fill="white" />
          </div>
          <h1 className="text-[22px] font-extrabold text-white tracking-tight">
            Golden <span className="text-golden-500">Hour</span>
          </h1>
        </div>
        <p className="text-midnight-300 text-[13px]">AI Emergency Response System</p>
      </motion.div>

      {/* Emergency button */}
      <div className="flex-1 flex items-center justify-center pb-4">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.5, type: 'spring', stiffness: 200 }}
        >
          <EmergencyButton onPress={onActivate} />
        </motion.div>
      </div>

      {/* Language bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="flex justify-center gap-2 px-5 flex-wrap"
      >
        {languages.map((lang) => (
          <button
            key={lang.label}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
              lang.active
                ? 'bg-golden-500/15 border-golden-500 text-golden-500'
                : 'border-midnight-500 text-midnight-300 hover:border-midnight-400'
            }`}
          >
            {lang.label}
          </button>
        ))}
      </motion.div>

      {/* Quick actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        className="flex justify-around px-6 py-4 mt-3"
      >
        {quickActions.map((action) => (
          <button key={action.label} className="flex flex-col items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
            <div className="w-11 h-11 rounded-[14px] bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
              <action.icon size={20} className={action.color} />
            </div>
            <span className="text-[10px] text-midnight-300 font-medium">{action.label}</span>
          </button>
        ))}
      </motion.div>

      {/* Bottom nav */}
      <div className="flex justify-around px-5 py-3.5 pb-8 border-t border-white/[0.06] bg-midnight-800/90 backdrop-blur-xl">
        {navItems.map((item) => (
          <button key={item.label} className={`flex flex-col items-center gap-1 ${item.active ? 'opacity-100' : 'opacity-40'} hover:opacity-80 transition-opacity`}>
            <item.icon size={22} className={item.active ? 'text-golden-500' : 'text-white'} />
            <span className={`text-[10px] font-medium ${item.active ? 'text-golden-500' : 'text-midnight-200'}`}>
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  )
}
