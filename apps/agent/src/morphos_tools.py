"""Morphos backend tools — mock cloud infrastructure management.

These tools give the Morphos agent the ability to inspect, diagnose, and
remediate a mock cloud infrastructure. Every tool returns deterministic
mock data so the agent can demo without external dependencies.

The mock topology has 5 services:
  1. API Gateway (api-gw)
  2. Auth Service (auth-svc)
  3. Database Cluster (db-cluster)
  4. Cache Layer (cache-layer)
  5. ML Pipeline (ml-pipeline)

Designed to pair with the frontend's adaptive components:
  - get_system_status  → ActionCard / SystemStatus
  - get_service_metrics → MetricVisualizer
  - auto_fix_issue     → ActionCard (panic mode one-click fix)
  - get_service_logs   → LogViewer (expert mode)
  - run_command        → Terminal widget (expert mode)
  - find_service       → fuzzy name resolution (like find_lead)
"""

from __future__ import annotations

import json
import math
import random
import time
from datetime import datetime, timezone, timedelta
from typing import Annotated, Any, Dict, List

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool, InjectedToolCallId
from langgraph.prebuilt import InjectedState
from langgraph.types import Command

from src.lead_store import get_store


# ─── Mock Infrastructure Data ─────────────────────────────────────────

SERVICES: List[Dict[str, Any]] = [
    {
        "id": "api-gw",
        "name": "API Gateway",
        "type": "gateway",
        "status": "healthy",
        "uptime_hours": 720,
        "cpu_pct": 34.2,
        "memory_pct": 58.1,
        "rps": 12450,
        "error_rate": 0.02,
        "p99_latency_ms": 45,
        "dependencies": ["auth-svc", "cache-layer"],
        "region": "us-east-1",
        "version": "3.2.1",
        "last_deploy": "2026-05-08T14:30:00Z",
        "alerts": [],
    },
    {
        "id": "auth-svc",
        "name": "Auth Service",
        "type": "microservice",
        "status": "degraded",
        "uptime_hours": 168,
        "cpu_pct": 78.9,
        "memory_pct": 82.3,
        "rps": 4200,
        "error_rate": 3.8,
        "p99_latency_ms": 320,
        "dependencies": ["db-cluster", "cache-layer"],
        "region": "us-east-1",
        "version": "2.1.0",
        "last_deploy": "2026-05-07T09:15:00Z",
        "alerts": [
            {"severity": "warning", "message": "High memory usage (>80%)", "since": "2026-05-09T10:00:00Z"},
            {"severity": "critical", "message": "Error rate exceeds 3% threshold", "since": "2026-05-09T14:30:00Z"},
        ],
    },
    {
        "id": "db-cluster",
        "name": "Database Cluster",
        "type": "database",
        "status": "healthy",
        "uptime_hours": 2160,
        "cpu_pct": 45.6,
        "memory_pct": 67.4,
        "rps": 8900,
        "error_rate": 0.01,
        "p99_latency_ms": 12,
        "dependencies": [],
        "region": "us-east-1",
        "version": "16.2",
        "last_deploy": "2026-04-15T03:00:00Z",
        "alerts": [],
        "replicas": 3,
        "connections_active": 245,
        "connections_max": 500,
    },
    {
        "id": "cache-layer",
        "name": "Cache Layer",
        "type": "cache",
        "status": "healthy",
        "uptime_hours": 1440,
        "cpu_pct": 12.3,
        "memory_pct": 71.2,
        "rps": 28000,
        "error_rate": 0.0,
        "p99_latency_ms": 2,
        "dependencies": [],
        "region": "us-east-1",
        "version": "7.4.0",
        "last_deploy": "2026-04-20T06:00:00Z",
        "alerts": [],
        "hit_rate": 94.7,
        "evictions_per_sec": 12,
    },
    {
        "id": "ml-pipeline",
        "name": "ML Pipeline",
        "type": "pipeline",
        "status": "critical",
        "uptime_hours": 2,
        "cpu_pct": 95.1,
        "memory_pct": 91.4,
        "rps": 150,
        "error_rate": 12.5,
        "p99_latency_ms": 4500,
        "dependencies": ["db-cluster", "cache-layer"],
        "region": "us-west-2",
        "version": "1.0.3",
        "last_deploy": "2026-05-09T12:00:00Z",
        "alerts": [
            {"severity": "critical", "message": "OOM kills detected — pod restarts: 14 in last hour", "since": "2026-05-09T13:00:00Z"},
            {"severity": "critical", "message": "Pipeline stalled: inference queue depth > 500", "since": "2026-05-09T13:15:00Z"},
            {"severity": "warning", "message": "GPU utilization at 98% — throttling", "since": "2026-05-09T12:30:00Z"},
        ],
    },
]

