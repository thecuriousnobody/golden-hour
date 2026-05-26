"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { CallerContext } from "@/lib/types";
import {
  isSpeechRecognitionSupported,
  isRecordingSupported,
  startLiveRecognition,
  startRecording,
  transcribeAndTranslate,
  languageName,
} from "@/lib/speech";

/**
 * Per-message metadata captured from voice input. The English `text` of the
 * user's message is also the key into the metadata map so we can look it up
 * inside MessageBubble without threading IDs through useChat.
 *
 * - `lang` is the detected language code (e.g. "kn-IN", "hi", "en").
 * - `original` is what Sarvam returned BEFORE translation. For native scripts
 *   (Kannada, Hindi, etc.) this is rendered above the English text so the
 *   audience sees the multilingual moment instead of just the English result.
 */
interface VoiceMeta {
  lang: string;
  original: string;
}
import { requestGeolocation, PEORIA_FALLBACK, type GeoFix } from "@/lib/geo";
import { renderMarkdown } from "@/lib/markdown";
import { apiUrl } from "@/lib/api-base";
import { isNative } from "@/lib/platform";
import { speak, stopSpeaking } from "@/lib/tts";
import { translateForDisplay } from "@/lib/translate";
import { Waveform } from "@/components/Waveform";
import { FailsafeCard } from "@/components/FailsafeCard";
import { emergencyNumberFor } from "@/lib/failsafe-content";

const SAMPLE_PROMPTS = [
  "My grandfather is clutching his chest and sweating heavily. He's 72.",
  "There's been a road accident on Knoxville Ave. Two people unconscious, one bleeding heavily.",
  "My wife is in labor, water broke 20 minutes ago, contractions are 3 minutes apart.",
  "My son fell from a tree, his arm is bent the wrong way and he's crying in pain.",
];

/**
 * Language modes:
 *  - "en-US"   → Web Speech API live transcript (browser-native, free, instant)
 *  - "auto-in" → MediaRecorder + Sarvam STT-translate (auto-detects Indian lang → English)
 *  - any other → Web Speech API tries that lang code (Chrome supports kn-IN, hi-IN, etc.
 *    natively but quality varies; auto-in is usually better for Indian langs)
 */
const VOICE_MODES: { code: string; label: string; engine: "web" | "sarvam" }[] = [
  { code: "en-US", label: "English (live)", engine: "web" },
  { code: "auto-in", label: "Indian language — auto-detect", engine: "sarvam" },
  { code: "kn-IN", label: "Kannada (browser)", engine: "web" },
  { code: "hi-IN", label: "Hindi (browser)", engine: "web" },
  { code: "ta-IN", label: "Tamil (browser)", engine: "web" },
  { code: "te-IN", label: "Telugu (browser)", engine: "web" },
];

