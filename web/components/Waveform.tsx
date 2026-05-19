"use client";

/**
 * Live mic waveform — visual confirmation that we're actually capturing
 * the caller's voice, sized to their volume in real time.
 *
 * Tap-to-record on a phone is a leap of faith. Without feedback, the user
 * starts speaking, then wonders "is it listening?", then taps again
 * (cancelling the recording mid-sentence). The waveform replaces that
 * doubt with peripheral-vision confidence — same trick WisprFlow, ChatGPT
 * voice, and Apple Siri all use.
 *
 * Pure Web Audio. Zero network. Zero state outside this component.
 */

import { useEffect, useRef } from "react";

interface Props {
  /** Active mic MediaStream, or null when not recording. */
  stream: MediaStream | null;
  /** Pixel height (renders at 2x DPR for retina). */
  height?: number;
  /** Tailwind class hooks for the container. */
  className?: string;
  /** Bar color. Defaults to amber. */
  color?: string;
}

const BAR_COUNT = 32;

export function Waveform({ stream, height = 56, className, color = "#f5a623" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Lazy-create AudioContext (Safari requires user-gesture; the caller
    // already tapped the mic button, so we're inside that gesture).
    const AudioCtx =
      (window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext) ?? null;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    const buf = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      analyser.getByteFrequencyData(buf);

      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = height;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
      }
      const g = canvas.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / BAR_COUNT) * 0.6;
      const gap = (canvas.width / BAR_COUNT) * 0.4;
      // Bucket FFT bins down to BAR_COUNT bars (drop the highest, mostly noise).
      const usableBins = Math.min(buf.length - 4, BAR_COUNT * 2);
      const binsPerBar = Math.max(1, Math.floor(usableBins / BAR_COUNT));

      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        for (let j = 0; j < binsPerBar; j++) sum += buf[i * binsPerBar + j];
        const avg = sum / binsPerBar / 255; // 0..1
        // Boost the low end for visual punch — speech sits mostly under 1kHz.
        const amp = Math.pow(avg, 0.7);
        const barH = Math.max(2 * dpr, amp * canvas.height);
        const x = i * (barWidth + gap) + gap / 2;
        const y = (canvas.height - barH) / 2;
        g.fillStyle = color;
        g.fillRect(x, y, barWidth, barH);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try {
        source.disconnect();
      } catch {
        // ignore
      }
      ctx.close().catch(() => {
        // ignore
      });
    };
  }, [stream, height, color]);

  if (!stream) return null;
  return (
    <div className={className} style={{ height }}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
