"use client";

/**
 * CognitiveOrb — animated header indicator that visualizes the user's
 * cognitive load score as a living, breathing orb.
 *
 * Visual behavior:
 * - Zen (0–0.2): Slow pulse, cool cyan glow, large ring — relaxed.
 * - Normal (0.2–0.5): Moderate pulse, indigo glow — attentive.
 * - Focus (0.5–0.7): Faster pulse, amber glow, tighter ring — concentrating.
 * - Panic (0.7–1.0): Rapid pulse, red glow, pulsing ring — overloaded.
 *
 * The orb uses pure CSS animations with CSS custom properties driven
 * by the loadScore for smooth, GPU-accelerated transitions. The
 * sparkline shows the last ~30s of score history as a tiny SVG path.
 */

import { useMemo } from "react";
import {
  useCognitiveLoadContext,
  MODE_LABELS,
  MODE_COLORS,
} from "./CognitiveLoadProvider";

// ─── Sparkline ───────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const width = 80;
  const height = 24;
  const padding = 2;

  const path = useMemo(() => {
    if (data.length < 2) return "";
    const usable = data.slice(-40); // max 40 points
    const step = (width - padding * 2) / (usable.length - 1);
    return usable
      .map((v, i) => {
        const x = padding + i * step;
        const y = padding + (1 - v) * (height - padding * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [data]);

  if (data.length < 2) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="opacity-70"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Orb ─────────────────────────────────────────────────────────────

export function CognitiveOrb({ className = "" }: { className?: string }) {
  const { loadScore, mode, history } = useCognitiveLoadContext();

  const color = MODE_COLORS[mode];
  const label = MODE_LABELS[mode];

  // Animation speed: faster pulse at higher load
  const pulseDuration = mode === "panic"
    ? "0.8s"
    : mode === "focus"
      ? "1.5s"
      : mode === "normal"
        ? "2.5s"
        : "4s";

  // Ring size: tighter at higher load
  const ringScale = mode === "panic" ? 1.8 : mode === "focus" ? 2.0 : 2.4;

  // Score percentage for the arc
  const pct = Math.round(loadScore * 100);

  return (
    <div
      className={`morphos-orb-container ${className}`}
      role="status"
      aria-label={`Cognitive load: ${pct}% — ${label} mode`}
    >
      {/* Outer glow ring */}
      <div
        className="morphos-orb-ring"
        style={{
          "--orb-color": color,
          "--orb-pulse-duration": pulseDuration,
          "--orb-ring-scale": ringScale,
        } as React.CSSProperties}
      />

      {/* Core orb */}
      <div
        className="morphos-orb-core"
        style={{
          "--orb-color": color,
          "--orb-pulse-duration": pulseDuration,
        } as React.CSSProperties}
      >
        {/* Score arc (SVG ring) */}
        <svg
          viewBox="0 0 36 36"
          className="morphos-orb-arc"
          aria-hidden="true"
        >
          {/* Background ring */}
          <circle
            cx="18"
            cy="18"
            r="15.9"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="2"
          />
          {/* Score arc */}
          <circle
            cx="18"
            cy="18"
            r="15.9"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${loadScore * 100}, 100`}
            transform="rotate(-90 18 18)"
            style={{ transition: "stroke-dasharray 0.5s ease, stroke 0.5s ease" }}
          />
        </svg>

        {/* Inner content */}
        <div className="morphos-orb-inner">
          <span className="morphos-orb-score">{pct}</span>
        </div>
      </div>

      {/* Label + sparkline */}
      <div className="morphos-orb-meta">
        <span
          className="morphos-orb-label"
          style={{ color }}
        >
          {label}
        </span>
        <Sparkline data={history} color={color} />
      </div>
    </div>
  );
}

// ─── Debug overlay (optional) ────────────────────────────────────────

export function CognitiveLoadDebug() {
  const { loadScore, mode, rawMode, history } = useCognitiveLoadContext();
  const color = MODE_COLORS[mode];

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        zIndex: 9999,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${color}`,
        borderRadius: 12,
        padding: "12px 16px",
        fontFamily: "monospace",
        fontSize: 11,
        color: "#e2e8f0",
        lineHeight: 1.6,
        minWidth: 200,
        pointerEvents: "none",
      }}
    >
      <div style={{ color, fontWeight: 700, marginBottom: 4 }}>
        ◉ Cognitive Load Monitor
      </div>
      <div>
        Score: <strong>{(loadScore * 100).toFixed(1)}%</strong>
      </div>
      <div>
        Mode: <strong style={{ color }}>{mode}</strong>
        {rawMode !== mode && (
          <span style={{ opacity: 0.5 }}> (raw: {rawMode})</span>
        )}
      </div>
      <div>Samples: {history.length}</div>
      <div style={{ marginTop: 6 }}>
        <Sparkline data={history} color={color} />
      </div>
    </div>
  );
}