export default function Home() {
  const [geo, setGeo] = useState<GeoFix>(PEORIA_FALLBACK);
  const [geoStatus, setGeoStatus] = useState<"requesting" | "ready">("requesting");
  // On the Android shell, Web Speech API doesn't exist — default to the
  // Sarvam auto-detect mode so the very first mic tap works without the
  // user having to fiddle with the language picker.
  const [voiceMode, setVoiceMode] = useState<string>(() =>
    isNative() ? "auto-in" : "en-US"
  );

  // Caller defaults pull from NEXT_PUBLIC_* env so personal phone numbers
  // stay out of the public repo. Fall back to a clearly-fake demo number.
  const demoName = process.env.NEXT_PUBLIC_DEMO_CALLER_NAME ?? "Demo Caller";
  const demoPhone = process.env.NEXT_PUBLIC_DEMO_CALLER_PHONE ?? "+13095550100";
  const demoFamilyName = process.env.NEXT_PUBLIC_DEMO_FAMILY_NAME ?? "Spouse";
  const demoFamilyPhone = process.env.NEXT_PUBLIC_DEMO_FAMILY_PHONE ?? "+13095550199";

  const callerRef = useRef<CallerContext>({
    lat: PEORIA_FALLBACK.lat,
    lng: PEORIA_FALLBACK.lng,
    language: "en",
    name: demoName,
    phone: demoPhone,
    familyContacts: [{ name: demoFamilyName, phone: demoFamilyPhone }],
  });

  // Request real GPS on mount
  useEffect(() => {
    let cancelled = false;
    requestGeolocation().then((fix) => {
      if (cancelled) return;
      setGeo(fix);
      setGeoStatus("ready");
      callerRef.current = { ...callerRef.current, lat: fix.lat, lng: fix.lng };
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [typedInput, setTypedInput] = useState("");
  // Map<englishText, VoiceMeta> — populated by submit() whenever a voice
  // input lands, consumed by MessageBubble to show the detected-language
  // badge and (for non-Latin scripts) the original text.
  const [voiceMetaMap, setVoiceMetaMap] = useState<Map<string, VoiceMeta>>(
    () => new Map()
  );
  // Speak agent replies back. ON by default — the bystander we're designing
  // for may be doing CPR and can't read the screen.
  const [speakerOn, setSpeakerOn] = useState(true);
  // True while TTS audio is actively playing. Gates the mic so the user
  // can't accidentally talk over the agent.
  const [speaking, setSpeaking] = useState(false);
  // Track which assistant message IDs we've already spoken so React
  // re-renders don't replay them.
  const spokenIds = useRef<Set<string>>(new Set());
  // Per-message translations of assistant replies. Keyed by message ID.
  // Populated on assistant message completion when the last user voice
  // turn was in a non-English language. Lets MessageBubble render a
  // toggle pill (EN ⇄ ಕನ್ನಡ) so a nearby reader can follow the steps
  // without having to catch every word of TTS audio.
  const [translations, setTranslations] = useState<
    Map<string, { lang: string; text: string }>
  >(() => new Map());
  // Track which assistant IDs we've already submitted for translation so
  // re-renders don't refetch.
  const translatedIds = useRef<Set<string>>(new Set());
  // navigator.onLine — drives the failsafe "Offline" banner + card.
  const [online, setOnline] = useState(true);
  // Country code from build env; used to pick 911 vs 108 in the failsafe.
  const countryCode = process.env.NEXT_PUBLIC_EMERGENCY_COUNTRY_CODE ?? "1";

  // Watch network status. The OS's offline event is more reliable than any
  // fetch-based health check (and works even when our API is up but Wi-Fi
  // is dead).
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: apiUrl("/api/dispatch"),
      body: () => ({ caller: callerRef.current }),
    }),
  });

  // Speak each assistant message once, when it finishes streaming.
  // Lang picked from the most recent user voice message; falls back to
  // voiceMode (default en-US) so typed prompts still get spoken in English.
  useEffect(() => {
    if (!speakerOn) return;
    if (status === "streaming" || status === "submitted") return;
    // Find the last assistant message
    let lastAssistant: typeof messages[number] | undefined;
    let lastUser: typeof messages[number] | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!lastAssistant && m.role === "assistant") lastAssistant = m;
      if (!lastUser && m.role === "user") lastUser = m;
      if (lastAssistant && lastUser) break;
    }
    if (!lastAssistant) return;
    if (spokenIds.current.has(lastAssistant.id)) return;

    const text = (lastAssistant.parts ?? [])
      .filter((p) => p.type === "text" && typeof (p as { text?: string }).text === "string")
      .map((p) => (p as { text: string }).text)
      .join(" ")
      .trim();
    if (!text) return;

    spokenIds.current.add(lastAssistant.id);

    const userText = (lastUser?.parts ?? []).find(
      (p) => p.type === "text" && typeof (p as { text?: string }).text === "string"
    ) as { text?: string } | undefined;
    const meta = userText?.text ? voiceMetaMap.get(userText.text) : undefined;
    const lang = meta?.lang || voiceMode || "en-US";
    setSpeaking(true);
    speak(text, lang).finally(() => setSpeaking(false));
  }, [messages, status, speakerOn, voiceMetaMap, voiceMode]);

  // If the user mutes mid-utterance, hard-stop any in-flight audio.
  useEffect(() => {
    if (!speakerOn) {
      stopSpeaking();
      setSpeaking(false);
    }
  }, [speakerOn]);

  // Translate each assistant message into the caller's detected language for
  // on-screen display. Independent of TTS — runs even when the speaker is
  // muted, because the whole point is a literate bystander reading the
  // screen when the patient/caller can't process English audio fast enough.
  useEffect(() => {
    if (status === "streaming" || status === "submitted") return;
    // Find the last assistant message + the most recent user voice turn.
    let lastAssistant: typeof messages[number] | undefined;
    let lastUser: typeof messages[number] | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!lastAssistant && m.role === "assistant") lastAssistant = m;
      if (!lastUser && m.role === "user") lastUser = m;
      if (lastAssistant && lastUser) break;
    }
    if (!lastAssistant) return;
    if (translatedIds.current.has(lastAssistant.id)) return;

    const text = (lastAssistant.parts ?? [])
      .filter((p) => p.type === "text" && typeof (p as { text?: string }).text === "string")
      .map((p) => (p as { text: string }).text)
      .join(" ")
      .trim();
    if (!text) return;

    const userText = (lastUser?.parts ?? []).find(
      (p) => p.type === "text" && typeof (p as { text?: string }).text === "string"
    ) as { text?: string } | undefined;
    const meta = userText?.text ? voiceMetaMap.get(userText.text) : undefined;
    const lang = meta?.lang;
    // No detected non-English language → nothing to translate.
    if (!lang) return;
    const base = lang.toLowerCase().split("-")[0];
    if (base === "en" || base === "") return;

    translatedIds.current.add(lastAssistant.id);
    translateForDisplay(text, lang).then((result) => {
      if (!result.translatedText || result.translatedText === text) return;
      setTranslations((prev) => {
        const next = new Map(prev);
        next.set(lastAssistant!.id, {
          lang: result.lang,
          text: result.translatedText,
        });
        return next;
      });
    });
  }, [messages, status, voiceMetaMap]);

  const submit = (text: string, language: string = "en", voiceMeta?: VoiceMeta) => {
    if (!text.trim()) return;
    callerRef.current = { ...callerRef.current, language };
    if (voiceMeta) {
      setVoiceMetaMap((m) => {
        const next = new Map(m);
        next.set(text, voiceMeta);
        return next;
      });
    }
    sendMessage({ text });
    setTypedInput("");
  };

  const reset = () => {
    stopSpeaking();
    spokenIds.current = new Set();
    translatedIds.current = new Set();
    setMessages([]);
    setTypedInput("");
    setVoiceMetaMap(new Map());
    setTranslations(new Map());
  };

  const hasMessages = messages.length > 0;

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-4 pb-32 pt-6 flex flex-col">
      {/* Compact top bar */}
      <header className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">🚑</span>
          <span className="font-bold tracking-tight text-base" style={{ color: "var(--accent)" }}>
            Golden Hour
          </span>
          <span className="text-white/30">·</span>
          <span className="text-white/50 truncate">AI emergency dispatcher</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Always-on emergency dial. Works regardless of network or AI
              state — the OS dialer takes over the moment it's tapped. */}
          <a
            href={emergencyNumberFor(countryCode).tel}
            className="text-[11px] px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-bold transition shadow-sm shadow-red-900/30"
            title={`Dial ${emergencyNumberFor(countryCode).display} now`}
          >
            📞 {emergencyNumberFor(countryCode).display}
          </a>
          <button
            onClick={() => setSpeakerOn((v) => !v)}
            className={`text-[11px] px-2 py-1 rounded border transition ${
              speakerOn
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                : "border-white/15 bg-white/5 text-white/50 hover:text-white"
            }`}
            title={speakerOn ? "Mute spoken replies" : "Speak agent replies"}
            aria-label={speakerOn ? "Mute" : "Unmute"}
          >
            {speakerOn ? "🔊" : "🔇"}
          </button>
          {hasMessages && (
            <button
              onClick={reset}
              className="text-[11px] px-2 py-1 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition"
              title="Start a new emergency"
            >
              New
            </button>
          )}
          <GpsBadge geo={geo} status={geoStatus} />
        </div>
      </header>

      {/* Offline banner — sits above pipeline so a literate bystander
          knows why the agent went quiet. */}
      {!online && (
        <div className="mt-2 text-[11px] rounded-md px-3 py-1.5 bg-amber-500/15 border border-amber-500/30 text-amber-200 flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          You&apos;re offline — built-in guidance below. Tap 📞 above to
          call now.
        </div>
      )}

      {/* Pipeline strip */}
      <div className="mt-4">
        <PipelineStages messages={messages} status={status} />
      </div>

      {/* Voice mode selector */}
      <div className="mt-3 flex items-center justify-center gap-2 text-[11px]">
        <span className="text-white/40">Voice:</span>
        <select
          value={voiceMode}
          onChange={(e) => setVoiceMode(e.target.value)}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs"
        >
          {VOICE_MODES.map((m) => (
            <option key={m.code} value={m.code}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Hero or conversation */}
      {!hasMessages ? (
        <>
          <HeroPanel onSubmit={submit} voiceMode={voiceMode} />
          {/* If we boot up offline, surface the failsafe right on the
              landing screen — the user shouldn't have to tap mic first
              just to learn the app can't reach Vercel. */}
          {!online && (
            <FailsafeCard
              countryCode={countryCode}
              familyContact={callerRef.current.familyContacts?.[0]}
              reason="offline"
            />
          )}
        </>
      ) : (
        <section className="flex-1 flex flex-col gap-4 mt-4">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m as MessageShape}
              voiceMetaMap={voiceMetaMap}
              translations={translations}
            />
          ))}
          {status === "streaming" && (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80 animate-bounce [animation-delay:-0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80 animate-bounce [animation-delay:-0.1s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80 animate-bounce" />
              </span>
              Dispatcher thinking…
            </div>
          )}
          {speaking && status !== "streaming" && (
            <div className="flex items-center gap-2 text-sm text-emerald-300/80">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Dispatcher speaking — please listen
            </div>
          )}
          {/* Failsafe: render the offline panel whenever the agent fails
              or the device drops off the network mid-conversation. The
              caller is still in an emergency — we can't just show a red
              error toast. */}
          {(error || !online) && (
            <FailsafeCard
              countryCode={countryCode}
              familyContact={callerRef.current.familyContacts?.[0]}
              reason={!online ? "offline" : "agent_error"}
            />
          )}
          {error && (
            <details className="text-[10px] text-red-300/60 mt-1">
              <summary className="cursor-pointer">Technical detail</summary>
              <div className="mt-1 break-all">{error.message}</div>
            </details>
          )}
        </section>
      )}

      {hasMessages && (
        <BottomBar
          typedInput={typedInput}
          setTypedInput={setTypedInput}
          onSubmit={submit}
          disabled={status === "streaming" || speaking}
          voiceMode={voiceMode}
        />
      )}
    </main>
  );
}