# Mutable copy so auto_fix can change status within a session
_live_services: List[Dict[str, Any]] = [dict(s) for s in SERVICES]


def _get_service(service_id: str) -> Dict[str, Any] | None:
    for s in _live_services:
        if s["id"] == service_id:
            return s
    return None


def _service_summary(s: Dict[str, Any]) -> Dict[str, Any]:
    """Return a slim summary for list views."""
    return {
        "id": s["id"],
        "name": s["name"],
        "type": s["type"],
        "status": s["status"],
        "cpu_pct": s["cpu_pct"],
        "memory_pct": s["memory_pct"],
        "rps": s["rps"],
        "error_rate": s["error_rate"],
        "p99_latency_ms": s["p99_latency_ms"],
        "alert_count": len(s.get("alerts", [])),
        "region": s.get("region", ""),
    }


# ─── Generate mock time-series metrics ────────────────────────────────

def _generate_metrics(
    service_id: str,
    metric: str = "cpu",
    hours: int = 6,
) -> List[Dict[str, Any]]:
    """Generate mock time-series data points."""
    svc = _get_service(service_id)
    if not svc:
        return []

    now = datetime.now(timezone.utc)
    points = []
    base_values = {
        "cpu": svc["cpu_pct"],
        "memory": svc["memory_pct"],
        "rps": svc["rps"],
        "error_rate": svc["error_rate"],
        "latency": svc["p99_latency_ms"],
    }
    base = base_values.get(metric, 50.0)

    for i in range(hours * 12):  # 5-minute intervals
        t = now - timedelta(minutes=(hours * 60) - i * 5)
        # Add some realistic-looking variation
        noise = math.sin(i * 0.3) * base * 0.1 + random.uniform(-base * 0.05, base * 0.05)
        val = max(0, base + noise)
        # Add a spike for degraded/critical services in the last hour
        if svc["status"] in ("degraded", "critical") and i > hours * 12 - 12:
            val *= 1.3 + random.uniform(0, 0.3)
        points.append({
            "timestamp": t.isoformat(),
            "value": round(val, 2),
        })
    return points


# ─── Mock log lines ──────────────────────────────────────────────────

