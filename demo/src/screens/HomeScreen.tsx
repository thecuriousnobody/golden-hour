import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart,
  Car,
  Bug,
  Baby,
  Home,
  ClipboardList,
  User,
  Settings,
  X,
  AlertCircle,
  CheckCircle,
} from 'lucide-react'
import EmergencyButton from '../components/EmergencyButton'
import { getAllSessions, EmergencySession } from '../services/sessionStorage'

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
  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState<EmergencySession[]>([])

  // Load sessions on mount and when history panel opens
  useEffect(() => {
    setSessions(getAllSessions())
  }, [showHistory])

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

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
          <button
            key={item.label}
            onClick={item.label === 'History' ? () => setShowHistory(true) : undefined}
            className={`flex flex-col items-center gap-1 relative ${item.active ? 'opacity-100' : 'opacity-40'} hover:opacity-80 transition-opacity`}
          >
            <item.icon size={22} className={item.active ? 'text-golden-500' : 'text-white'} />
            <span className={`text-[10px] font-medium ${item.active ? 'text-golden-500' : 'text-midnight-200'}`}>
              {item.label}
            </span>
            {item.label === 'History' && sessions.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                {sessions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* History Panel */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute inset-0 bg-midnight-800 z-50 flex flex-col"
          >
            {/* History Header */}
            <div className="flex items-center justify-between pt-16 px-6 pb-4 border-b border-white/[0.06]">
              <h2 className="text-lg font-bold text-white">Session History</h2>
              <button
                onClick={() => setShowHistory(false)}
                className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center"
              >
                <X size={16} className="text-white" />
              </button>
            </div>

            {/* Session List */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {sessions.length === 0 ? (
                <div className="text-center py-12">
                  <ClipboardList size={48} className="text-midnight-500 mx-auto mb-3" />
                  <p className="text-midnight-400 text-sm">No sessions yet</p>
                  <p className="text-midnight-500 text-xs mt-1">Emergency calls will appear here</p>
                </div>
              ) : (
                sessions.map((session) => (
                  <motion.div
                    key={session.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-4"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {session.action === 'dispatched' ? (
                          <CheckCircle size={16} className="text-emerald-400" />
                        ) : (
                          <AlertCircle size={16} className="text-amber-400" />
                        )}
                        <span className={`text-xs font-semibold ${
                          session.action === 'dispatched' ? 'text-emerald-400' : 'text-amber-400'
                        }`}>
                          {session.action === 'dispatched' ? 'DISPATCHED' : 'CANCELLED'}
                        </span>
                      </div>
                      <span className="text-[10px] text-midnight-400">
                        {formatDate(session.timestamp)} {formatTime(session.timestamp)}
                      </span>
                    </div>

                    {/* Original transcript */}
                    <p className="text-[13px] text-white/70 mb-2 line-clamp-2">
                      {session.originalTranscript || 'No transcript'}
                    </p>

                    {/* English translation */}
                    {session.englishTranslation && (
                      <p className="text-[12px] text-emerald-300/70 mb-2 italic">
                        "{session.englishTranslation}"
                      </p>
                    )}

                    {/* Symptoms */}
                    {session.symptomsExtracted.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {session.symptomsExtracted.slice(0, 3).map((sym, idx) => (
                          <span
                            key={idx}
                            className={`text-[10px] px-2 py-0.5 rounded-full ${
                              sym.critical
                                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                : 'bg-white/[0.06] text-midnight-300 border border-white/10'
                            }`}
                          >
                            {sym.value}
                          </span>
                        ))}
                        {session.symptomsExtracted.length > 3 && (
                          <span className="text-[10px] text-midnight-400">
                            +{session.symptomsExtracted.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
