import { MCPServer, text, widget } from "mcp-use/server";
import { z } from "zod";

// ─── Mock Infrastructure Data ────────────────────────────────────────

interface Service {
  id: string; name: string; type: string; status: string;
  uptime_hours: number; cpu_pct: number; memory_pct: number;
  rps: number; error_rate: number; p99_latency_ms: number;
  dependencies: string[]; region: string; version: string;
  alerts: { severity: string; message: string; since: string }[];
}

const SERVICES: Service[] = [
  {
    id: "api-gw", name: "API Gateway", type: "gateway", status: "healthy",
    uptime_hours: 720, cpu_pct: 34.2, memory_pct: 58.1, rps: 12450,
    error_rate: 0.02, p99_latency_ms: 45, dependencies: ["auth-svc", "cache-layer"],
    region: "us-east-1", version: "3.2.1", alerts: [],
  },
  {
    id: "auth-svc", name: "Auth Service", type: "microservice", status: "degraded",
    uptime_hours: 168, cpu_pct: 78.9, memory_pct: 82.3, rps: 4200,
    error_rate: 3.8, p99_latency_ms: 320, dependencies: ["db-cluster", "cache-layer"],
    region: "us-east-1", version: "2.1.0",
    alerts: [
      { severity: "warning", message: "High memory usage (>80%)", since: "2026-05-09T10:00:00Z" },
      { severity: "critical", message: "Error rate exceeds 3% threshold", since: "2026-05-09T14:30:00Z" },
    ],
  },
  {
    id: "db-cluster", name: "Database Cluster", type: "database", status: "healthy",
    uptime_hours: 2160, cpu_pct: 45.6, memory_pct: 67.4, rps: 8900,
    error_rate: 0.01, p99_latency_ms: 12, dependencies: [],
    region: "us-east-1", version: "16.2", alerts: [],
  },
  {
    id: "cache-layer", name: "Cache Layer", type: "cache", status: "healthy",
    uptime_hours: 1440, cpu_pct: 12.3, memory_pct: 71.2, rps: 28000,
    error_rate: 0.0, p99_latency_ms: 2, dependencies: [],
    region: "us-east-1", version: "7.4.0", alerts: [],
  },
  {
    id: "ml-pipeline", name: "ML Pipeline", type: "pipeline", status: "critical",
    uptime_hours: 2, cpu_pct: 95.1, memory_pct: 91.4, rps: 150,
    error_rate: 12.5, p99_latency_ms: 4500, dependencies: ["db-cluster", "cache-layer"],
    region: "us-west-2", version: "1.0.3",
    alerts: [
      { severity: "critical", message: "OOM kills — 14 restarts in last hour", since: "2026-05-09T13:00:00Z" },
      { severity: "critical", message: "Pipeline stalled: queue depth > 500", since: "2026-05-09T13:15:00Z" },
      { severity: "warning", message: "GPU utilization at 98%", since: "2026-05-09T12:30:00Z" },
    ],
  },
];

function getService(id: string) { return SERVICES.find((s) => s.id === id); }

function genMetrics(svc: Service, metric: string, hours: number) {
  const base: Record<string, number> = {
    cpu: svc.cpu_pct, memory: svc.memory_pct, rps: svc.rps,
    error_rate: svc.error_rate, latency: svc.p99_latency_ms,
  };
  const b = base[metric] ?? 50;
  const now = Date.now();
  return Array.from({ length: hours * 12 }, (_, i) => {
    const t = new Date(now - (hours * 60 - i * 5) * 60000);
    const noise = Math.sin(i * 0.3) * b * 0.1 + (Math.random() - 0.5) * b * 0.1;
    let val = Math.max(0, b + noise);
    if (svc.status !== "healthy" && i > hours * 12 - 12) val *= 1.3 + Math.random() * 0.3;
    return { timestamp: t.toISOString(), value: Math.round(val * 100) / 100 };
  });
}

// ─── MCP Server ──────────────────────────────────────────────────────

const server = new MCPServer({
  name: "morphos-mcp",
  title: "Morphos Infrastructure MCP",
  version: "1.0.0",
  description:
    "Morphos — Cognitive-Load Aware Infrastructure: system overview, service metrics, auto-fix, logs, and terminal widgets.",
  baseUrl: process.env.MCP_URL || "http://localhost:3011",
  favicon: "favicon.ico",
  websiteUrl: "https://mcp-use.com",
  icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["512x512"] }],
});

// ─── Tool 1: System Overview ─────────────────────────────────────────

