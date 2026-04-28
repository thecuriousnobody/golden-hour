"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { CallerContext } from "@/lib/types";
import {
  isRecordingSupported,
  startRecording,
  transcribeAndTranslate,
  languageName,
} from "@/lib/speech";
import { renderMarkdown } from "@/lib/markdown";

const SAMPLE_PROMPTS = [
  "My grandfather is clutching his chest and sweating heavily. We're at MG Road, Bangalore. He's 72.",
  "Snake bit my brother in the field. His leg is swelling fast. We're outside Bangalore in Anekal.",
  "There's been a road accident on Outer Ring Road. Two people unconscious, heavy bleeding from one.",
  "My wife is in labor, water broke 20 minutes ago, contractions are 3 minutes apart. Indiranagar.",
];

const BANGALORE_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  "MG Road (central)": { lat: 12.9716, lng: 77.5946 },
  Indiranagar: { lat: 12.9784, lng: 77.6408 },
  Koramangala: { lat: 12.9352, lng: 77.6245 },
  Whitefield: { lat: 12.9698, lng: 77.7499 },
  "Anekal (south)": { lat: 12.7, lng: 77.7 },
};

export default function Home() {
  const [locationName, setLocationName] = useState("MG Road (central)");
  const callerRef = useRef<CallerContext>({
    lat: 12.9716,
    lng: 77.5946,
    language: "en",
    name: "Demo Caller",
    phone: "+919999999999",
    familyContacts: [{ name: "Spouse", phone: "+918888888888" }],
  });

  useEffect(() => {
    const loc = BANGALORE_LOCATIONS[locationName];
    if (loc) {
      callerRef.current = { ...callerRef.current, lat: loc.lat, lng: loc.lng };
    }
  }, [locationName]);

  const [typedInput, setTypedInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/dispatch",
      body: () => ({ caller: callerRef.current }),
    }),
  });

  const submit = (text: string, language: string = "en") => {
    if (!text.trim()) return;
    callerRef.current = { ...callerRef.current, language };
    sendMessage({ text });
    setTypedInput("");
  };

  const hasMessages = messages.length > 0;

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-4 pb-32 pt-6 flex flex-col">
      {/* Compact top bar */}
      <header className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-lg">🚑</span>
          <span className="font-bold tracking-tight text-base" style={{ color: "var(--accent)" }}>
            Golden Hour
          </span>
          <span className="text-white/30">·</span>
          <span className="text-white/50">AI emergency dispatcher</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/40">📍</span>
          <select
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs"
          >
            {Object.keys(BANGALORE_LOCATIONS).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Pipeline strip */}
      <div className="mt-4">
        <PipelineStages messages={messages} status={status} />
      </div>

      {/* Hero: big mic when idle, or conversation */}
      {!hasMessages ? (
        <HeroPanel onSubmit={submit} />
      ) : (
        <section className="flex-1 flex flex-col gap-4 mt-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m as MessageShape} />
          ))}
          {status === "streaming" && (
            <div className="text-sm text-white/40">Dispatcher thinking…</div>
          )}
          {error && <div className="text-sm text-red-400">Error: {error.message}</div>}
        </section>
      )}

      {/* Bottom: smaller mic + typed fallback (only after first message) */}
      {hasMessages && (
        <BottomBar
          typedInput={typedInput}
          setTypedInput={setTypedInput}
          onSubmit={submit}
          disabled={status === "streaming"}
        />
      )}
    </main>
  );
}

// ===========================================================================
// Hero panel — giant mic button, prominent for low-literacy users
// ===========================================================================

