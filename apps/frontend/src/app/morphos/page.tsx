"use client";
/**
 * Morphos — Cognitive-Load Aware UI (Phase 3: Full Dashboard)
 *
 * Registers all adaptive components as useFrontendTool handlers and
 * renders the adaptive dashboard grid that shifts layout based on the
 * user's cognitive load mode.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CopilotChatConfigurationProvider,
  CopilotSidebar,
  useAgent,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { Toaster } from "sonner";
import { ThreadsDrawer } from "@/components/threads-drawer";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";

import {
  CognitiveLoadProvider,
  useCognitiveLoadContext,
  MODE_COLORS,
} from "@/components/morphos/CognitiveLoadProvider";
import { CognitiveOrb, CognitiveLoadDebug } from "@/components/morphos/CognitiveOrb";
import { ActionCard } from "@/components/morphos/ActionCard";
import { MetricVisualizer } from "@/components/morphos/MetricVisualizer";
import { SystemStatus } from "@/components/morphos/SystemStatus";

import "./morphos.css";

// ─── State types ─────────────────────────────────────────────────────

interface ServiceSummary {
  id: string; name: string; type?: string; status: string;
  cpu_pct?: number; memory_pct?: number; rps?: number;
  error_rate?: number; p99_latency_ms?: number; alert_count?: number;
  region?: string;
}

interface MetricData {
  serviceId: string; serviceName: string; metric: string;
  current: number; status: string;
  data: { timestamp: string; value: number }[];
}

interface LogData {
  serviceId: string; serviceName: string;
  logs: { timestamp: string; level: string; category: string; message: string }[];
  errorCount: number; warnCount: number;
}

interface TerminalData {
  command: string; output: string; timestamp: string; exitCode: number;
}

interface MorphosState {
  services: ServiceSummary[];
  currentMetrics: MetricData | null;
  serviceLogs: LogData | null;
  terminalOutput: TerminalData | null;
  header: { title: string; subtitle: string };
}

const defaultState: MorphosState = {
  services: [],
  currentMetrics: null,
  serviceLogs: null,
  terminalOutput: null,
  header: { title: "Infrastructure Dashboard", subtitle: "Connecting to services..." },
};

// ─── Header ──────────────────────────────────────────────────────────

function MorphosHeader() {
  return (
    <header className="morphos-header morphos-transition">
      <div className="morphos-header-title">
        <div>
          <h1>Morphos</h1>
          <p className="morphos-subtitle">Cognitive-Load Aware Infrastructure</p>
        </div>
      </div>
      <CognitiveOrb />
    </header>
  );
}

// ─── Log Viewer Component ────────────────────────────────────────────

function LogViewer({ data }: { data: LogData }) {
  const { mode } = useCognitiveLoadContext();
  const isPanic = mode === "panic";

  const levelColor: Record<string, string> = {
    CRITICAL: "#ef4444", ERROR: "#f87171", WARN: "#f59e0b", INFO: "#22d3ee",
  };

  if (isPanic) {
    return (
      <div className="morphos-glass p-5 morphos-transition">
        <h3 className="font-semibold text-foreground mb-2" style={{ fontSize: 16 }}>{data.serviceName} Logs</h3>
        <div className="font-bold" style={{ fontSize: 24, color: data.errorCount > 0 ? "#ef4444" : "#22c55e" }}>
          {data.errorCount} errors
        </div>
        <p className="text-muted-foreground text-sm">{data.warnCount} warnings in {data.logs.length} lines</p>
      </div>
    );
  }

  return (
    <div className="morphos-glass p-4 morphos-transition">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">{data.serviceName} Logs</h3>
        <span className="text-xs font-mono text-muted-foreground">{data.logs.length} lines · {data.errorCount} err</span>
      </div>
      <div className="max-h-60 overflow-y-auto rounded-lg" style={{ background: "rgba(0,0,0,0.3)", padding: "8px 12px" }}>
        {data.logs.map((log, i) => (
          <div key={i} className="font-mono text-[11px] leading-relaxed flex gap-2">
            <span className="text-muted-foreground shrink-0" style={{ width: 50 }}>
              {new Date(log.timestamp).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className="shrink-0 font-bold" style={{ color: levelColor[log.level] || "#94a3b8", width: 32 }}>
              {log.level.slice(0, 4)}
            </span>
            <span className="text-foreground opacity-80">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Terminal Component ──────────────────────────────────────────────

function TerminalViewer({ data }: { data: TerminalData }) {
  return (
    <div className="morphos-glass p-4 morphos-transition">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#ef4444" }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#f59e0b" }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#22c55e" }} />
        </div>
        <span className="text-xs font-mono text-muted-foreground ml-2">terminal</span>
      </div>
      <div className="rounded-lg font-mono text-xs" style={{ background: "rgba(0,0,0,0.4)", padding: "12px 16px" }}>
        <div className="text-muted-foreground mb-2">$ {data.command}</div>
        <pre className="text-foreground opacity-80 whitespace-pre-wrap">{data.output}</pre>
        <div className="mt-2 text-muted-foreground text-[10px]">exit: {data.exitCode}</div>
      </div>
    </div>
  );
}

// ─── Dashboard Grid ──────────────────────────────────────────────────

function DashboardGrid({ state }: { state: MorphosState }) {
  const { mode } = useCognitiveLoadContext();
  const isPanic = mode === "panic";

  if (state.services.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="morphos-glass p-12 text-center max-w-lg">
          <div className="text-5xl mb-4">🧠</div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Sensory Layer Active</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Ask the agent about system status to populate the dashboard.
            Try clicking rapidly or scrolling to see the UI adapt.
          </p>
        </div>
      </div>
    );
  }

  const unhealthy = state.services.filter((s) => s.status !== "healthy");

  return (
    <div className={`flex-1 overflow-y-auto pr-1 morphos-transition ${isPanic ? "space-y-4" : "space-y-3"}`}>
      {/* System overview */}
      <SystemStatus services={state.services} />

      {/* Action cards for unhealthy services */}
      {unhealthy.length > 0 && (
        <div className={isPanic ? "space-y-4" : "grid grid-cols-2 gap-3"}>
          {unhealthy.map((svc) => (
            <ActionCard key={svc.id} service={svc} />
          ))}
        </div>
      )}

      {/* Metric visualizer */}
      {state.currentMetrics && (
        <MetricVisualizer
          serviceId={state.currentMetrics.serviceId}
          serviceName={state.currentMetrics.serviceName}
          metric={state.currentMetrics.metric}
          current={state.currentMetrics.current}
          status={state.currentMetrics.status}
          data={state.currentMetrics.data}
        />
      )}

      {/* Log viewer */}
      {state.serviceLogs && <LogViewer data={state.serviceLogs} />}

      {/* Terminal */}
      {state.terminalOutput && <TerminalViewer data={state.terminalOutput} />}
    </div>
  );
}

