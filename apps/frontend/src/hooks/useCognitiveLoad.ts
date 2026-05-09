/**
 * useCognitiveLoad — real-time cognitive load estimation from interaction signals.
 *
 * Tracks four input channels:
 *   1. Click frequency   (clicks per 5-second sliding window)
 *   2. Scroll velocity   (pixels/second, absolute delta)
 *   3. Keydown rate      (keystrokes per 5-second sliding window)
 *   4. Mouse velocity    (pixels/second, sampled every 100ms)
 *
 * These are normalized, weighted, and smoothed via an exponential moving
 * average to produce a single `loadScore` in [0, 1].
 *
 * A hysteresis buffer prevents jitter: the mode only changes if the
 * score has remained in a new mode's band for `HYSTERESIS_MS` (1500ms).
 *
 * The hook is designed to be called once at the app root and the result
 * distributed via React context (see CognitiveLoadProvider).
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Mode bands ──────────────────────────────────────────────────────
export type CognitiveMode = "zen" | "normal" | "focus" | "panic";

function scoreToMode(score: number): CognitiveMode {
  if (score <= 0.2) return "zen";
  if (score <= 0.5) return "normal";
  if (score <= 0.7) return "focus";
  return "panic";
}

// ─── Constants ───────────────────────────────────────────────────────
const TICK_MS = 500; // score recalculated every 500ms
const DECAY = 0.92; // exponential decay per tick when no new input
const WINDOW_MS = 5_000; // sliding window for event counters
const MOUSE_SAMPLE_MS = 100; // mouse move debounce
const HYSTERESIS_MS = 1_500; // mode must hold for 1.5s before switching
const HISTORY_LEN = 60; // keep last 60 ticks (~30s) of score history

// Normalization ceilings — values above these map to 1.0
const MAX_CLICK_RATE = 8; // clicks per 5s window
const MAX_SCROLL_VEL = 3_000; // px/s
const MAX_KEY_RATE = 15; // keys per 5s window
const MAX_MOUSE_VEL = 2_000; // px/s

// Weights (must sum to 1.0)
const W_CLICK = 0.3;
const W_SCROLL = 0.25;
const W_KEY = 0.25;
const W_MOUSE = 0.2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function normalize(v: number, max: number): number {
  return clamp(v / max, 0, 1);
}

// Trim events outside the sliding window
function trimWindow(events: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  const idx = events.findIndex((t) => t >= cutoff);
  return idx <= 0 ? events : events.slice(idx);
}

// ─── Return type ─────────────────────────────────────────────────────
export interface CognitiveLoadState {
  /** Raw score in [0, 1]. 0 = idle, 1 = max cognitive load. */
  loadScore: number;
  /** Discretized mode with hysteresis applied. */
  mode: CognitiveMode;
  /** The mode the raw score maps to RIGHT NOW (no hysteresis). */
  rawMode: CognitiveMode;
  /** Rolling history of scores (most recent last). */
  history: number[];
}

