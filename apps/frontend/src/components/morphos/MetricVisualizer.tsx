"use client";
import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useCognitiveLoadContext } from "./CognitiveLoadProvider";

interface MetricDataPoint { timestamp: string; value: number; }

interface MetricVisualizerProps {
  serviceId: string; serviceName: string; metric: string;
  current: number; status: string; data: MetricDataPoint[];
  className?: string;
}

const METRIC_CFG: Record<string, { unit: string; warn: number; crit: number; color: string }> = {
  cpu: { unit: "%", warn: 70, crit: 90, color: "#6366f1" },
  memory: { unit: "%", warn: 75, crit: 90, color: "#8b5cf6" },
  rps: { unit: " req/s", warn: 20000, crit: 30000, color: "#22d3ee" },
  error_rate: { unit: "%", warn: 2, crit: 5, color: "#ef4444" },
  latency: { unit: "ms", warn: 200, crit: 1000, color: "#f59e0b" },
};

function trafficLight(status: string, val: number, metric: string) {
  const c = METRIC_CFG[metric] ?? METRIC_CFG.cpu;
  if (status === "critical" || val >= c.crit) return { color: "#ef4444", glow: "rgba(239,68,68,0.4)", label: "Critical" };
  if (status === "degraded" || val >= c.warn) return { color: "#f59e0b", glow: "rgba(245,158,11,0.3)", label: "Warning" };
  return { color: "#22c55e", glow: "rgba(34,197,94,0.3)", label: "OK" };
}

export function MetricVisualizer({ serviceId, serviceName, metric, current, status, data, className = "" }: MetricVisualizerProps) {
  const { mode } = useCognitiveLoadContext();
  const isPanic = mode === "panic";
  const c = METRIC_CFG[metric] ?? METRIC_CFG.cpu;
  const tl = trafficLight(status, current, metric);

  const chartData = useMemo(() => data.map((d) => {
    const dt = new Date(d.timestamp);
    return { time: `${dt.getHours().toString().padStart(2,"0")}:${dt.getMinutes().toString().padStart(2,"0")}`, value: d.value };
  }), [data]);

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}
      className={`morphos-glass morphos-transition ${className}`} style={{ padding: isPanic ? "24px" : "16px 20px" }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-foreground" style={{ fontSize: isPanic ? 16 : 13 }}>{serviceName}</h3>
          <p className="text-muted-foreground" style={{ fontSize: isPanic ? 13 : 11 }}>{metric.replace("_"," ").toUpperCase()}</p>
        </div>
        <div className="rounded-lg font-mono font-bold" style={{ padding: isPanic ? "8px 16px" : "4px 10px", fontSize: isPanic ? 22 : 14, background: `${tl.color}15`, border: `1px solid ${tl.color}30`, color: tl.color }}>
          {current.toFixed(1)}<span className="text-muted-foreground" style={{ fontSize: isPanic ? 14 : 10 }}>{c.unit}</span>
        </div>
      </div>
      <AnimatePresence mode="wait">
        {isPanic ? (
          <motion.div key="tl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-4">
            <div className="rounded-full" style={{ width: 72, height: 72, background: tl.color, boxShadow: `0 0 24px ${tl.glow}, 0 0 48px ${tl.glow}`, animation: status === "critical" ? "morphos-orb-breathe 0.8s ease-in-out infinite" : "none" }} />
            <span className="mt-3 font-bold" style={{ fontSize: 20, color: tl.color }}>{tl.label}</span>
          </motion.div>
        ) : (
          <motion.div key="chart" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 180 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4 }}>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs><linearGradient id={`g-${serviceId}-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={c.color} stopOpacity={0.3} /><stop offset="95%" stopColor={c.color} stopOpacity={0.02} /></linearGradient></defs>
                <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "rgba(99,102,241,0.1)" }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "rgba(15,15,35,0.95)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, fontSize: 12, color: "#e2e8f0" }} />
                <ReferenceLine y={c.warn} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.4} />
                <ReferenceLine y={c.crit} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.4} />
                <Area type="monotone" dataKey="value" stroke={c.color} strokeWidth={2} fill={`url(#g-${serviceId}-${metric})`} dot={false} activeDot={{ r: 4, fill: c.color, stroke: "#0a0a1a", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