server.tool(
  {
    name: "show-system-overview",
    description:
      "Render the infrastructure system overview — service topology with health status, dependency lines, and alert counts. Adapts between a simple health summary (panic mode) and an interactive topology grid (expert mode).",
    schema: z.object({}),
    widget: {
      name: "system-overview",
      invoking: "Scanning infrastructure…",
      invoked: "System overview ready",
    },
  },
  async () => {
    const healthy = SERVICES.filter((s) => s.status === "healthy").length;
    const total = SERVICES.length;
    const alerts = SERVICES.reduce((n, s) => n + s.alerts.length, 0);
    const services = SERVICES.map((s) => ({
      id: s.id, name: s.name, type: s.type, status: s.status,
      cpu_pct: s.cpu_pct, memory_pct: s.memory_pct, rps: s.rps,
      error_rate: s.error_rate, p99_latency_ms: s.p99_latency_ms,
      alert_count: s.alerts.length, region: s.region,
    }));
    return widget({
      props: { services, healthy, total, alerts },
      output: text(
        `System: ${healthy}/${total} healthy, ${alerts} active alerts. ` +
        SERVICES.filter((s) => s.status !== "healthy")
          .map((s) => `${s.name} (${s.status})`)
          .join(", "),
      ),
    });
  },
);

// ─── Tool 2: Service Metrics ─────────────────────────────────────────

server.tool(
  {
    name: "show-service-metrics",
    description:
      "Render time-series metrics for a specific service. Shows a traffic light in panic mode and a full area chart with threshold lines in expert mode.",
    schema: z.object({
      serviceId: z.string().describe("Service ID, e.g. 'api-gw', 'auth-svc'."),
      metric: z.enum(["cpu", "memory", "rps", "error_rate", "latency"]).default("cpu"),
      hours: z.number().min(1).max(24).default(6),
    }),
    widget: {
      name: "service-metrics",
      invoking: "Loading metrics…",
      invoked: "Metrics ready",
    },
  },
  async ({ serviceId, metric, hours }) => {
    const svc = getService(serviceId);
    if (!svc) {
      return text(`Service '${serviceId}' not found. Available: ${SERVICES.map((s) => s.id).join(", ")}`);
    }
    const data = genMetrics(svc, metric, hours);
    const current = data[data.length - 1]?.value ?? 0;
    const unit: Record<string, string> = { cpu: "%", memory: "%", rps: " req/s", error_rate: "%", latency: "ms" };
    return widget({
      props: {
        serviceId: svc.id, serviceName: svc.name, metric, current,
        status: svc.status, data,
      },
      output: text(`${svc.name} ${metric}: ${current.toFixed(1)}${unit[metric] || ""} (last ${hours}h, ${data.length} points)`),
    });
  },
);

// ─── Tool 3: Auto-Fix Service ────────────────────────────────────────

server.tool(
  {
    name: "auto-fix-service",
    description:
      "Auto-remediate an issue on a service. In panic mode, the agent calls this proactively. Returns a confirmation widget showing what was fixed.",
    schema: z.object({
      serviceId: z.string().describe("Service ID to fix."),
      action: z.enum(["restart", "scale_up", "flush_cache", "rollback", "drain_queue"]).default("restart"),
    }),
    widget: {
      name: "auto-fix-result",
      invoking: "Applying fix…",
      invoked: "Fix applied",
    },
  },
  async ({ serviceId, action }) => {
    const svc = getService(serviceId);
    if (!svc) {
      return text(`Service '${serviceId}' not found.`);
    }
    const actions: Record<string, string> = {
      restart: `Restarting ${svc.name}… Rolling restart 1/3 → 2/3 → 3/3.`,
      scale_up: `Scaling ${svc.name} from 3 to 5 replicas. ETA: 45s.`,
      flush_cache: `Flushing cache for ${svc.name}. Cleared 2.4GB.`,
      rollback: `Rolling back ${svc.name} from v${svc.version} to previous.`,
      drain_queue: `Draining queue for ${svc.name}. 523 jobs processed.`,
    };
    const oldStatus = svc.status;
    // Mutate in-place for demo
    svc.status = "healthy";
    svc.alerts = [];
    svc.error_rate = Math.round(Math.random() * 5) / 100;
    svc.cpu_pct = Math.round((20 + Math.random() * 30) * 10) / 10;
    svc.memory_pct = Math.round((40 + Math.random() * 25) * 10) / 10;

    return widget({
      props: {
        serviceId: svc.id, serviceName: svc.name, action,
        oldStatus, newStatus: "healthy", message: actions[action] || `Executed ${action}.`,
      },
      output: text(`✓ ${actions[action] || `Executed ${action}.`} Status: ${oldStatus} → healthy.`),
    });
  },
);

// ─── Tool 4: Manual Control (Terminal) ───────────────────────────────