// ─── Canvas (tool registration + layout) ─────────────────────────────

function MorphosCanvas() {
  const { mode } = useCognitiveLoadContext();
  const { agent } = useAgent();

  // Derive state from agent
  const raw = agent?.state as Record<string, any> | undefined;
  const state: MorphosState = {
    services: (raw?.services as ServiceSummary[]) ?? [],
    currentMetrics: (raw?.currentMetrics as MetricData) ?? null,
    serviceLogs: (raw?.serviceLogs as LogData) ?? null,
    terminalOutput: (raw?.terminalOutput as TerminalData) ?? null,
    header: {
      title: (raw?.header as any)?.title ?? defaultState.header.title,
      subtitle: (raw?.header as any)?.subtitle ?? defaultState.header.subtitle,
    },
  };

  const updateState = useCallback(
    (updater: (prev: any) => any) => {
      agent?.setState(updater(raw ?? {}));
    },
    [agent, raw],
  );

  // ── Frontend tool registrations ──────────────────────────────────
  useFrontendTool({
    name: "setHeader",
    description: "Set the workspace header (title and subtitle).",
    parameters: z.object({ title: z.string().optional(), subtitle: z.string().optional() }),
    handler: async ({ title, subtitle }) => {
      updateState((p: any) => ({ ...p, header: { title: title ?? p.header?.title, subtitle: subtitle ?? p.header?.subtitle } }));
      return "header updated";
    },
  });

  useFrontendTool({
    name: "renderActionCard",
    description: "Render an adaptive action card for a service. In panic mode shows a single Fix button; in expert mode shows full config.",
    parameters: z.object({
      serviceId: z.string(), serviceName: z.string(), status: z.string(),
      action: z.string().optional(), config: z.record(z.any()).optional(),
    }),
    handler: async () => "action card rendered on canvas",
  });

  useFrontendTool({
    name: "renderMetricVisualizer",
    description: "Render an adaptive metric chart. In panic mode shows a traffic light; in expert mode shows a Recharts line chart.",
    parameters: z.object({
      serviceId: z.string(), metric: z.string(),
      data: z.array(z.object({ timestamp: z.string(), value: z.number() })).optional(),
      status: z.string().optional(),
    }),
    handler: async () => "metric visualizer rendered on canvas",
  });

  useFrontendTool({
    name: "renderSystemStatus",
    description: "Render the system topology. In panic mode shows '3/5 healthy'; in expert mode shows an interactive dependency graph.",
    parameters: z.object({ services: z.array(z.any()).optional() }),
    handler: async () => "system status rendered on canvas",
  });

  useFrontendTool({
    name: "renderLogViewer",
    description: "Render a scrollable log viewer with syntax highlighting.",
    parameters: z.object({
      serviceId: z.string(),
      logs: z.array(z.object({ timestamp: z.string(), level: z.string(), category: z.string(), message: z.string() })).optional(),
      errorCount: z.number().optional(), warnCount: z.number().optional(),
    }),
    handler: async () => "log viewer rendered on canvas",
  });

  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: mode === "panic"
      ? [
          { title: "Fix everything", message: "Auto-fix all critical issues now." },
          { title: "Status", message: "What's broken?" },
        ]
      : [
          { title: "System status", message: "What's the current status of all services?" },
          { title: "Show metrics", message: "Show me the performance metrics for the API Gateway." },
          { title: "Fix issues", message: "Auto-fix any critical issues in the system." },
          { title: "Service logs", message: "Show me the recent logs for the database cluster." },
        ],
  });

  return (
    <>
      <main className={`morphos-theme flex h-screen flex-col gap-4 overflow-hidden px-6 py-5 morphos-mode-${mode}`}>
        <MorphosHeader />
        {/* Subtitle bar */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{state.header.title}</h2>
            <p className="text-xs text-muted-foreground">{state.header.subtitle}</p>
          </div>
          {state.services.length > 0 && (
            <div className="text-xs font-mono text-muted-foreground">
              {state.services.filter((s) => s.status === "healthy").length}/{state.services.length} healthy
            </div>
          )}
        </div>
        <DashboardGrid state={state} />
      </main>

      <CopilotSidebar
        defaultOpen
        width={mode === "panic" ? 380 : 420}
        input={{ disclaimer: () => null, className: "pb-6" }}
      />

      <CognitiveLoadDebug />

      <Toaster position="bottom-right" toastOptions={{ classNames: { error: "!bg-rose-950 !text-rose-200 !border !border-rose-800" } }} />
    </>
  );
}

// ─── Page shell ──────────────────────────────────────────────────────

function MorphosPage() {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  return (
    <div className={drawerStyles.layout}>
      <ThreadsDrawer agentId="default" threadId={threadId} onThreadChange={setThreadId} />
      <div className={drawerStyles.mainPanel}>
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <CognitiveLoadProvider>
            <MorphosCanvas />
          </CognitiveLoadProvider>
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

function ClientOnlyWrapper({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

export default function Page() {
  return <ClientOnlyWrapper><MorphosPage /></ClientOnlyWrapper>;
}