_LOG_TEMPLATES = {
    "api-gw": [
        ("INFO", "Request completed", "GET /api/v3/users 200 42ms"),
        ("INFO", "Request completed", "POST /api/v3/auth/token 200 89ms"),
        ("WARN", "Rate limit approaching", "Client 10.0.4.22 at 950/1000 rps"),
        ("INFO", "Health check passed", "upstream=auth-svc latency=12ms"),
    ],
    "auth-svc": [
        ("ERROR", "Token validation failed", "JWT expired for user_id=a3f82c token_age=7201s"),
        ("WARN", "Memory pressure", "heap_used=1.6GB heap_max=2.0GB gc_pause=45ms"),
        ("ERROR", "Connection pool exhausted", "pool=db-primary active=50/50 waiting=12"),
        ("INFO", "Session created", "user_id=b7d4e1 provider=google ttl=3600s"),
        ("ERROR", "Rate limit exceeded", "client_ip=10.0.3.15 path=/auth/refresh count=102/100"),
    ],
    "db-cluster": [
        ("INFO", "Query completed", "SELECT * FROM users WHERE id=$1 rows=1 time=2ms"),
        ("INFO", "Checkpoint completed", "wal_size=256MB duration=1.2s"),
        ("INFO", "Replication sync", "replica-2 lag=0.3s state=streaming"),
        ("WARN", "Slow query detected", "duration=1250ms query=SELECT COUNT(*) FROM events WHERE..."),
    ],
    "cache-layer": [
        ("INFO", "Cache hit", "key=session:a3f82c ttl=2400s size=1.2KB"),
        ("INFO", "Cache miss", "key=user:profile:d4e5f6 → backfill from db-cluster"),
        ("INFO", "Eviction", "policy=lru evicted=128 freed=4.2MB"),
        ("WARN", "Memory fragmentation", "ratio=1.12 recommend_defrag=true"),
    ],
    "ml-pipeline": [
        ("ERROR", "OOM kill", "pod=inference-worker-7 rss=8.2GB limit=8GB restart_count=14"),
        ("ERROR", "Pipeline stall", "queue_depth=523 oldest_job=45min consumer_lag=12min"),
        ("WARN", "GPU throttle", "gpu0 temp=89°C util=98% clock=1200MHz (throttled from 1800MHz)"),
        ("ERROR", "Inference timeout", "model=embedding-v3 input_tokens=4096 timeout=30s elapsed=31.2s"),
        ("CRITICAL", "Health check failed", "endpoint=/health status=503 consecutive_failures=8"),
    ],
}


def _generate_logs(service_id: str, tail: int = 30) -> List[Dict[str, Any]]:
    """Generate mock log lines for a service."""
    templates = _LOG_TEMPLATES.get(service_id, [])
    if not templates:
        return [{"level": "INFO", "message": "No logs available", "timestamp": datetime.now(timezone.utc).isoformat()}]

    now = datetime.now(timezone.utc)
    logs = []
    for i in range(min(tail, 50)):
        tmpl = templates[i % len(templates)]
        t = now - timedelta(seconds=i * random.randint(2, 15))
        logs.append({
            "timestamp": t.isoformat(),
            "level": tmpl[0],
            "category": tmpl[1],
            "message": tmpl[2],
            "service": service_id,
        })
    return list(reversed(logs))


# ─── Tools ────────────────────────────────────────────────────────────

