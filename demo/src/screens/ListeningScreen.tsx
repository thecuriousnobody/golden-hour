import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Mic, MicOff, Languages, Send } from 'lucide-react'
import Waveform from '../components/Waveform'
import { createSpeechRecognition, isSpeechRecognitionSupported, languageNames, translateToEnglish, translateFromEnglish } from '../services/speechApi'
import { saveSession } from '../services/sessionStorage'
import { extractSymptomsAI, type TriageResult } from '../services/triageApi'

interface Props {
  onBack: () => void
  onDispatch: () => void
}

interface Extraction {
  key: string
  value: string
  critical: boolean
}

const severityColors: Record<string, { bg: string; border: string; text: string }> = {
  CRITICAL: { bg: 'bg-red-500/20', border: 'border-red-500/40', text: 'text-red-400' },
  HIGH: { bg: 'bg-orange-500/20', border: 'border-orange-500/40', text: 'text-orange-400' },
  MODERATE: { bg: 'bg-yellow-500/20', border: 'border-yellow-500/40', text: 'text-yellow-400' },
  LOW: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-400' },
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
  const [isTriaging, setIsTriaging] = useState(false)
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null)
  const [summaryText, setSummaryText] = useState<string>('')
  const [kannadaSummary, setKannadaSummary] = useState<string>('')
  const [isTranslatingBack, setIsTranslatingBack] = useState(false)
  const [showSymptomsInKannada, setShowSymptomsInKannada] = useState(false)
  const [kannadaExtractions, setKannadaExtractions] = useState<Extraction[]>([])
  const [kannadaCondition, setKannadaCondition] = useState<string>('')
  const [isTranslatingSymptoms, setIsTranslatingSymptoms] = useState(false)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const translationTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastTranslatedRef = useRef<string>('')

  // Translate transcript to English (debounced) — translation only, no AI triage
  const translateTranscript = useCallback(async (text: string) => {
    if (!text.trim() || text === lastTranslatedRef.current) return

    setIsTranslating(true)
    try {
      const result = await translateToEnglish(text, 'kn-IN')
      setEnglishTranslation(result.translatedText)
      lastTranslatedRef.current = text
    } catch (err) {
      console.error('Translation error:', err)
    } finally {
      setIsTranslating(false)
    }
  }, [])

  // Build a plain-language summary from triage result
  const buildSummary = (result: TriageResult): string => {
    const condition = result.likelyCondition
    const criticalSymptoms = result.symptoms
      .filter(s => s.critical)
      .map(s => s.value.toLowerCase())
    const otherSymptoms = result.symptoms
      .filter(s => !s.critical && s.key !== 'Patient' && s.key !== 'Urgency')
      .map(s => s.value.toLowerCase())

    let summary = `${condition} detected.`

    if (criticalSymptoms.length > 0) {
      summary += ` Critical signs: ${criticalSymptoms.join(', ')}.`
    }
    if (otherSymptoms.length > 0) {
      summary += ` Also noted: ${otherSymptoms.join(', ')}.`
    }

    summary += ` Severity: ${result.severity}.`

    if (result.requiredCapabilities.length > 0) {
      const caps = result.requiredCapabilities.map(c => c.replace(/_/g, ' ')).join(', ')
      summary += ` Requires: ${caps}.`
    }

    return summary
  }

  // Build summary from keyword fallback
  const buildFallbackSummary = (items: Extraction[]): string => {
    const emergency = items.find(i => i.key === 'Emergency')
    const symptoms = items.filter(i => i.key === 'Symptom').map(i => i.value.toLowerCase())
    const concern = items.find(i => i.key === 'Concern')

    let summary = emergency ? `${emergency.value} detected.` : 'Emergency detected.'
    if (symptoms.length > 0) {
      summary += ` Symptoms: ${symptoms.join(', ')}.`
    }
    if (concern) {
      summary += ` ${concern.value}.`
    }
    summary += ' Immediate medical attention required.'
    return summary
  }

  // Submit translation for AI symptom extraction
  const handleSubmitForTriage = useCallback(async () => {
    if (!englishTranslation.trim()) return

    setIsTriaging(true)
    setExtractions([])
    setTriageResult(null)
    setSummaryText('')
    setKannadaSummary('')

    try {
      const aiResult = await extractSymptomsAI(englishTranslation, transcript)
      let summary: string

      if (aiResult) {
        setTriageResult(aiResult)
        setExtractions(aiResult.symptoms)
        summary = buildSummary(aiResult)
      } else {
        // AI unavailable — fall back to keyword extraction
        setTriageResult(null)
        const keywords = extractSymptoms(englishTranslation)
        setExtractions(keywords)
        summary = buildFallbackSummary(keywords)
      }

      setSummaryText(summary)
      setIsTriaging(false)

      // Translate summary back to Kannada
      setIsTranslatingBack(true)
      try {
        const kannadaResult = await translateFromEnglish(summary, 'kn-IN')
        setKannadaSummary(kannadaResult.translatedText)
      } catch (err) {
        console.error('Kannada back-translation error:', err)
      } finally {
        setIsTranslatingBack(false)
      }
    } catch (err) {
      console.error('Triage error:', err)
      setTriageResult(null)
      const keywords = extractSymptoms(englishTranslation)
      setExtractions(keywords)
      const summary = buildFallbackSummary(keywords)
      setSummaryText(summary)
      setIsTriaging(false)
    }
  }, [englishTranslation, transcript])

  // Toggle symptoms between English and Kannada
  const handleToggleSymptomsLanguage = useCallback(async () => {
    // If already translated, just toggle view
    if (kannadaExtractions.length > 0) {
      setShowSymptomsInKannada(prev => !prev)
      return
    }

    // Batch-translate: join all symptom values + condition into one string separated by newlines
    const condition = triageResult?.likelyCondition || extractions.find(e => e.key === 'Emergency')?.value || ''
    const lines = [condition, ...extractions.map(e => e.value)]

    setIsTranslatingSymptoms(true)
    try {
      const batchText = lines.join('\n')
      const result = await translateFromEnglish(batchText, 'kn-IN')
      const translatedLines = result.translatedText.split('\n')

      // First line is the condition
      setKannadaCondition(translatedLines[0] || condition)

      // Remaining lines map to extractions
      const kannadaItems = extractions.map((ext, i) => ({
        ...ext,
        value: translatedLines[i + 1] || ext.value,
      }))
      setKannadaExtractions(kannadaItems)
      setShowSymptomsInKannada(true)
    } catch (err) {
      console.error('Symptom Kannada translation error:', err)
    } finally {
      setIsTranslatingSymptoms(false)
    }
  }, [extractions, triageResult, kannadaExtractions.length])

  // Debounced translation effect — only translates, triage waits for Submit
  useEffect(() => {
    if (!transcript.trim()) {
      setEnglishTranslation('')
      setExtractions([])
      setTriageResult(null)
      return
    }

    // Clear triage results when transcript changes (user is still speaking)
    setExtractions([])
    setTriageResult(null)
    setSummaryText('')
    setKannadaSummary('')
    setKannadaExtractions([])
    setKannadaCondition('')
    setShowSymptomsInKannada(false)

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

  // Extract symptoms from transcript (keyword fallback)
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
    setTriageResult(null)
    setSummaryText('')
    setKannadaSummary('')
    setKannadaExtractions([])
    setKannadaCondition('')
    setShowSymptomsInKannada(false)
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
        likelyCondition: triageResult?.likelyCondition,
        severity: triageResult?.severity,
        requiredCapabilities: triageResult?.requiredCapabilities,
        triageScore: triageResult?.triageScore,
        triageReasoning: triageResult?.reasoning,
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
        likelyCondition: triageResult?.likelyCondition,
        severity: triageResult?.severity,
        requiredCapabilities: triageResult?.requiredCapabilities,
        triageScore: triageResult?.triageScore,
        triageReasoning: triageResult?.reasoning,
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

  const severity = triageResult?.severity
  const severityStyle = severity ? severityColors[severity] : null

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

        {/* Submit for AI Analysis button — shown when translation is ready and triage hasn't run */}
        {englishTranslation && !isTriaging && !triageResult && extractions.length === 0 && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleSubmitForTriage}
            className="w-full mb-3 py-3.5 rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-[0_0_24px_rgba(99,102,241,0.35)]"
          >
            <Send size={18} />
            Analyze Symptoms
          </motion.button>
        )}

        {/* AI Triage Loading */}
        {isTriaging && (
          <div className="bg-indigo-500/[0.08] border border-indigo-500/[0.15] rounded-2xl p-4 mb-3">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/15 px-2 py-0.5 rounded-md animate-pulse">AI</span>
              <span className="text-sm text-midnight-300 font-medium animate-pulse">Analyzing symptoms with Claude...</span>
            </div>
          </div>
        )}

        {/* Results Panel — shown after triage completes (AI or keyword fallback) */}
        {!isTriaging && summaryText && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-3"
          >
            {/* Condition headline */}
            <div className={`rounded-2xl p-4 border ${
              severityStyle
                ? `${severityStyle.bg} ${severityStyle.border}`
                : 'bg-red-500/20 border-red-500/40'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/15 px-2 py-0.5 rounded-md">AI</span>
                {severity && severityStyle && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${severityStyle.bg} ${severityStyle.border} ${severityStyle.text}`}>
                    {severity}
                  </span>
                )}
                {triageResult && (
                  <span className="ml-auto text-[11px] text-midnight-400 font-semibold">
                    Score: {triageResult.triageScore}/10
                  </span>
                )}
              </div>
              <p className={`text-xl font-bold ${severityStyle?.text || 'text-red-400'}`}>
                {showSymptomsInKannada && kannadaCondition
                  ? kannadaCondition
                  : triageResult?.likelyCondition || extractions.find(e => e.key === 'Emergency')?.value || 'Emergency Detected'}
              </p>
            </div>

            {/* Plain-language summary in English */}
            <div className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-4">
              <p className="text-[11px] text-midnight-400 font-semibold uppercase tracking-wider mb-2">Summary</p>
              <p className="text-[14px] text-white/90 leading-relaxed">{summaryText}</p>
            </div>

            {/* Kannada translation of summary */}
            <div className="bg-golden-500/[0.08] border border-golden-500/[0.18] rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Languages size={12} className="text-golden-500" />
                <p className="text-[11px] text-golden-500 font-semibold uppercase tracking-wider">
                  ಕನ್ನಡದಲ್ಲಿ ಸಾರಾಂಶ
                </p>
                {isTranslatingBack && (
                  <span className="text-[10px] text-midnight-400 animate-pulse">translating...</span>
                )}
              </div>
              <p className="text-[15px] text-golden-200 leading-relaxed">
                {kannadaSummary || <span className="text-midnight-400 italic animate-pulse">Translating to Kannada...</span>}
              </p>
            </div>

            {/* Extracted symptoms detail */}
            {extractions.length > 0 && (
              <div className="bg-indigo-500/[0.06] border border-indigo-500/[0.12] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[11px] text-midnight-400 font-semibold uppercase tracking-wider">
                    {showSymptomsInKannada ? 'ಗುರುತಿಸಿದ ಲಕ್ಷಣಗಳು' : 'Symptoms Identified'}
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleToggleSymptomsLanguage}
                    disabled={isTranslatingSymptoms}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-golden-500/15 border border-golden-500/25 text-golden-400 text-[10px] font-semibold"
                  >
                    <Languages size={10} />
                    {isTranslatingSymptoms ? 'Translating...' : showSymptomsInKannada ? 'English' : 'ಕನ್ನಡ'}
                  </motion.button>
                </div>
                <div className="space-y-2">
                  {(showSymptomsInKannada ? kannadaExtractions : extractions).map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.critical ? 'bg-red-400' : 'bg-indigo-400'}`} />
                      <div>
                        <span className={`text-[13px] font-medium ${item.critical ? 'text-red-400' : 'text-white/85'}`}>
                          {item.value}
                        </span>
                        <span className="text-[10px] text-midnight-500 ml-2">{item.key}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinical reasoning (AI only) */}
            {triageResult?.reasoning && (
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
                <p className="text-[11px] text-midnight-400 font-semibold uppercase tracking-wider mb-1.5">Clinical Reasoning</p>
                <p className="text-[12px] text-midnight-200 leading-relaxed">{triageResult.reasoning}</p>
              </div>
            )}

            {/* Required capabilities (AI only) */}
            {triageResult && triageResult.requiredCapabilities.length > 0 && (
              <div className="bg-indigo-500/[0.04] border border-indigo-500/[0.1] rounded-2xl p-4">
                <p className="text-[11px] text-midnight-400 font-semibold uppercase tracking-wider mb-2">Required Hospital Capabilities</p>
                <div className="flex flex-wrap gap-1.5">
                  {triageResult.requiredCapabilities.map((cap) => (
                    <span key={cap} className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/15 border border-indigo-500/20 px-2.5 py-1 rounded-lg">
                      {cap.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Dispatch CTA */}
            <div className="bg-red-500/[0.08] border border-red-500/[0.2] rounded-2xl p-4 text-center">
              <p className="text-[13px] text-red-300 font-medium">
                Click the button below to dispatch emergency services
              </p>
            </div>
          </motion.div>
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