server.tool(
  {
    name: "manual-control",
    description:
      "Execute a mock shell command in the infrastructure environment. Expert-mode tool that renders in a terminal widget.",
    schema: z.object({
      command: z.string().describe("Shell command to execute (mock)."),
    }),
    widget: {
      name: "terminal",
      invoking: "Executing…",
      invoked: "Command complete",
    },
  },
  async ({ command }) => {
    const cmd = command.trim().toLowerCase();
    let output: string;

    if (cmd.includes("kubectl") && cmd.includes("pods")) {
      output = [
        "NAME                           READY   STATUS      RESTARTS   AGE",
        "api-gw-7f8d9c4b5-x2k4m       1/1     Running     0          30d",
        "auth-svc-6c5b8a3d2-h7j2f     1/1     Running     3          7d",
        "auth-svc-6c5b8a3d2-k4m8p     0/1     CrashLoop   5          7d",
        "db-cluster-primary-0          1/1     Running     0          90d",
        "db-cluster-replica-1          1/1     Running     0          90d",
        "cache-layer-5a4f7e2c1-r3t6   1/1     Running     0          60d",
        "ml-pipeline-worker-0         0/1     OOMKilled   14         2h",
        "ml-pipeline-worker-1         0/1     OOMKilled   11         2h",
      ].join("\n");
    } else if (cmd.includes("docker") && cmd.includes("ps")) {
      output = [
        "CONTAINER ID   IMAGE                  STATUS        PORTS",
        "a3f82c4d1e7b   api-gateway:3.2.1     Up 30 days    0.0.0.0:8080->8080",
        "b7d4e1f09c2a   auth-service:2.1.0    Up 7 days     0.0.0.0:8081->8081",
        "c1e5f2a3b4d6   postgres:16.2         Up 90 days    0.0.0.0:5432->5432",
        "d8f3a2c5e7b1   redis:7.4.0           Up 60 days    0.0.0.0:6379->6379",
        "e2b4c6d8f1a3   ml-pipeline:1.0.3     Up 2 hours    0.0.0.0:8085->8085",
      ].join("\n");
    } else {
      output = `$ ${command}\n[mock] Command executed successfully.`;
    }

    return widget({
      props: { command, output, exitCode: 0, timestamp: new Date().toISOString() },
      output: text(`Executed: \`${command}\` — ${output.split("\n").length} lines.`),
    });
  },
);

// ─── Tool 5: Service Logs ────────────────────────────────────────────

const LOG_TEMPLATES: Record<string, [string, string, string][]> = {
  "api-gw": [
    ["INFO", "Request completed", "GET /api/v3/users 200 42ms"],
    ["INFO", "Health check passed", "upstream=auth-svc latency=12ms"],
    ["WARN", "Rate limit approaching", "Client 10.0.4.22 at 950/1000 rps"],
  ],
  "auth-svc": [
    ["ERROR", "Token validation failed", "JWT expired user_id=a3f82c age=7201s"],
    ["WARN", "Memory pressure", "heap_used=1.6GB heap_max=2.0GB gc_pause=45ms"],
    ["ERROR", "Connection pool exhausted", "pool=db-primary active=50/50 waiting=12"],
  ],
  "db-cluster": [
    ["INFO", "Query completed", "SELECT * FROM users WHERE id=$1 rows=1 time=2ms"],
    ["INFO", "Replication sync", "replica-2 lag=0.3s state=streaming"],
    ["WARN", "Slow query", "duration=1250ms query=SELECT COUNT(*)..."],
  ],
  "cache-layer": [
    ["INFO", "Cache hit", "key=session:a3f82c ttl=2400s size=1.2KB"],
    ["INFO", "Eviction", "policy=lru evicted=128 freed=4.2MB"],
  ],
  "ml-pipeline": [
    ["ERROR", "OOM kill", "pod=inference-worker-7 rss=8.2GB limit=8GB restarts=14"],
    ["ERROR", "Pipeline stall", "queue_depth=523 consumer_lag=12min"],
    ["CRITICAL", "Health check failed", "endpoint=/health status=503 failures=8"],
  ],
};

server.tool(
  {
    name: "get-service-logs",
    description:
      "Fetch recent log lines for a service. Renders in a scrollable log viewer with syntax highlighting (expert mode) or a simple error count summary (panic mode).",
    schema: z.object({
      serviceId: z.string().describe("Service ID to fetch logs for."),
      tail: z.number().min(1).max(50).default(20),
    }),
    widget: {
      name: "service-logs",
      invoking: "Fetching logs…",
      invoked: "Logs ready",
    },
  },
  async ({ serviceId, tail }) => {
    const svc = getService(serviceId);
    if (!svc) return text(`Service '${serviceId}' not found.`);

    const templates = LOG_TEMPLATES[serviceId] || [["INFO", "No logs", "No log data available"]];
    const now = Date.now();
    const logs = Array.from({ length: Math.min(tail, 50) }, (_, i) => {
      const t = templates[i % templates.length];
      return {
        timestamp: new Date(now - i * (2000 + Math.random() * 13000)).toISOString(),
        level: t[0], category: t[1], message: t[2], service: serviceId,
      };
    }).reverse();

    const errorCount = logs.filter((l) => l.level === "ERROR" || l.level === "CRITICAL").length;
    const warnCount = logs.filter((l) => l.level === "WARN").length;

    return widget({
      props: { serviceId: svc.id, serviceName: svc.name, logs, errorCount, warnCount },
      output: text(`${svc.name} logs: ${logs.length} lines (${errorCount} errors, ${warnCount} warnings).`),
    });
  },
);

// ─── Start Server ────────────────────────────────────────────────────

server.listen().then(() => {
  console.log("[morphos-mcp] Server running on port 3011");
});
