"use client";

/**
 * ActionCard — adaptive service action card.
 *
 * Panic Mode (loadScore > 0.7):
 *   Large summary card with service name, status icon (color-coded),
 *   and a single "Fix" button. No detail, no config.
 *
 * Expert Mode (loadScore < 0.3):
 *   Full card with raw config JSON, all metrics inline, alerts list,
 *   and granular action controls (restart, scale, rollback, etc.).
 *
 * Transition: Smooth height/opacity animation via motion.
 */

import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Server,
  Shield,
  XCircle,
  Zap,
  Database,
  Globe,
  Cpu,
} from "lucide-react";
import { useCognitiveLoadContext } from "./CognitiveLoadProvider";

// ─── Types ───────────────────────────────────────────────────────────

interface ServiceData {
  id: string;
  name: string;
  type?: string;
  status: string;
  cpu_pct?: number;
  memory_pct?: number;
  rps?: number;
  error_rate?: number;
  p99_latency_ms?: number;
  alert_count?: number;
  region?: string;
}

interface ActionCardProps {
  service: ServiceData;
  onFix?: (serviceId: string, action: string) => void;
  className?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  healthy: {
    icon: CheckCircle2,
    color: "#22c55e",
    bg: "rgba(34, 197, 94, 0.1)",
    border: "rgba(34, 197, 94, 0.2)",
    label: "Healthy",
  },
  degraded: {
    icon: AlertTriangle,
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.1)",
    border: "rgba(245, 158, 11, 0.2)",
    label: "Degraded",
  },
  critical: {
    icon: XCircle,
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.1)",
    border: "rgba(239, 68, 68, 0.2)",
    label: "Critical",
  },
} as const;

const TYPE_ICONS: Record<string, typeof Server> = {
  gateway: Globe,
  microservice: Shield,
  database: Database,
  cache: Zap,
  pipeline: Cpu,
};

const FIX_ACTIONS = [
  { id: "restart", label: "Restart", icon: RefreshCw },
  { id: "scale_up", label: "Scale Up", icon: Activity },
  { id: "rollback", label: "Rollback", icon: ChevronDown },
];

// ─── Component ───────────────────────────────────────────────────────

export function ActionCard({ service, onFix, className = "" }: ActionCardProps) {
  const { mode } = useCognitiveLoadContext();
  const isPanic = mode === "panic";
  const isExpert = mode === "zen";

  const statusConfig = STATUS_CONFIG[service.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.healthy;
  const StatusIcon = statusConfig.icon;
  const TypeIcon = TYPE_ICONS[service.type || ""] || Server;

  const metricBars = useMemo(() => {
    if (isPanic) return null;
    return [
      { label: "CPU", value: service.cpu_pct ?? 0, max: 100, unit: "%" },
      { label: "MEM", value: service.memory_pct ?? 0, max: 100, unit: "%" },
      { label: "RPS", value: service.rps ?? 0, max: 30000, unit: "" },
      { label: "ERR", value: service.error_rate ?? 0, max: 15, unit: "%" },
      { label: "P99", value: service.p99_latency_ms ?? 0, max: 5000, unit: "ms" },
    ];
  }, [isPanic, service]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className={`morphos-glass morphos-transition ${className}`}
      style={{
        padding: isPanic ? "20px 24px" : "16px 20px",
        borderColor: statusConfig.border,
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center rounded-lg morphos-transition"
            style={{
              width: isPanic ? 48 : 36,
              height: isPanic ? 48 : 36,
              background: statusConfig.bg,
            }}
          >
            <TypeIcon
              size={isPanic ? 24 : 18}
              style={{ color: statusConfig.color }}
            />
          </div>
          <div>
            <h3
              className="font-semibold text-foreground morphos-transition"
              style={{ fontSize: isPanic ? 18 : 14 }}
            >
              {service.name}
            </h3>
            {!isPanic && (
              <p className="text-xs text-muted-foreground">
                {service.region} · {service.type}
              </p>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div
          className="flex items-center gap-1.5 rounded-full px-3 py-1 morphos-transition"
          style={{
            background: statusConfig.bg,
            border: `1px solid ${statusConfig.border}`,
            fontSize: isPanic ? 14 : 11,
          }}
        >
          <StatusIcon size={isPanic ? 16 : 12} style={{ color: statusConfig.color }} />
          <span style={{ color: statusConfig.color, fontWeight: 600 }}>
            {statusConfig.label}
          </span>
        </div>
      </div>

      {/* Expert metrics grid */}
      <AnimatePresence mode="wait">
        {!isPanic && metricBars && (
          <motion.div
            key="metrics"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-5 gap-2 mb-3">
              {metricBars.map((m) => {
                const pct = Math.min((m.value / m.max) * 100, 100);
                const barColor =
                  pct > 80
                    ? "#ef4444"
                    : pct > 60
                      ? "#f59e0b"
                      : "#22c55e";
                return (
                  <div key={m.label} className="text-center">
                    <div className="text-[10px] text-muted-foreground mb-1 font-mono">
                      {m.label}
                    </div>
                    <div className="text-xs font-semibold text-foreground">
                      {typeof m.value === "number" ? m.value.toFixed(1) : m.value}
                      <span className="text-muted-foreground text-[10px]">{m.unit}</span>
                    </div>
                    <div
                      className="h-1 rounded-full mt-1"
                      style={{ background: "rgba(255,255,255,0.06)" }}
                    >
                      <div
                        className="h-1 rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: barColor,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Alert count (expert) */}
      {isExpert && (service.alert_count ?? 0) > 0 && (
        <div
          className="text-xs px-3 py-1.5 rounded-md mb-3 font-mono"
          style={{
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.15)",
            color: "#fca5a5",
          }}
        >
          ⚠ {service.alert_count} active alert{(service.alert_count ?? 0) > 1 ? "s" : ""}
        </div>
      )}

      {/* Action buttons */}
      {service.status !== "healthy" && (
        <div
          className="flex gap-2 morphos-transition"
          style={{ justifyContent: isPanic ? "center" : "flex-start" }}
        >
          {isPanic ? (
            // Panic: single big Fix button
            <button
              onClick={() => onFix?.(service.id, "restart")}
              className="flex items-center gap-2 rounded-lg font-semibold morphos-transition"
              style={{
                padding: "12px 32px",
                fontSize: 16,
                background: statusConfig.color,
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={18} />
              Fix Now
            </button>
          ) : (
            // Expert: granular actions
            FIX_ACTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onFix?.(service.id, id)}
                className="flex items-center gap-1.5 rounded-md text-xs font-medium hover:opacity-80 transition-opacity"
                style={{
                  padding: "6px 12px",
                  background: "rgba(99, 102, 241, 0.1)",
                  border: "1px solid rgba(99, 102, 241, 0.2)",
                  color: "#a5b4fc",
                  cursor: "pointer",
                }}
              >
                <Icon size={12} />
                {label}
              </button>
            ))
          )}
        </div>
      )}
    </motion.div>
  );
}
