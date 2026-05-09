// Auto-generated tool registry types - DO NOT EDIT MANUALLY
// This file is regenerated whenever tools are added, removed, or updated during development
// Generated at: 2026-05-09T23:04:42.379Z

declare module "mcp-use/react" {
  interface ToolRegistry {
    "auto-fix-service": {
      input: { "serviceId": string; "action": "restart" | "scale_up" | "flush_cache" | "rollback" | "drain_queue" };
      output: Record<string, unknown>;
    };
    "get-service-logs": {
      input: { "serviceId": string; "tail": number };
      output: Record<string, unknown>;
    };
    "manual-control": {
      input: { "command": string };
      output: Record<string, unknown>;
    };
    "show-service-metrics": {
      input: { "serviceId": string; "metric": "cpu" | "memory" | "rps" | "error_rate" | "latency"; "hours": number };
      output: Record<string, unknown>;
    };
    "show-system-overview": {
      input: Record<string, never>;
      output: Record<string, unknown>;
    };
  }
}

export {};
