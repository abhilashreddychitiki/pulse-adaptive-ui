"use client";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useCognitiveLoadContext } from "./CognitiveLoadProvider";

interface ServiceNode {
  id: string; name: string; type?: string; status: string;
  cpu_pct?: number; memory_pct?: number; rps?: number;
  error_rate?: number; p99_latency_ms?: number; alert_count?: number;
}

interface SystemStatusProps {
  services: ServiceNode[];
  onSelectService?: (id: string) => void;
  className?: string;
}

const STATUS_ICON = { healthy: CheckCircle2, degraded: AlertTriangle, critical: XCircle } as const;
const STATUS_CLR = { healthy: "#22c55e", degraded: "#f59e0b", critical: "#ef4444" } as const;

// Dependency map for topology lines
const DEPS: Record<string, string[]> = {
  "api-gw": ["auth-svc", "cache-layer"],
  "auth-svc": ["db-cluster", "cache-layer"],
  "ml-pipeline": ["db-cluster", "cache-layer"],
};

export function SystemStatus({ services, onSelectService, className = "" }: SystemStatusProps) {
  const { mode } = useCognitiveLoadContext();
  const isPanic = mode === "panic";

  const healthy = services.filter((s) => s.status === "healthy").length;
  const total = services.length;

  const overallColor = services.some((s) => s.status === "critical")
    ? "#ef4444" : services.some((s) => s.status === "degraded")
    ? "#f59e0b" : "#22c55e";

  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
      className={`morphos-glass morphos-transition ${className}`} style={{ padding: isPanic ? "24px" : "16px 20px" }}>
      <h3 className="font-semibold text-foreground mb-3" style={{ fontSize: isPanic ? 16 : 13 }}>System Status</h3>

      <AnimatePresence mode="wait">
        {isPanic ? (
          /* ── Panic: simple summary ── */
          <motion.div key="simple" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center py-6 gap-3">
            <div className="font-bold" style={{ fontSize: 40, color: overallColor }}>
              {healthy}/{total}
            </div>
            <div className="text-muted-foreground" style={{ fontSize: 16 }}>
              services healthy
            </div>
            {services.filter((s) => s.status !== "healthy").map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm" style={{ color: STATUS_CLR[s.status as keyof typeof STATUS_CLR] || "#f59e0b" }}>
                {s.status === "critical" ? <XCircle size={14} /> : <AlertTriangle size={14} />}
                {s.name}
              </div>
            ))}
          </motion.div>
        ) : (
          /* ── Expert: topology grid ── */
          <motion.div key="topology" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* SVG dependency lines */}
            <div className="relative" style={{ minHeight: 200 }}>
              <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
                {/* Draw connection lines between dependent services */}
                {services.map((svc, i) => {
                  const deps = DEPS[svc.id] || [];
                  return deps.map((depId) => {
                    const j = services.findIndex((s) => s.id === depId);
                    if (j < 0) return null;
                    // Grid positions: 3 columns
                    const col1 = (i % 3) * 33 + 16; const row1 = Math.floor(i / 3) * 50 + 25;
                    const col2 = (j % 3) * 33 + 16; const row2 = Math.floor(j / 3) * 50 + 25;
                    return (
                      <line key={`${svc.id}-${depId}`}
                        x1={`${col1}%`} y1={`${row1}%`} x2={`${col2}%`} y2={`${row2}%`}
                        stroke="rgba(99,102,241,0.15)" strokeWidth={1} strokeDasharray="4 2" />
                    );
                  });
                })}
              </svg>

              {/* Service nodes grid */}
              <div className="relative grid grid-cols-3 gap-3" style={{ zIndex: 1 }}>
                {services.map((svc) => {
                  const Icon = STATUS_ICON[svc.status as keyof typeof STATUS_ICON] || CheckCircle2;
                  const clr = STATUS_CLR[svc.status as keyof typeof STATUS_CLR] || "#22c55e";
                  return (
                    <button key={svc.id} onClick={() => onSelectService?.(svc.id)}
                      className="flex flex-col items-center gap-1.5 rounded-xl p-3 transition-all hover:scale-105"
                      style={{
                        background: `${clr}08`, border: `1px solid ${clr}20`,
                        cursor: "pointer",
                      }}>
                      <Icon size={20} style={{ color: clr }} />
                      <span className="text-xs font-semibold text-foreground text-center leading-tight">{svc.name}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {svc.cpu_pct?.toFixed(0)}% · {svc.rps} rps
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Summary bar */}
            <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid rgba(99,102,241,0.1)" }}>
              <span className="text-xs text-muted-foreground">{healthy}/{total} healthy</span>
              <span className="text-xs font-mono" style={{ color: overallColor }}>
                {services.reduce((n, s) => n + (s.alert_count ?? 0), 0)} alerts
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
