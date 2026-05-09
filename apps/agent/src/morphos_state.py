"""MorphosStateMiddleware — declares the infrastructure canvas fields on
the agent's TypedDict state schema so they survive STATE_SNAPSHOT round-
trips, and hydrates a fresh thread with the default system status.

Replaces LeadStateMiddleware for the Morphos project. Same architecture:
- State schema fields are declared so LangGraph carries them through
  state-event emission.
- ``before_agent`` hydrates empty threads with the initial service data
  so the canvas isn't blank on first load.

Field shapes mirror what ``morphos_tools.py``'s Command(update=) writes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from typing_extensions import NotRequired, TypedDict


# ─── State sub-shapes ─────────────────────────────────────────────────

class _Header(TypedDict, total=False):
    title: str
    subtitle: str


class _ServiceSummary(TypedDict, total=False):
    id: str
    name: str
    type: str
    status: str
    cpu_pct: float
    memory_pct: float
    rps: int
    error_rate: float
    p99_latency_ms: int
    alert_count: int
    region: str


class _MetricPoint(TypedDict, total=False):
    timestamp: str
    value: float


class _CurrentMetrics(TypedDict, total=False):
    serviceId: str
    serviceName: str
    metric: str
    current: float
    status: str
    data: list[_MetricPoint]


class _LogEntry(TypedDict, total=False):
    timestamp: str
    level: str
    category: str
    message: str
    service: str


class _ServiceLogs(TypedDict, total=False):
    serviceId: str
    serviceName: str
    logs: list[_LogEntry]
    errorCount: int
    warnCount: int


class _TerminalOutput(TypedDict, total=False):
    command: str
    output: str
    timestamp: str
    exitCode: int


class _LastAction(TypedDict, total=False):
    type: str
    serviceId: str
    serviceName: str
    result: str
    timestamp: str


# ─── Reducer ──────────────────────────────────────────────────────────

def _replace(_left: Any, right: Any) -> Any:
    """LangGraph reducer that always takes the most recent value."""
    return right


# ─── Canvas State ─────────────────────────────────────────────────────

class MorphosCanvasState(AgentState):
    """Extended agent state for the Morphos infrastructure canvas.

    Each field is ``NotRequired`` so the agent can boot without all
    fields set; the frontend provides defaults on the React side.
    """
    services: NotRequired[Annotated[list[_ServiceSummary], _replace]]
    currentMetrics: NotRequired[Annotated[_CurrentMetrics, _replace]]
    serviceLogs: NotRequired[Annotated[_ServiceLogs, _replace]]
    terminalOutput: NotRequired[Annotated[_TerminalOutput, _replace]]
    lastAction: NotRequired[Annotated[_LastAction, _replace]]
    header: NotRequired[Annotated[_Header, _replace]]


# ─── Middleware ────────────────────────────────────────────────────────

class MorphosStateMiddleware(AgentMiddleware[MorphosCanvasState, Any]):  # type: ignore[type-arg]
    """Contributes the Morphos canvas state schema and hydrates fresh threads.

    On the first turn of a new thread (when state.services is empty),
    populates the canvas with the initial infrastructure status so the
    dashboard isn't blank.
    """

    state_schema = MorphosCanvasState

    def before_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        """Hydrate empty canvas state with the initial infrastructure data."""
        existing = (state or {}).get("services") if isinstance(state, dict) else None
        if existing:
            return None

        # Import from morphos_tools to get the initial service data
        try:
            from .morphos_tools import _live_services, _service_summary
            services = [_service_summary(s) for s in _live_services]
        except Exception:
            return None

        if not services:
            return None

        healthy = sum(1 for s in services if s["status"] == "healthy")
        total = len(services)
        critical_names = [s["name"] for s in services if s["status"] == "critical"]
        degraded_names = [s["name"] for s in services if s["status"] == "degraded"]

        subtitle_parts = [f"{healthy}/{total} healthy"]
        if critical_names:
            subtitle_parts.append(f"critical: {', '.join(critical_names)}")
        if degraded_names:
            subtitle_parts.append(f"degraded: {', '.join(degraded_names)}")

        return {
            "services": services,
            "header": {
                "title": "Infrastructure Dashboard",
                "subtitle": " · ".join(subtitle_parts),
            },
        }