function HeroPanel({ onSubmit }: { onSubmit: (text: string, language: string) => void }) {
  return (
    <section className="flex-1 flex flex-col items-center justify-center gap-8 mt-6">
      <GiantMic onSubmit={onSubmit} />

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

// ===========================================================================
// Giant mic — the centerpiece for low-literacy, multilingual callers
// ===========================================================================

function GiantMic({ onSubmit }: { onSubmit: (text: string, language: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "processing">("idle");
  const [original, setOriginal] = useState("");
  const [english, setEnglish] = useState("");
  const [detectedLang, setDetectedLang] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const handleRef = useRef<{ stop: () => Promise<Blob>; cancel: () => void } | null>(null);

  const onTap = async () => {
    if (state === "idle") {
      setErr(null);
      setOriginal("");
      setEnglish("");
      setDetectedLang("");
      if (!isRecordingSupported()) {
        setErr("Voice recording not supported in this browser.");
        return;
      }
      try {
        const h = await startRecording();
        handleRef.current = h;
        setState("recording");
      } catch (e) {
        setErr("Microphone permission denied. Please enable mic access.");
      }
      return;
    }

    if (state === "recording") {
      setState("processing");
      const blob = await handleRef.current!.stop();
      const result = await transcribeAndTranslate(blob);
      if (result.error) {
        setErr(result.error);
        setState("idle");
        return;
      }
      setOriginal(result.transcript);
      setEnglish(result.englishText);
      setDetectedLang(result.detectedLanguage);

      if (result.englishText.trim()) {
        // Briefly display, then dispatch
        setTimeout(() => {
          onSubmit(result.englishText, (result.detectedLanguage || "en").split("-")[0]);
          setOriginal("");
          setEnglish("");
          setDetectedLang("");
          setState("idle");
        }, 1400);
      } else {
        setErr("Didn't catch that. Try again.");
        setState("idle");
      }
    }
  };

  const label =
    state === "idle" ? "Tap to speak" : state === "recording" ? "Listening… tap to stop" : "Transcribing…";

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
        <div
          className={`text-sm font-medium ${
            state === "recording" ? "text-red-400" : "text-white/80"
          }`}
        >
          {label}
        </div>
        <div className="text-xs text-white/40 mt-1">
          Speak in any Indian language — we auto-detect
        </div>
      </div>

      {/* Live transcripts */}
      {(original || english || detectedLang) && (
        <div className="w-full max-w-md p-3 rounded-xl bg-white/5 border border-white/10 text-sm space-y-2">
          {detectedLang && (
            <div className="text-[10px] uppercase tracking-wider text-emerald-400">
              🌐 Detected: {languageName(detectedLang)}
            </div>
          )}
          {english && (
            <div className="text-white/90">
              {english}
            </div>
          )}
        </div>
      )}

      {err && (
        <details className="text-xs text-red-400 text-center max-w-xs">
          <summary className="cursor-pointer">Something went wrong — tap for details</summary>
          <div className="mt-2 text-[10px] text-red-300/70 text-left break-all">{err}</div>
        </details>
      )}
    </div>
  );
}

// ===========================================================================
// Pipeline stages — the transparent agent journey
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
  { key: "translate", label: "🌐 Translate", tools: [] as string[] },
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
  // Consider voice+translate fired if we have any user messages
  const hasUser = messages.some((m) => m.role === "user");

  return (
    <div className="flex items-center gap-1.5 text-[11px] flex-wrap justify-center">
      {STAGES.map((s, i) => {
        const autoFired =
          (s.key === "voice" || s.key === "translate") && hasUser;
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
// Bottom bar — smaller mic + typed fallback (post-first-message)
// ===========================================================================

function BottomBar({
  typedInput,
  setTypedInput,
  onSubmit,
  disabled,
}: {
  typedInput: string;
  setTypedInput: (s: string) => void;
  onSubmit: (text: string, language: string) => void;
  disabled: boolean;
}) {
  const [state, setState] = useState<"idle" | "recording" | "processing">("idle");
  const [err, setErr] = useState<string | null>(null);
  const handleRef = useRef<{ stop: () => Promise<Blob>; cancel: () => void } | null>(null);

  const onMic = async () => {
    if (state === "idle") {
      setErr(null);
      if (!isRecordingSupported()) {
        setErr("Voice not supported.");
        return;
      }
      try {
        const h = await startRecording();
        handleRef.current = h;
        setState("recording");
      } catch {
        setErr("Mic blocked");
      }
      return;
    }
    if (state === "recording") {
      setState("processing");
      const blob = await handleRef.current!.stop();
      const r = await transcribeAndTranslate(blob);
      setState("idle");
      if (r.error || !r.englishText.trim()) {
        setErr(r.error || "Nothing transcribed");
        return;
      }
      onSubmit(r.englishText, (r.detectedLanguage || "en").split("-")[0]);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur border-t border-white/10">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {err && <div className="text-xs text-red-400 mb-2">{err}</div>}
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
            disabled={disabled || state === "processing"}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl transition ${
              state === "recording"
                ? "bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50"
                : state === "processing"
                ? "bg-amber-500/60 text-black"
                : "bg-red-500 hover:bg-red-400 text-white"
            } disabled:opacity-40`}
            title={state === "recording" ? "Tap to stop" : "Tap to speak"}
          >
            {state === "processing" ? "⏳" : state === "recording" ? "■" : "🎤"}
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

function MessageBubble({ message }: { message: MessageShape }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser ? "bg-amber-500/20 border border-amber-500/30" : "bg-white/5 border border-white/10"
        }`}
      >
        {(message.parts ?? []).map((part, i) => {
          if (part.type === "text" && part.text) {
            return (
              <div key={i} className="text-sm whitespace-pre-wrap leading-relaxed">
                {renderMarkdown(part.text)}
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
            {c.phone && <div className="text-xs text-white/50 mt-1">{String(c.phone)}</div>}
            <div className="text-[10px] text-white/30 mt-1">via {String(c.source)}</div>
          </div>
        ))}
      </div>
    );
  }

  if (toolName.includes("sendWhatsApp") && o._card) {
    const c = o._card as Record<string, unknown>;
    const sent = c.status === "sent" || c.status === "mocked";
    return (
      <div
        className={`mt-3 rounded-xl border p-3 text-sm ${
          sent
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-red-500/30 bg-red-500/10"
        }`}
      >
        <div className="flex justify-between items-start mb-1">
          <div className="font-semibold capitalize">
            {String(c.recipientType)} · {String(c.recipientName)}
          </div>
          <div className="text-xs uppercase tracking-wide">{String(c.status)}</div>
        </div>
        <div className="text-xs text-white/60 whitespace-pre-wrap">{String(c.body)}</div>
        <div className="text-[10px] text-white/40 mt-1">{String(c.to)}</div>
      </div>
    );
  }

  return null;
}
