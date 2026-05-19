"use client";

/**
 * Failsafe panel — shown when the AI agent fails or the device is offline.
 *
 * Everything rendered here is bundled in the JS. No Sarvam, no Claude, no
 * Google Places, no Twilio. The only "external" surfaces are:
 *   - `tel:` links (OS dialer — works without internet)
 *   - The user's eyes reading bundled text
 *
 * This is the "AI gave up, you're not on your own" view. It's intentionally
 * boring and high-contrast: red emergency button, expandable first-aid
 * steps, hospital phone numbers, family contact.
 */

import { useState } from "react";
import {
  FAILSAFE_HOSPITALS,
  UNIVERSAL_FIRST_AID,
  emergencyNumberFor,
  type FailsafeHospital,
  type FirstAidStep,
} from "@/lib/failsafe-content";

interface Props {
  /** Country code from env (e.g. "1" or "91"). Picks 911 vs 108 + region. */
  countryCode: string;
  /** Caller's name + family contact, surfaced so a stranger can use the phone. */
  familyContact?: { name: string; phone: string };
  /** Optional reason — surfaced in the disclaimer for transparency. */
  reason?: "agent_error" | "offline" | "network";
}

export function FailsafeCard({ countryCode, familyContact, reason }: Props) {
  const em = emergencyNumberFor(countryCode);
  const hospitals: FailsafeHospital[] = FAILSAFE_HOSPITALS.filter(
    (h) => h.region === em.region
  );

  const reasonLabel =
    reason === "offline"
      ? "Offline — using built-in guidance"
      : reason === "network"
      ? "Network blip — using built-in guidance"
      : "AI assist is temporarily down";

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="mt-4 rounded-2xl border-2 border-red-500/50 bg-red-950/40 overflow-hidden"
    >
      <header className="px-4 py-3 bg-red-500/15 border-b border-red-500/30 flex items-center gap-2">
        <span className="text-xl">⚠️</span>
        <div className="flex-1">
          <div className="text-sm font-bold text-red-200">{reasonLabel}</div>
          <div className="text-[11px] text-red-200/70">
            Follow these steps. Help is one tap away.
          </div>
        </div>
      </header>

      {/* Biggest button on the page — one-tap dial. */}
      <a
        href={em.tel}
        className="block mx-4 mt-4 mb-3 py-5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-center text-2xl font-bold tracking-wide transition shadow-lg shadow-red-900/40 active:scale-[0.98]"
      >
        📞 Call {em.display} now
      </a>

      {/* Family contact — second-most-important. */}
      {familyContact && (
        <a
          href={`tel:${familyContact.phone.replace(/\s+/g, "")}`}
          className="block mx-4 mb-3 py-3 rounded-xl bg-violet-600/80 hover:bg-violet-500 text-white text-center text-base font-semibold transition"
        >
          👪 Call {familyContact.name} — {familyContact.phone}
        </a>
      )}

      {/* Hospital phone numbers — bundled, work offline. */}
      <div className="px-4 mb-3">
        <div className="text-[11px] uppercase tracking-wider text-red-200/70 mb-2">
          Nearest hospitals
        </div>
        <div className="flex flex-col gap-1.5">
          {hospitals.map((h) => (
            <a
              key={h.phone}
              href={`tel:${h.phone.replace(/[^+\d]/g, "")}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-sm transition"
            >
              <div className="min-w-0">
                <div className="font-medium text-white/90 truncate">
                  {h.name}
                </div>
                <div className="text-[11px] text-white/50 truncate">
                  {h.note}
                </div>
              </div>
              <div className="text-sky-300 font-mono text-xs whitespace-nowrap">
                {h.phone}
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Universal first-aid — collapsible cards, so the page isn't a wall. */}
      <div className="px-4 pb-4">
        <div className="text-[11px] uppercase tracking-wider text-red-200/70 mb-2">
          While you wait — universal first-aid
        </div>
        <div className="flex flex-col gap-1.5">
          {UNIVERSAL_FIRST_AID.map((fa) => (
            <FirstAidPanel key={fa.title} fa={fa} />
          ))}
        </div>
        <div className="mt-3 text-[10px] text-white/40 italic leading-snug">
          AI-assisted triage is not a medical diagnosis. These steps are
          general first-aid guidance. Call {em.display} for trained help.
        </div>
      </div>
    </section>
  );
}

function FirstAidPanel({ fa }: { fa: FirstAidStep }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-white/5 transition"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-white/90">{fa.title}</div>
          <div className="text-[11px] text-white/50 truncate">{fa.when}</div>
        </div>
        <span className={`text-white/40 transition-transform ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>
      {open && (
        <ol className="px-4 pb-3 text-sm text-white/85 list-decimal list-inside space-y-1.5 leading-snug">
          {fa.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
