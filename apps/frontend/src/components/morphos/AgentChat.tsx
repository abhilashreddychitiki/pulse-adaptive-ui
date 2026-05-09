"use client";
/**
 * AgentChat — load-aware sidebar wrapper. Adjusts CopilotSidebar
 * styling based on cognitive load mode.
 *
 * Panic: larger font, high-contrast, simplified pill suggestions.
 * Expert: compact font, code blocks, full tool-call cards.
 */
import { useMemo } from "react";
import { CopilotSidebar, useConfigureSuggestions } from "@copilotkit/react-core/v2";
import { useCognitiveLoadContext, MODE_COLORS } from "./CognitiveLoadProvider";

interface AgentChatProps { className?: string; }

export function AgentChat({ className = "" }: AgentChatProps) {
  const { mode, loadScore } = useCognitiveLoadContext();
  const isPanic = mode === "panic";
  const color = MODE_COLORS[mode];

    useConfigureSuggestions({
    available: "before-first-message",
    suggestions: isPanic
      ? [
          { title: "Fix everything", message: "Auto-fix all critical issues now." },
          { title: "Status", message: "What's broken?" },
        ]
      : [
          { title: "System status", message: "What's the current status of all services?" },
          { title: "Show metrics", message: "Show me the performance metrics for the API Gateway." },
          { title: "Fix issues", message: "Auto-fix any critical issues in the system." },
          { title: "Log incident", message: "Log the latest incident to Notion with an RCA." },
        ],
  });

  const sidebarStyle = useMemo(() => ({
    "--copilot-kit-primary-color": color,
    fontSize: isPanic ? "16px" : "13px",
  } as React.CSSProperties), [color, isPanic]);

  return (
    <div className={className} style={sidebarStyle}>
      <CopilotSidebar
        defaultOpen
        width={isPanic ? 380 : 420}
        input={{ disclaimer: () => null, className: "pb-6" }}
      />
    </div>
  );
}
