import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Mic, MicOff, Languages } from 'lucide-react'
import Waveform from '../components/Waveform'
import { createSpeechRecognition, isSpeechRecognitionSupported, languageNames, translateToEnglish } from '../services/speechApi'
import { saveSession } from '../services/sessionStorage'

interface Props {
  onBack: () => void
  onDispatch: () => void
}

interface Extraction {
  key: string
  value: string
  critical: boolean
}

export default function ListeningScreen({ onBack, onDispatch }: Props) {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState<string>('')
  const [englishTranslation, setEnglishTranslation] = useState<string>('')
  const [isTranslating, setIsTranslating] = useState(false)
  const [detectedLanguage, setDetectedLanguage] = useState<string>('Kannada')
  const [confidence, setConfidence] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [extractions, setExtractions] = useState<Extraction[]>([])

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const translationTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastTranslatedRef = useRef<string>('')

  // Translate transcript to English (debounced)
  const translateTranscript = useCallback(async (text: string) => {
    if (!text.trim() || text === lastTranslatedRef.current) return

    setIsTranslating(true)
    try {
      const result = await translateToEnglish(text, 'kn-IN')
      setEnglishTranslation(result.translatedText)
      lastTranslatedRef.current = text
      // Extract symptoms from English translation
      setExtractions(extractSymptoms(result.translatedText))
    } catch (err) {
      console.error('Translation error:', err)
      // Fallback: try to extract from original text
      setExtractions(extractSymptoms(text))
    } finally {
      setIsTranslating(false)
    }
  }, [])

  // Debounced translation effect
  useEffect(() => {
    if (!transcript.trim()) {
      setEnglishTranslation('')
      setExtractions([])
      return
    }

    // Clear previous timeout
    if (translationTimeoutRef.current) {
      clearTimeout(translationTimeoutRef.current)
    }

    // Debounce translation by 500ms
    translationTimeoutRef.current = setTimeout(() => {
      translateTranscript(transcript)
    }, 500)

    return () => {
      if (translationTimeoutRef.current) {
        clearTimeout(translationTimeoutRef.current)
      }
    }
  }, [transcript, translateTranscript])

  // Extract symptoms from transcript (now uses English)
  const extractSymptoms = (text: string): Extraction[] => {
    const results: Extraction[] = []
    const lowerText = text.toLowerCase()

    if (lowerText.includes('chest pain') || lowerText.includes('heart')) {
      results.push({ key: 'Emergency', value: 'Possible Cardiac Event', critical: true })
    }
    if (lowerText.includes('sweating') || lowerText.includes('sweat')) {
      results.push({ key: 'Symptom', value: 'Excessive sweating', critical: false })
    }
    if (lowerText.includes('arm') && (lowerText.includes('numb') || lowerText.includes('pain'))) {
      results.push({ key: 'Symptom', value: 'Arm numbness/pain', critical: true })
    }
    if (lowerText.includes('breathing') || lowerText.includes('breath')) {
      results.push({ key: 'Symptom', value: 'Difficulty breathing', critical: true })
    }
    if (lowerText.includes('heart attack')) {
      results.push({ key: 'Concern', value: 'Patient suspects heart attack', critical: true })
    }
    if (lowerText.includes('grandfather') || lowerText.includes('father') || lowerText.includes('elderly')) {
      results.push({ key: 'Patient', value: 'Elderly male', critical: false })
    }
    if (lowerText.includes('help') || lowerText.includes('please') || lowerText.includes('quickly')) {
      results.push({ key: 'Urgency', value: 'Immediate response needed', critical: true })
    }

    return results
  }

  const startRecording = () => {
    if (!isSpeechRecognitionSupported()) {
      setError('Speech recognition not supported. Please use Chrome.')
      return
    }

    setError(null)
    setTranscript('')
    setEnglishTranslation('')
    setExtractions([])
    lastTranslatedRef.current = ''

    const recognition = createSpeechRecognition(
      'kn-IN', // Kannada
      (result) => {
        setTranscript(result.transcript)
        setDetectedLanguage(languageNames[result.languageDetected] || 'Kannada')
        setConfidence(result.confidence)
        // Symptom extraction happens after translation in the useEffect
      },
      (err) => {
        setError(err)
        setIsRecording(false)
      }
    )

    if (recognition) {
      recognitionRef.current = recognition
      recognition.start()
      setIsRecording(true)
    }
  }

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsRecording(false)
  }

  // Save session and dispatch
  const handleDispatch = () => {
    if (transcript) {
      const session = saveSession({
        originalTranscript: transcript,
        englishTranslation: englishTranslation,
        detectedLanguage: detectedLanguage,
        symptomsExtracted: extractions,
        action: 'dispatched',
        confidenceScore: confidence,
      })
      console.log('Session saved:', session.id)
    }
    stopRecording()
    onDispatch()
  }

  // Save session and cancel
  const handleCancel = () => {
    if (transcript) {
      saveSession({
        originalTranscript: transcript,
        englishTranslation: englishTranslation,
        detectedLanguage: detectedLanguage,
        symptomsExtracted: extractions,
        action: 'cancelled',
        confidenceScore: confidence,
      })
    }
    stopRecording()
    onBack()
  }

  // Auto-start recording when screen loads
  useEffect(() => {
    const timer = setTimeout(() => {
      startRecording()
    }, 500)

    return () => {
      clearTimeout(timer)
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

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
        <h2 className="text-lg font-bold text-white">
          {isRecording ? 'Listening...' : 'Transcript Ready'}
        </h2>
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`ml-auto px-3 py-1 rounded-xl ${
            isRecording ? 'bg-red-500/20 border border-red-500/30' : 'bg-emerald-500/20 border border-emerald-500/30'
          }`}
        >
          <span className={`text-[11px] font-semibold flex items-center gap-1.5 ${isRecording ? 'text-red-400' : 'text-emerald-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-red-400 animate-blink' : 'bg-emerald-400'}`} />
            {isRecording ? 'LIVE' : 'DONE'}
          </span>
        </motion.div>
      </div>

      {/* Waveform & Mic Button */}
      <div className="px-6 py-4 flex flex-col items-center">
        <Waveform />
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={isRecording ? stopRecording : startRecording}
          className={`mt-4 w-16 h-16 rounded-full flex items-center justify-center ${
            isRecording ? 'bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)]'
              : 'bg-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.5)]'
          }`}
        >
          {isRecording ? <MicOff size={28} className="text-white" /> : <Mic size={28} className="text-white" />}
        </motion.button>
        <p className="text-midnight-400 text-xs mt-2">
          {isRecording ? 'Tap to stop' : 'Tap to record again'}
        </p>

        <div className="flex items-center gap-2 mt-4 px-4 py-2 bg-golden-500/10 border border-golden-500/20 rounded-xl">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-golden-500 text-[13px] font-medium">Language: {detectedLanguage}</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mb-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Transcripts */}
      <div className="flex-1 px-6 overflow-y-auto pb-2">
        {/* Original Kannada Transcript */}
        <p className="text-[11px] text-midnight-400 font-semibold uppercase tracking-wider mb-2">
          Original ({detectedLanguage})
        </p>
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-4 mb-3">
          <p className="text-[15px] text-white/85 leading-relaxed min-h-[40px]">
            {transcript || <span className="text-midnight-400 italic">{isRecording ? 'Speak now in Kannada...' : 'Transcript will appear here.'}</span>}
          </p>
          {transcript && (
            <div className="flex justify-between mt-2 text-[11px] text-midnight-400">
              <span>Confidence: {Math.round(confidence * 100)}%</span>
              <span>{detectedLanguage}</span>
            </div>
          )}
        </div>

        {/* English Translation */}
        <div className="flex items-center gap-2 mb-2">
          <Languages size={12} className="text-emerald-400" />
          <p className="text-[11px] text-emerald-400 font-semibold uppercase tracking-wider">
            English Translation
          </p>
          {isTranslating && (
            <span className="text-[10px] text-midnight-400 animate-pulse">translating...</span>
          )}
        </div>
        <div className="bg-emerald-500/[0.06] border border-emerald-500/[0.12] rounded-2xl p-4 mb-3">
          <p className="text-[15px] text-emerald-100 leading-relaxed min-h-[40px]">
            {englishTranslation || <span className="text-midnight-400 italic">{transcript ? 'Translating...' : 'Translation will appear here.'}</span>}
          </p>
        </div>

        {/* AI Extraction */}
        {extractions.length > 0 && (
          <div className="bg-indigo-500/[0.08] border border-indigo-500/[0.15] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/15 px-2 py-0.5 rounded-md">AI</span>
              <span className="text-xs text-midnight-300 font-medium">Symptom Extraction</span>
            </div>
            <div className="space-y-2.5">
              {extractions.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <span className="text-[11px] text-midnight-400 font-medium min-w-[72px]">{item.key}</span>
                  <span className={`text-[13px] font-medium ${item.critical ? 'text-red-400 font-bold' : 'text-white/85'}`}>
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-6 pb-10 pt-3 space-y-2.5">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleDispatch}
          disabled={!transcript}
          className={`w-full py-4 rounded-2xl text-white font-bold text-base ${!transcript && 'opacity-50'}`}
          style={{ background: transcript ? 'linear-gradient(135deg, #dc2626, #b91c1c)' : '#374151' }}
        >
          Dispatch Emergency Response →
        </motion.button>
        <button onClick={handleCancel} className="w-full py-3.5 rounded-2xl bg-white/[0.06] border border-white/10 text-midnight-200 font-semibold">
          Cancel
        </button>
      </div>
    </motion.div>
  )
}