// ─── Hook ────────────────────────────────────────────────────────────
export function useCognitiveLoad(): CognitiveLoadState {
  // Output state
  const [loadScore, setLoadScore] = useState(0);
  const [mode, setMode] = useState<CognitiveMode>("zen");
  const [history, setHistory] = useState<number[]>([]);

  // Mutable refs for the tick loop — never cause re-renders on their own
  const clickTimestamps = useRef<number[]>([]);
  const keyTimestamps = useRef<number[]>([]);
  const scrollVelocity = useRef(0);
  const mouseVelocity = useRef(0);

  // For scroll velocity calc
  const lastScrollY = useRef(0);
  const lastScrollTime = useRef(0);

  // For mouse velocity calc
  const lastMouseX = useRef(0);
  const lastMouseY = useRef(0);
  const lastMouseTime = useRef(0);

  // Smoothed score (EMA)
  const smoothedScore = useRef(0);

  // Hysteresis: track when the raw mode last changed
  const pendingMode = useRef<CognitiveMode>("zen");
  const pendingModeStart = useRef(0);
  const confirmedMode = useRef<CognitiveMode>("zen");

  // ── Event handlers ─────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    clickTimestamps.current.push(performance.now());
  }, []);

  const handleKeyDown = useCallback(() => {
    keyTimestamps.current.push(performance.now());
  }, []);

  const handleScroll = useCallback(() => {
    const now = performance.now();
    const y = window.scrollY;
    const dt = (now - lastScrollTime.current) / 1000; // seconds
    if (dt > 0 && lastScrollTime.current > 0) {
      scrollVelocity.current = Math.abs(y - lastScrollY.current) / dt;
    }
    lastScrollY.current = y;
    lastScrollTime.current = now;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const now = performance.now();
    const dt = now - lastMouseTime.current;
    if (dt < MOUSE_SAMPLE_MS) return; // throttle
    if (lastMouseTime.current > 0) {
      const dx = e.clientX - lastMouseX.current;
      const dy = e.clientY - lastMouseY.current;
      const dist = Math.sqrt(dx * dx + dy * dy);
      mouseVelocity.current = dist / (dt / 1000);
    }
    lastMouseX.current = e.clientX;
    lastMouseY.current = e.clientY;
    lastMouseTime.current = now;
  }, []);

  // ── Tick loop ──────────────────────────────────────────────────────
  useEffect(() => {
    // Bind listeners
    window.addEventListener("click", handleClick, { passive: true });
    window.addEventListener("keydown", handleKeyDown, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    const interval = setInterval(() => {
      const now = performance.now();

      // 1. Trim sliding windows
      clickTimestamps.current = trimWindow(clickTimestamps.current, now);
      keyTimestamps.current = trimWindow(keyTimestamps.current, now);

      // 2. Compute raw channel values
      const clickRate = clickTimestamps.current.length; // events in window
      const keyRate = keyTimestamps.current.length;
      const sv = scrollVelocity.current;
      const mv = mouseVelocity.current;

      // 3. Normalize
      const nClick = normalize(clickRate, MAX_CLICK_RATE);
      const nScroll = normalize(sv, MAX_SCROLL_VEL);
      const nKey = normalize(keyRate, MAX_KEY_RATE);
      const nMouse = normalize(mv, MAX_MOUSE_VEL);

      // 4. Weighted sum → raw instant score
      const rawScore =
        W_CLICK * nClick + W_SCROLL * nScroll + W_KEY * nKey + W_MOUSE * nMouse;

      // 5. Exponential moving average (smooth + decay)
      const prev = smoothedScore.current;
      const ema = rawScore > prev
        ? prev + (1 - DECAY) * (rawScore - prev) // rise: follow faster
        : prev * DECAY; // fall: decay gently
      smoothedScore.current = clamp(ema, 0, 1);

      // 6. Decay velocity refs toward 0 (they only get set on events)
      scrollVelocity.current *= 0.8;
      mouseVelocity.current *= 0.8;

      // 7. Hysteresis for mode
      const rawMode = scoreToMode(smoothedScore.current);
      if (rawMode !== pendingMode.current) {
        pendingMode.current = rawMode;
        pendingModeStart.current = now;
      }
      if (
        rawMode !== confirmedMode.current &&
        now - pendingModeStart.current >= HYSTERESIS_MS
      ) {
        confirmedMode.current = rawMode;
        setMode(rawMode);
      }

      // 8. Push to React state
      setLoadScore(smoothedScore.current);
      setHistory((prev) => {
        const next = [...prev, smoothedScore.current];
        return next.length > HISTORY_LEN ? next.slice(-HISTORY_LEN) : next;
      });
    }, TICK_MS);

    return () => {
      clearInterval(interval);
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [handleClick, handleKeyDown, handleScroll, handleMouseMove]);

  return {
    loadScore,
    mode,
    rawMode: scoreToMode(loadScore),
    history,
  };
}