@tool
def get_system_status(
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Get the current status of all infrastructure services.

    Returns a Command(update=) that populates the `services` field on
    agent state AND emits a summary ToolMessage. The frontend's
    SystemStatus / ActionCard components render from state.services.
    """
    healthy = sum(1 for s in _live_services if s["status"] == "healthy")
    degraded = sum(1 for s in _live_services if s["status"] == "degraded")
    critical = sum(1 for s in _live_services if s["status"] == "critical")
    total = len(_live_services)
    total_alerts = sum(len(s.get("alerts", [])) for s in _live_services)

    summary = (
        f"System status: {healthy}/{total} healthy"
        f"{f', {degraded} degraded' if degraded else ''}"
        f"{f', {critical} critical' if critical else ''}. "
        f"{total_alerts} active alerts."
    )

    # Add details for non-healthy services
    issues = []
    for s in _live_services:
        if s["status"] != "healthy":
            alerts_text = "; ".join(a["message"] for a in s.get("alerts", []))
            issues.append(f"  • {s['name']} ({s['status']}): {alerts_text}")
    if issues:
        summary += "\n\nIssues:\n" + "\n".join(issues)

    return Command(
        update={
            "services": [_service_summary(s) for s in _live_services],
            "messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)],
        }
    )


@tool
def get_service_metrics(
    service_id: Annotated[str, "Service ID (e.g. 'api-gw', 'auth-svc', 'db-cluster', 'cache-layer', 'ml-pipeline')."],
    metric: Annotated[str, "Metric name: 'cpu', 'memory', 'rps', 'error_rate', or 'latency'."] = "cpu",
    hours: Annotated[int, "Number of hours of history to return (1–24)."] = 6,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Get time-series metrics for a specific service.

    Returns metric data points at 5-minute intervals for the MetricVisualizer
    component to render as a line chart (expert mode) or traffic light
    (panic mode).
    """
    svc = _get_service(service_id)
    if not svc:
        return Command(
            update={
                "messages": [ToolMessage(
                    content=f"Service '{service_id}' not found. Available: {', '.join(s['id'] for s in _live_services)}",
                    tool_call_id=tool_call_id,
                )],
            }
        )

    hours = max(1, min(hours, 24))
    data = _generate_metrics(service_id, metric, hours)

    # Current value for summary
    current = data[-1]["value"] if data else 0
    unit = {"cpu": "%", "memory": "%", "rps": " req/s", "error_rate": "%", "latency": "ms"}.get(metric, "")

    summary = (
        f"{svc['name']} — {metric}: {current:.1f}{unit} (last {hours}h, "
        f"{len(data)} data points). Status: {svc['status']}."
    )

    return Command(
        update={
            "currentMetrics": {
                "serviceId": service_id,
                "serviceName": svc["name"],
                "metric": metric,
                "current": current,
                "status": svc["status"],
                "data": data,
            },
            "messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)],
        }
    )


@tool
def auto_fix_issue(
    service_id: Annotated[str, "The service ID to auto-fix."],
    issue_type: Annotated[str, "Type of fix: 'restart', 'scale_up', 'flush_cache', 'rollback', 'drain_queue'."] = "restart",
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Auto-remediate an issue on a service.

    In panic mode, the agent should call this proactively to fix critical
    issues. In expert mode, the UI presents a terminal for manual control.

    This is a mock — it simulates the fix and updates the service status.
    """
    svc = _get_service(service_id)
    if not svc:
        return Command(
            update={
                "messages": [ToolMessage(
                    content=f"Fix failed: service '{service_id}' not found.",
                    tool_call_id=tool_call_id,
                )],
            }
        )

    # Simulate the fix
    fix_actions = {
        "restart": f"Restarting {svc['name']}... Rolling restart initiated. Pods cycling 1/3 → 2/3 → 3/3.",
        "scale_up": f"Scaling {svc['name']} from 3 to 5 replicas. ETA: 45 seconds.",
        "flush_cache": f"Flushing cache for {svc['name']}. Cleared 2.4GB across 128K keys.",
        "rollback": f"Rolling back {svc['name']} from v{svc['version']} to previous version. Canary validation passed.",
        "drain_queue": f"Draining queue for {svc['name']}. Processed 523 pending jobs, discarded 12 dead letters.",
    }

    action_text = fix_actions.get(issue_type, f"Executing {issue_type} on {svc['name']}...")

    # Update the mock state to reflect the fix
    old_status = svc["status"]
    svc["status"] = "healthy"
    svc["alerts"] = []
    svc["error_rate"] = round(random.uniform(0.0, 0.05), 3)
    svc["cpu_pct"] = round(random.uniform(20, 50), 1)
    svc["memory_pct"] = round(random.uniform(40, 65), 1)
    svc["uptime_hours"] = 0  # just restarted

    summary = (
        f"✓ {action_text}\n"
        f"Status: {old_status} → healthy. "
        f"All alerts cleared."
    )

    return Command(
        update={
            "services": [_service_summary(s) for s in _live_services],
            "lastAction": {
                "type": issue_type,
                "serviceId": service_id,
                "serviceName": svc["name"],
                "result": "success",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            "messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)],
        }
    )


@tool
def get_service_logs(
    service_id: Annotated[str, "Service ID to fetch logs for."],
    tail: Annotated[int, "Number of recent log lines to return (max 50)."] = 30,
    level: Annotated[str, "Filter by log level: 'all', 'error', 'warn', 'critical'. Default 'all'."] = "all",
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Fetch recent log lines for a service.

    Expert-mode tool — renders in a scrollable log viewer with syntax
    highlighting. In panic mode, the agent should summarize the key
    errors instead of showing raw logs.
    """
    svc = _get_service(service_id)
    if not svc:
        return Command(
            update={
                "messages": [ToolMessage(
                    content=f"Logs unavailable: service '{service_id}' not found.",
                    tool_call_id=tool_call_id,
                )],
            }
        )

    logs = _generate_logs(service_id, min(tail, 50))

    # Filter by level if requested
    if level != "all":
        level_upper = level.upper()
        logs = [l for l in logs if l["level"] == level_upper]

    error_count = sum(1 for l in logs if l["level"] in ("ERROR", "CRITICAL"))
    warn_count = sum(1 for l in logs if l["level"] == "WARN")

    summary = (
        f"{svc['name']} logs: {len(logs)} lines"
        f"{f' ({error_count} errors, {warn_count} warnings)' if error_count or warn_count else ''}."
    )

    return Command(
        update={
            "serviceLogs": {
                "serviceId": service_id,
                "serviceName": svc["name"],
                "logs": logs,
                "errorCount": error_count,
                "warnCount": warn_count,
            },
            "messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)],
        }
    )


@tool
def run_command(
    command: Annotated[str, "Shell command to execute (mock). Examples: 'kubectl get pods', 'docker ps', 'top -n 1'."],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Execute a shell command (mock) in the infrastructure environment.

    Expert-mode tool — renders in a terminal widget. Commands are
    simulated; no real execution occurs.
    """
    cmd_lower = command.strip().lower()

    # Mock command responses
    if "kubectl" in cmd_lower and "pods" in cmd_lower:
        output = (
            "NAME                           READY   STATUS    RESTARTS   AGE\n"
            "api-gw-7f8d9c4b5-x2k4m       1/1     Running   0          30d\n"
            "api-gw-7f8d9c4b5-p9n3r       1/1     Running   0          30d\n"
            "auth-svc-6c5b8a3d2-h7j2f     1/1     Running   3          7d\n"
            "auth-svc-6c5b8a3d2-k4m8p     0/1     CrashLoop 5          7d\n"
            "db-cluster-primary-0          1/1     Running   0          90d\n"
            "db-cluster-replica-1          1/1     Running   0          90d\n"
            "db-cluster-replica-2          1/1     Running   0          90d\n"
            "cache-layer-5a4f7e2c1-r3t6   1/1     Running   0          60d\n"
            "ml-pipeline-worker-0         0/1     OOMKilled 14         2h\n"
            "ml-pipeline-worker-1         0/1     OOMKilled 11         2h\n"
            "ml-pipeline-scheduler-0      1/1     Running   2          2h"
        )
    elif "docker" in cmd_lower and "ps" in cmd_lower:
        output = (
            "CONTAINER ID   IMAGE                    STATUS          PORTS\n"
            "a3f82c4d1e7b   api-gateway:3.2.1       Up 30 days      0.0.0.0:8080->8080/tcp\n"
            "b7d4e1f09c2a   auth-service:2.1.0      Up 7 days       0.0.0.0:8081->8081/tcp\n"
            "c1e5f2a3b4d6   postgres:16.2           Up 90 days      0.0.0.0:5432->5432/tcp\n"
            "d8f3a2c5e7b1   redis:7.4.0             Up 60 days      0.0.0.0:6379->6379/tcp\n"
            "e2b4c6d8f1a3   ml-pipeline:1.0.3       Up 2 hours      0.0.0.0:8085->8085/tcp"
        )
    elif "top" in cmd_lower or "htop" in cmd_lower:
        output = (
            "top - 16:45:00 up 90 days, load average: 2.34, 1.89, 1.56\n"
            "Tasks: 312 total, 3 running, 309 sleeping\n"
            "%Cpu(s): 34.2 us, 12.1 sy,  0.0 ni, 51.3 id,  2.4 wa\n"
            "MiB Mem : 32768.0 total,  8192.0 free, 18432.0 used,  6144.0 cache\n\n"
            "  PID USER      %CPU %MEM    COMMAND\n"
            " 1234 postgres  15.2  8.4    postgres: worker\n"
            " 2345 node      12.8  4.2    node api-gateway\n"
            " 3456 python    95.1 28.4    python inference_worker\n"
            " 4567 redis      3.2  6.8    redis-server\n"
            " 5678 node       8.9  3.1    node auth-service"
        )
    elif "curl" in cmd_lower and "health" in cmd_lower:
        output = '{"status":"ok","services":{"api-gw":"up","auth-svc":"degraded","db":"up","cache":"up","ml":"down"}}'
    else:
        output = f"$ {command}\n[mock] Command executed successfully. (No real execution — this is a sandbox.)"

    summary = f"Executed: `{command}` — {len(output.splitlines())} lines of output."

    return Command(
        update={
            "terminalOutput": {
                "command": command,
                "output": output,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "exitCode": 0,
            },
            "messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)],
        }
    )


@tool
def find_service(
    query: Annotated[str, "A name or partial name to look up. Case-insensitive. Examples: 'auth', 'ml', 'gateway'."],
) -> str:
    """Look up a service by name (fuzzy match).

    Like find_lead but for infrastructure services. Use before
    get_service_metrics / get_service_logs / auto_fix_issue when you
    only have a partial name.
    """
    q = (query or "").strip().lower()
    if not q:
        return json.dumps({"matches": [], "hint": "query was empty"})

    matches = []
    for s in _live_services:
        name_lower = s["name"].lower()
        id_lower = s["id"].lower()
        if q == name_lower or q == id_lower:
            matches.append({"id": s["id"], "name": s["name"], "status": s["status"]})
        elif q in name_lower or q in id_lower:
            matches.append({"id": s["id"], "name": s["name"], "status": s["status"]})

    if not matches:
        available = ", ".join(f"{s['id']} ({s['name']})" for s in _live_services)
        return json.dumps({"matches": [], "hint": f"No match for '{query}'. Available: {available}"})
    if len(matches) == 1:
        return json.dumps({"match": matches[0]})
    return json.dumps({"matches": matches, "hint": "Multiple matches — specify which one."})


@tool
def log_incident_to_notion(
    incident_title: Annotated[str, "A short title for the incident, e.g. '[CRITICAL] db-cluster OOM'"],
    affected_service: Annotated[str, "The name of the service affected."],
    severity: Annotated[str, "Severity of the incident, e.g. 'Critical', 'Warning'."],
    rca_message: Annotated[str, "Detailed root cause analysis and remediation steps."],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Log an incident report to the organization's central Notion database.
    
    Uses the Notion MCP integration to fulfill hackathon requirements.
    Should be called proactively when auto-fixing critical infrastructure
    or when specifically requested by the user.
    """
    store = get_store()
    
    lead_payload = {
        "name": incident_title,
        "company": affected_service,
        "role": f"Incident Severity: {severity}",
        "message": rca_message,
        "status": "Reviewing",
        "opt_in": True,
        "source": "Morphos Auto-Remediation",
    }
    
    try:
        new_incident = store.insert_lead(lead_payload)
        if not new_incident:
            summary = "Failed to log incident to Notion. Make sure NOTION_TOKEN is set."
        else:
            summary = f"Successfully logged incident '{incident_title}' to Notion database."
    except Exception as e:
        summary = f"Failed to log incident to Notion: {e}"

    return Command(
        update={
            "messages": [ToolMessage(content=summary, tool_call_id=tool_call_id)],
        }
    )


# ─── Loader ───────────────────────────────────────────────────────────

def load_morphos_tools() -> List[Any]:
    """Return the Morphos infrastructure backend tool list.

    Tools:
    - get_system_status    — overview of all services
    - get_service_metrics  — time-series metrics for one service
    - auto_fix_issue       — one-click remediation
    - get_service_logs     — recent log lines
    - run_command          — mock shell execution
    - find_service         — fuzzy service name resolution
    """
    tools: List[Any] = [
        get_system_status,
        get_service_metrics,
        auto_fix_issue,
        get_service_logs,
        run_command,
        find_service,
        log_incident_to_notion,
    ]
    print(f"[morphos] Backend tools loaded: {len(tools)} tools")
    return tools