// ===========================================================================
// GPS badge — shows real coords + accuracy or fallback indicator
// ===========================================================================

function GpsBadge({ geo, status }: { geo: GeoFix; status: "requesting" | "ready" }) {
  if (status === "requesting") {
    return (
      <span className="text-white/40 flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        locating…
      </span>
    );
  }
  const isReal = geo.source === "browser";
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={isReal ? "text-emerald-400" : "text-amber-400"}>📍</span>
      <span className="text-white/70 font-mono">
        {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}
      </span>
      {isReal ? (
        <span className="text-emerald-400/80">
          {geo.accuracyMeters ? `±${Math.round(geo.accuracyMeters)}m` : "live"}
        </span>
      ) : (
        <span className="text-amber-400/80">fallback</span>
      )}
    </div>
  );
}

// ===========================================================================
// Hero panel — giant mic button
// ===========================================================================

function HeroPanel({
  onSubmit,
  voiceMode,
}: {
  onSubmit: (text: string, language: string, voiceMeta?: VoiceMeta) => void;
  voiceMode: string;
}) {
  return (
    <section className="flex-1 flex flex-col items-center justify-center gap-8 mt-6">
      <GiantMic onSubmit={onSubmit} voiceMode={voiceMode} />

      <div className="w-full max-w-md">
        <p className="text-xs text-white/40 mb-2 text-center">or try a scenario</p>
        <div className="flex flex-col gap-1.5">
          {SAMPLE_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => onSubmit(p, "en")}
              className="text-left text-xs text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 transition"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function getEngine(voiceMode: string): "web" | "sarvam" {
  // Force MediaRecorder→Sarvam path on the Capacitor Android shell. Web
  // Speech API is unavailable in Android WebView, so picking "web" there
  // would fail with "not-allowed" before we even get to the mic.
  if (isNative()) return "sarvam";
  return VOICE_MODES.find((m) => m.code === voiceMode)?.engine ?? "web";
}

// Sarvam's STT-translate sync endpoint caps each clip at ~30s and rejects
// anything longer outright. Auto-stop a little under that so a long, panicked
// description still gets transcribed instead of failing wholesale.
const MAX_RECORDING_MS = 25_000;

// ===========================================================================
// Giant mic — Web Speech API in en-US
// ===========================================================================

function GiantMic({
  onSubmit,
  voiceMode,
}: {
  onSubmit: (text: string, language: string, voiceMeta?: VoiceMeta) => void;
  voiceMode: string;
}) {
  const [state, setState] = useState<"idle" | "recording" | "processing">("idle");
  const [transcript, setTranscript] = useState("");
  const [englishText, setEnglishText] = useState("");
  const [detectedLang, setDetectedLang] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const liveRef = useRef<{ stop: () => void } | null>(null);
  const recRef = useRef<{
    stop: () => Promise<Blob>;
    cancel: () => void;
    stream: MediaStream;
  } | null>(null);
  const transcriptRef = useRef("");
  // Last recorded audio blob — kept across an error so the user can
  // retry without re-speaking. Cleared on a successful submission.
  const lastBlobRef = useRef<Blob | null>(null);
  // Auto-stop timer for the 25s recording guard.
  const recTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const engine = getEngine(voiceMode);

  // Send a blob to Sarvam + dispatch; reused by both stop() and retry().
  const submitBlob = async (blob: Blob) => {
    setState("processing");
    const result = await transcribeAndTranslate(blob);
    if (result.error) {
      lastBlobRef.current = blob;
      setErr(result.error);
      setState("idle");
      return;
    }
    setTranscript(result.transcript);
    setEnglishText(result.englishText);
    setDetectedLang(result.detectedLanguage);
    if (result.englishText.trim()) {
      const meta: VoiceMeta = {
        lang: result.detectedLanguage || "en",
        original: result.transcript || result.englishText,
      };
      lastBlobRef.current = null;
      setTimeout(() => {
        onSubmit(
          result.englishText,
          (result.detectedLanguage || "en").split("-")[0],
          meta
        );
        setTranscript("");
        setEnglishText("");
        setDetectedLang("");
        setState("idle");
      }, 1400);
    } else {
      lastBlobRef.current = blob;
      setErr("We didn't catch any speech. Try again, a bit closer to the mic.");
      setState("idle");
    }
  };

  const retryLast = async () => {
    if (!lastBlobRef.current) return;
    setErr(null);
    await submitBlob(lastBlobRef.current);
  };

  // Stop recording + submit. Shared by the manual "tap to dispatch" tap and
  // the 25s auto-stop guard; recRef is nulled to guard against double-finish.
  const finishRecording = async () => {
    if (recTimerRef.current) {
      clearTimeout(recTimerRef.current);
      recTimerRef.current = null;
    }
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    const blob = await rec.stop();
    setActiveStream(null);
    await submitBlob(blob);
  };

  const onTap = async () => {
    if (state === "idle") {
      setErr(null);
      setTranscript("");
      setEnglishText("");
      setDetectedLang("");
      transcriptRef.current = "";

      if (engine === "web") {
        if (!isSpeechRecognitionSupported()) {
          setErr("Voice not supported. Use Chrome or Edge.");
          return;
        }
        const h = startLiveRecognition(
          voiceMode,
          (t) => {
            setTranscript(t.transcript);
            transcriptRef.current = t.transcript;
          },
          (msg) => {
            setErr(msg);
            setState("idle");
          }
        );
        if (h) {
          liveRef.current = h;
          setState("recording");
        }
      } else {
        // Sarvam path: record audio, upload on stop
        if (!isRecordingSupported()) {
          setErr("Audio recording not supported in this browser.");
          return;
        }
        try {
          const r = await startRecording();
          recRef.current = r;
          setActiveStream(r.stream);
          setState("recording");
          recTimerRef.current = setTimeout(() => {
            void finishRecording();
          }, MAX_RECORDING_MS);
        } catch {
          setErr("Microphone permission denied.");
        }
      }
      return;
    }

    if (state === "recording" && engine === "web") {
      liveRef.current?.stop();
      setState("idle");
      const finalText = transcriptRef.current.trim();
      if (!finalText) {
        setErr("Didn't catch that — try again.");
        return;
      }
      const langPrefix = voiceMode.split("-")[0];
      onSubmit(finalText, langPrefix, { lang: voiceMode, original: finalText });
      setTimeout(() => setTranscript(""), 1200);
      return;
    }

    if (state === "recording" && engine === "sarvam") {
      await finishRecording();
    }
  };

  const label =
    state === "idle"
      ? "Tap to speak"
      : state === "recording"
      ? "Listening… tap to dispatch"
      : "Transcribing…";

  return (
    <div className="flex flex-col items-center gap-5">
      <button
        onClick={onTap}
        disabled={state === "processing"}
        className={`relative w-48 h-48 rounded-full flex items-center justify-center text-6xl transition-all duration-200 shadow-2xl ${
          state === "recording"
            ? "bg-red-600 text-white scale-110"
            : state === "processing"
            ? "bg-amber-500/60 text-black"
            : "bg-red-500 hover:bg-red-400 text-white hover:scale-105"
        }`}
        aria-label={label}
      >
        {state === "recording" && (
          <>
            <span className="absolute inset-0 rounded-full bg-red-600 animate-ping opacity-40" />
            <span className="absolute inset-[-12px] rounded-full border-2 border-red-500/40 animate-pulse" />
          </>
        )}
        <span className="relative">{state === "processing" ? "⏳" : "🎤"}</span>
      </button>

      <div className="text-center min-h-[2rem]">
        <div className={`text-sm font-medium ${state === "recording" ? "text-red-400" : "text-white/80"}`}>
          {label}
        </div>
        <div className="text-xs text-white/40 mt-1">
          {engine === "sarvam"
            ? "Speak any Indian language — we auto-detect"
            : "Describe the emergency — who, what, where"}
        </div>
      </div>

      {/* Live waveform — only renders while a mic stream is active (sarvam path). */}
      {activeStream && (
        <Waveform stream={activeStream} className="w-full max-w-md" />
      )}
      {activeStream && (
        <div className="text-[10px] uppercase tracking-wider text-white/40">
          Keep it brief — auto-sends at 25s
        </div>
      )}

      {(transcript || englishText) && (
        <div className="w-full max-w-md p-3 rounded-xl bg-white/5 border border-white/10 text-sm space-y-2">
          {detectedLang && (
            <div className="text-[10px] uppercase tracking-wider text-emerald-400">
              🌐 Detected: {languageName(detectedLang)}
            </div>
          )}
          {transcript && (
            <div className="text-white/90">{transcript}</div>
          )}
          {englishText && englishText !== transcript && (
            <div className="text-white/60 text-xs border-t border-white/10 pt-2">
              <span className="text-[10px] uppercase tracking-wider mr-2">EN</span>
              {englishText}
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="flex flex-col items-center gap-2 max-w-xs text-center">
          <div className="text-xs text-red-300">{friendlyMicError(err)}</div>
          <div className="flex gap-2">
            {lastBlobRef.current && (
              <button
                type="button"
                onClick={retryLast}
                disabled={state === "processing"}
                className="text-xs px-3 py-1.5 rounded-md bg-amber-500 text-black font-semibold hover:bg-amber-400 disabled:opacity-40 transition"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setErr(null);
                lastBlobRef.current = null;
              }}
              className="text-xs px-3 py-1.5 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-white/70 transition"
            >
              Dismiss
            </button>
          </div>
          <details className="text-[10px] text-red-300/60">
            <summary className="cursor-pointer">Details</summary>
            <div className="mt-1 text-left break-all">{err}</div>
          </details>
        </div>
      )}
    </div>
  );
}

// Map raw STT/recorder errors to a one-line user-facing message.
function friendlyMicError(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes("502") || r.includes("sarvam stt")) {
    return "I didn't catch that — the transcription service hiccuped. Your recording is saved: tap Retry, or type it instead.";
  }
  if (r.includes("permission") || r.includes("not-allowed")) {
    return "Microphone access is off. Enable it in settings, or type the emergency instead.";
  }
  if (r.includes("network") || r.includes("failed to fetch")) {
    return "Network blip — your recording is saved. Tap Retry, or type it instead.";
  }
  if (r.includes("didn't catch") || r.includes("any speech")) {
    return "I didn't catch that — tap Retry, or type it instead.";
  }
  return "I didn't catch that — your recording is saved. Tap Retry, or type it instead.";
}

// ===========================================================================
// Pipeline stages
// ===========================================================================

interface MessagePart {
  type: string;
  text?: string;
  state?: string;
  output?: { value?: unknown } | unknown;
  toolName?: string;
}
interface MessageShape {
  id: string;
  role: string;
  parts?: MessagePart[];
}

const STAGES = [
  { key: "voice", label: "🎤 Voice", tools: [] as string[] },
  { key: "triage", label: "🩺 Triage", tools: ["triagePatient"] },
  { key: "match", label: "🏥 Hospital", tools: ["findHospitals"] },
  { key: "dispatch", label: "📱 Dispatch", tools: ["sendWhatsApp"] },
];

function PipelineStages({
  messages,
  status,
}: {
  messages: MessageShape[];
  status: string;
}) {
  const firedTools = new Set<string>();
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type?.startsWith("tool-") && p.toolName) firedTools.add(p.toolName);
    }
  }
  const hasUser = messages.some((m) => m.role === "user");

  return (
    <div className="flex items-center gap-1.5 text-[11px] flex-wrap justify-center">
      {STAGES.map((s, i) => {
        const autoFired = s.key === "voice" && hasUser;
        const toolFired = s.tools.some((t) => firedTools.has(t));
        const fired = autoFired || toolFired;
        const isActive = status === "streaming";
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className={`px-2 py-1 rounded-md border transition ${
                fired
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-white/5 border-white/10 text-white/40"
              } ${!fired && isActive ? "animate-pulse" : ""}`}
            >
              {s.label}
            </span>
            {i < STAGES.length - 1 && <span className="text-white/20">→</span>}
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Bottom bar — small mic + typed fallback
// ===========================================================================

function BottomBar({
  typedInput,
  setTypedInput,
  onSubmit,
  disabled,
  voiceMode,
}: {
  typedInput: string;
  setTypedInput: (s: string) => void;
  onSubmit: (text: string, language: string, voiceMeta?: VoiceMeta) => void;
  disabled: boolean;
  voiceMode: string;
}) {
  const [state, setState] = useState<"idle" | "recording" | "processing">("idle");
  const [transcript, setTranscript] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const transcriptRef = useRef("");
  const liveRef = useRef<{ stop: () => void } | null>(null);
  const recRef = useRef<{
    stop: () => Promise<Blob>;
    cancel: () => void;
    stream: MediaStream;
  } | null>(null);
  // Preserve the last recorded blob across an STT error so the user can retry.
  const lastBlobRef = useRef<Blob | null>(null);
  // Auto-stop timer for the 25s recording guard.
  const recTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const engine = getEngine(voiceMode);

  const submitBlob = async (blob: Blob) => {
    setState("processing");
    const r = await transcribeAndTranslate(blob);
    if (r.error) {
      lastBlobRef.current = blob;
      setErr(r.error);
      setState("idle");
      return;
    }
    if (r.englishText.trim()) {
      lastBlobRef.current = null;
      onSubmit(
        r.englishText,
        (r.detectedLanguage || "en").split("-")[0],
        { lang: r.detectedLanguage || "en", original: r.transcript || r.englishText }
      );
      setTranscript("");
      setState("idle");
    } else {
      lastBlobRef.current = blob;
      setErr("We didn't catch any speech. Try again, a bit closer to the mic.");
      setState("idle");
    }
  };

  const retryLast = async () => {
    if (!lastBlobRef.current) return;
    setErr(null);
    await submitBlob(lastBlobRef.current);
  };

  // Stop recording + submit. Shared by the manual mic tap and the 25s
  // auto-stop guard; recRef is nulled to guard against double-finish.
  const finishRecording = async () => {
    if (recTimerRef.current) {
      clearTimeout(recTimerRef.current);
      recTimerRef.current = null;
    }
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    const blob = await rec.stop();
    setActiveStream(null);
    await submitBlob(blob);
  };

  const onMic = async () => {
    if (state === "idle") {
      setErr(null);
      setTranscript("");
      transcriptRef.current = "";
      if (engine === "web") {
        const h = startLiveRecognition(
          voiceMode,
          (t) => {
            setTranscript(t.transcript);
            transcriptRef.current = t.transcript;
          },
          (msg) => {
            setErr(msg);
            setState("idle");
          }
        );
        if (h) {
          liveRef.current = h;
          setState("recording");
        }
      } else {
        try {
          const r = await startRecording();
          recRef.current = r;
          setActiveStream(r.stream);
          setState("recording");
          recTimerRef.current = setTimeout(() => {
            void finishRecording();
          }, MAX_RECORDING_MS);
        } catch {
          setErr("Microphone permission denied.");
        }
      }
      return;
    }
    if (state === "recording" && engine === "web") {
      liveRef.current?.stop();
      setState("idle");
      const finalText = transcriptRef.current.trim();
      if (finalText) {
        onSubmit(finalText, voiceMode.split("-")[0], {
          lang: voiceMode,
          original: finalText,
        });
      }
      setTranscript("");
      return;
    }
    if (state === "recording" && engine === "sarvam") {
      await finishRecording();
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur border-t border-white/10">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {activeStream && (
          <div className="mb-2">
            <Waveform stream={activeStream} height={40} />
            <div className="text-[10px] uppercase tracking-wider text-white/40 mt-1 text-center">
              Keep it brief — auto-sends at 25s
            </div>
          </div>
        )}
        {transcript && (
          <div className="text-xs text-emerald-300 mb-2 truncate">
            🎙️ {transcript}
          </div>
        )}
        {err && (
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="text-red-300 flex-1 truncate">
              {friendlyMicError(err)}
            </span>
            {lastBlobRef.current && (
              <button
                type="button"
                onClick={retryLast}
                disabled={state === "processing"}
                className="px-2 py-1 rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 disabled:opacity-40 transition"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setErr(null);
                lastBlobRef.current = null;
              }}
              className="px-2 py-1 rounded border border-white/15 bg-white/5 text-white/60 hover:text-white transition"
            >
              ✕
            </button>
          </div>
        )}
        <form
          className="flex gap-2 items-stretch"
          onSubmit={(e) => {
            e.preventDefault();
            if (!typedInput.trim()) return;
            onSubmit(typedInput, "en");
          }}
        >
          <button
            type="button"
            onClick={onMic}
            disabled={disabled}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl transition ${
              state === "recording"
                ? "bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50"
                : "bg-red-500 hover:bg-red-400 text-white"
            } disabled:opacity-40`}
            title={state === "recording" ? "Tap to dispatch" : "Tap to speak"}
          >
            {state === "recording" ? "■" : "🎤"}
          </button>

          <input
            value={typedInput}
            onChange={(e) => setTypedInput(e.target.value)}
            placeholder="Or type the emergency…"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-white/30"
          />

          <button
            type="submit"
            disabled={disabled || !typedInput.trim()}
            className="px-5 rounded-lg bg-amber-500 text-black font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-400 transition"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

// ===========================================================================
// Message bubbles + tool result cards
// ===========================================================================

function MessageBubble({
  message,
  voiceMetaMap,
  translations,
}: {
  message: MessageShape;
  voiceMetaMap?: Map<string, VoiceMeta>;
  translations?: Map<string, { lang: string; text: string }>;
}) {
  const isUser = message.role === "user";

  // Pull the first text part of a user message so we can look up its voice
  // metadata (detected language + original transcript) by message text.
  const userText = isUser
    ? (message.parts ?? []).find((p) => p.type === "text" && p.text)?.text
    : undefined;
  const voiceMeta = userText ? voiceMetaMap?.get(userText) : undefined;

  // Show the original-script line only when it's meaningfully different
  // from the English (i.e. non-Latin script or a translated turn).
  const hasOriginalScript =
    !!voiceMeta &&
    voiceMeta.original.trim().length > 0 &&
    voiceMeta.original.trim() !== userText?.trim();

  // Bilingual rendering — only relevant on assistant messages, and only
  // when we have a translation cached for this message ID. The toggle
  // defaults to the caller's language (the bystander who reads it is the
  // one most likely to be in distress); they can flip to EN to hand the
  // phone to an English-literate helper.
  const translation = !isUser ? translations?.get(message.id) : undefined;
  const [showTranslation, setShowTranslation] = useState(true);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser ? "bg-amber-500/20 border border-amber-500/30" : "bg-white/5 border border-white/10"
        }`}
      >
        {voiceMeta && (
          <div className="mb-2 text-[11px] text-white/55">
            <div className="flex items-center gap-1.5">
              <span>🎙</span>
              <span className="uppercase tracking-wide">
                Detected: {languageName(voiceMeta.lang)}
              </span>
            </div>
            {hasOriginalScript && (
              <div className="mt-1 pl-4 text-[13px] text-white/75 italic leading-snug">
                “{voiceMeta.original}”
              </div>
            )}
            <div className="mt-1 h-px bg-white/10" />
          </div>
        )}
        {/* Bilingual toggle — only on assistant messages that have a
            cached non-English translation. A bystander who reads Kannada
            but not English can flip this and follow along. */}
        {translation && (
          <div className="mb-2 flex items-center gap-1.5 text-[10px]">
            <span className="text-white/40 uppercase tracking-wide">Read in:</span>
            <button
              type="button"
              onClick={() => setShowTranslation(true)}
              className={`px-2 py-0.5 rounded-full transition ${
                showTranslation
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "border border-white/10 text-white/50 hover:text-white"
              }`}
            >
              {languageName(translation.lang)}
            </button>
            <button
              type="button"
              onClick={() => setShowTranslation(false)}
              className={`px-2 py-0.5 rounded-full transition ${
                !showTranslation
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "border border-white/10 text-white/50 hover:text-white"
              }`}
            >
              English
            </button>
          </div>
        )}
        {(message.parts ?? []).map((part, i) => {
          if (part.type === "text" && part.text) {
            // For assistant messages with a translation, swap the text
            // body when the toggle says so. Tool cards still render in
            // English — they're structured data, not prose, and a
            // mid-translation hospital list is more confusing than helpful.
            const displayText =
              translation && showTranslation ? translation.text : part.text;
            return (
              <div key={i} className="text-sm whitespace-pre-wrap leading-relaxed">
                {renderMarkdown(displayText)}
              </div>
            );
          }
          if (part.type?.startsWith("tool-") && part.state === "output-available") {
            const out = (part.output as { value?: unknown })?.value ?? part.output;
            return <ToolResultCard key={i} toolName={part.toolName ?? part.type} output={out} />;
          }
          if (part.type?.startsWith("tool-") && part.state === "input-available") {
            const friendly = friendlyName(part.toolName ?? part.type);
            return (
              <div key={i} className="text-xs text-amber-400/80 mt-2 flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {friendly}…
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function friendlyName(toolName: string): string {
  if (toolName.includes("triage")) return "Running medical triage";
  if (toolName.includes("findHospitals")) return "Finding hospitals";
  if (toolName.includes("sendWhatsApp")) return "Sending WhatsApp alert";
  if (toolName.includes("searchWeb")) return "Searching the web";
  return toolName;
}

const SEVERITY_STYLE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  CRITICAL: { bg: "bg-red-500/15", border: "border-red-500/40", text: "text-red-400", label: "CRITICAL" },
  HIGH: { bg: "bg-orange-500/15", border: "border-orange-500/40", text: "text-orange-400", label: "HIGH" },
  MODERATE: { bg: "bg-yellow-500/15", border: "border-yellow-500/40", text: "text-yellow-300", label: "MODERATE" },
  LOW: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-400", label: "LOW" },
};

function ToolResultCard({ toolName, output }: { toolName: string; output: unknown }) {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;

  if (toolName.includes("triage") && o._card) {
    const c = o._card as Record<string, unknown>;
    const sev = SEVERITY_STYLE[(c.severity as string) ?? "MODERATE"];
    return (
      <div className={`mt-3 rounded-xl border ${sev.border} ${sev.bg} p-3`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-xs font-bold ${sev.text}`}>{sev.label}</span>
          <span className="text-xs text-white/50">
            ESI-{String(c.esi)} · ~{String(c.timeWindow)} min window
          </span>
        </div>
        <div className="text-sm font-semibold mb-1">{String(c.condition)}</div>
        <div className="text-xs text-white/70">
          Required: {(c.capabilities as string[])?.join(", ") || "—"}
        </div>
        {Array.isArray(c.firstAid) && c.firstAid.length > 0 && (
          <div className="text-xs text-white/60 mt-2">
            <strong>First aid:</strong> {(c.firstAid as string[]).join(" · ")}
          </div>
        )}
        <div className="text-[10px] text-white/40 mt-2 italic">{String(c.disclaimer)}</div>
      </div>
    );
  }

  if (toolName.includes("findHospitals") && Array.isArray(o._cards)) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        {(o._cards as Record<string, unknown>[]).map((c, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
            <div className="flex justify-between items-start mb-1">
              <div className="font-semibold">{String(c.name)}</div>
              <div className="text-xs text-white/50">
                {String(c.distanceKm)} km · {String(c.matchScore)}%
              </div>
            </div>
            <div className="text-xs text-emerald-400">
              ✓ {(c.matched as string[])?.join(", ") || "—"}
            </div>
            {(c.missing as string[])?.length > 0 && (
              <div className="text-xs text-red-400">
                ✗ missing: {(c.missing as string[]).join(", ")}
              </div>
            )}
            {Boolean(c.phone) && <div className="text-xs text-white/50 mt-1">{String(c.phone)}</div>}
            <div className="text-[10px] text-white/30 mt-1">via {String(c.source)}</div>
          </div>
        ))}
      </div>
    );
  }

  if (toolName.includes("sendWhatsApp") && o._card) {
    const c = o._card as Record<string, unknown>;
    const sent = c.status === "sent" || c.status === "mocked";
    const recipientType = String(c.recipientType);

    // Color the left bar by recipient so all 4 dispatches are
    // distinguishable at a glance (hospital=red, ambulance=amber,
    // nurse=sky, family=violet, other=slate).
    const recipientStyles: Record<string, { bar: string; chip: string; icon: string }> = {
      hospital:  { bar: "bg-red-500",    chip: "bg-red-500/20 text-red-300",       icon: "🏥" },
      ambulance: { bar: "bg-amber-500",  chip: "bg-amber-500/20 text-amber-300",   icon: "🚑" },
      nurse:     { bar: "bg-sky-500",    chip: "bg-sky-500/20 text-sky-300",       icon: "🩺" },
      family:    { bar: "bg-violet-500", chip: "bg-violet-500/20 text-violet-300", icon: "👪" },
      other:     { bar: "bg-slate-400",  chip: "bg-slate-500/20 text-slate-300",   icon: "📨" },
    };
    const style = recipientStyles[recipientType] ?? recipientStyles.other;

    return (
      <div
        className={`mt-3 flex overflow-hidden rounded-xl border ${
          sent ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
        }`}
      >
        {/* Left color bar — recipient-type at a glance */}
        <div className={`w-1.5 shrink-0 ${style.bar}`} aria-hidden />

        <div className="flex-1 p-3 text-sm">
          <div className="flex justify-between items-start mb-1">
            <div className="font-semibold flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${style.chip}`}>
                {style.icon} {recipientType}
              </span>
              <span className="text-white/80">{String(c.recipientName)}</span>
            </div>
            <div className="text-xs uppercase tracking-wide">{String(c.status)}</div>
          </div>
          <div className="text-xs text-white/60 whitespace-pre-wrap">{String(c.body)}</div>
          <div className="text-[10px] text-white/40 mt-1">{String(c.to)}</div>
        </div>
      </div>
    );
  }

  return null;
}
