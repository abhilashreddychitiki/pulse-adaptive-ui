"use client";

/**
 * CognitiveLoadProvider — React context that distributes the cognitive load
 * score to all Morphos components and syncs it with the CopilotKit agent
 * via `useAgentContext`.
 *
 * Mount this once near the app root, inside the CopilotKitProvider tree.
 * Children read the load state via `useCognitiveLoadContext()`.
 */

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";

import {
  useCognitiveLoad,
  type CognitiveLoadState,
  type CognitiveMode,
} from "@/hooks/useCognitiveLoad";

// ─── Context ─────────────────────────────────────────────────────────

const CognitiveLoadContext = createContext<CognitiveLoadState>({
  loadScore: 0,
  mode: "zen",
  rawMode: "zen",
  history: [],
});

export function useCognitiveLoadContext(): CognitiveLoadState {
  return useContext(CognitiveLoadContext);
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Returns true when the UI should be in its "simplified" state. */
export function isPanicMode(mode: CognitiveMode): boolean {
  return mode === "panic";
}

/** Returns true when the UI should be in its "dense / expert" state. */
export function isExpertMode(mode: CognitiveMode): boolean {
  return mode === "zen";
}

// ─── Mode display helpers ────────────────────────────────────────────
export const MODE_LABELS: Record<CognitiveMode, string> = {
  zen: "Expert",
  normal: "Standard",
  focus: "Focused",
  panic: "Simplified",
};

export const MODE_COLORS: Record<CognitiveMode, string> = {
  zen: "#22d3ee",     // cyan-400
  normal: "#6366f1",  // indigo-500
  focus: "#f59e0b",   // amber-500
  panic: "#ef4444",   // red-500
};

// ─── Provider ────────────────────────────────────────────────────────

export function CognitiveLoadProvider({ children }: { children: ReactNode }) {
  const state = useCognitiveLoad();

  // Sync cognitive load to the agent so it can adapt its responses.
  // The agent sees this as readable application context.
  useAgentContext({
    description:
      "User cognitive load score (0 = idle/expert mode, 1 = panic mode). " +
      "Current mode and last 20 score samples. When loadScore > 0.7, " +
      "generate simplified, high-contrast, single-action UIs and keep " +
      "responses to ≤2 sentences. When loadScore < 0.3, generate dense, " +
      "data-rich UIs with charts and full technical detail.",
    value: {
      loadScore: Math.round(state.loadScore * 100) / 100,
      mode: state.mode,
      rawMode: state.rawMode,
      recentHistory: state.history.slice(-20).map((v) => Math.round(v * 100) / 100),
    },
  });

  return (
    <CognitiveLoadContext.Provider value={state}>
      {children}
    </CognitiveLoadContext.Provider>
  );
}
