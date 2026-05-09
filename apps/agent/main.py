"""LangGraph entry point for `langgraph dev --port 8133`.

Wires:
- Morphos Cognitive Orchestrator (replaces lead-triage agent)
- Mock infrastructure backend tools (always present, no external deps)
- TimingMiddleware (per-turn wall-time logging — see `src/timing.py`)
- MorphosStateMiddleware + CopilotKitMiddleware for canvas state + AG-UI

Frontend tools (`renderActionCard`, `renderMetricVisualizer`, etc.) are
declared on the React side via `useFrontendTool`. The runtime forwards
those declarations into the agent's tool list at run time, so we do NOT
include Python stubs here.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

from src.intelligence_cleanup import wipe_orphan_threads
from src.morphos_tools import load_morphos_tools
from src.morphos_prompts import build_morphos_prompt
from src.runtime import build_graph


# Load .env early so GEMINI_API_KEY is visible.
load_dotenv()


# `langgraph dev` uses an in-memory checkpoint store, so every agent boot
# starts with zero threads in LangGraph but the Intelligence Postgres
# still holds the chat history from the previous run. Without this
# cleanup, the next `getCheckpointByMessage` lookup throws "Message not
# found" and surfaces in the UI as an opaque rxjs stack trace.
wipe_orphan_threads()


# Stub-key warnings for the active runtime.
_AGENT_RUNTIME = os.getenv("AGENT_RUNTIME", "gemini-flash-deep")
print(f"[runtime] AGENT_RUNTIME={_AGENT_RUNTIME}", flush=True)

_gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
if _AGENT_RUNTIME.startswith("gemini-") and (
    not _gemini_key or _gemini_key.startswith("stub")
):
    print(
        "\n  GEMINI_API_KEY is unset or a stub.\n"
        "   The agent will boot but chat will fail on the first turn.\n"
        "   Get a key at https://aistudio.google.com → Get API key,\n"
        "   then set GEMINI_API_KEY in .env and apps/agent/.env.\n",
        flush=True,
    )


backend_tools = load_morphos_tools()
SYSTEM_PROMPT = build_morphos_prompt()


_use_noop = (
    _AGENT_RUNTIME.startswith("gemini-")
    and (not _gemini_key or _gemini_key.startswith("stub"))
)
if _use_noop:
    print(
        "\n[runtime] GEMINI_API_KEY missing or stub — using noop fallback graph.\n"
        "          Chat will reply with a setup pointer instead of hanging.\n",
        flush=True,
    )

# Frontend tools are NOT listed here — see module docstring.
graph = build_graph(
    "noop" if _use_noop else _AGENT_RUNTIME,
    tools=backend_tools,
    system_prompt=SYSTEM_PROMPT,
)


def main() -> None:
    """Entry point for `uv run dev` / `python -m agent`."""
    import subprocess

    subprocess.run(
        ["langgraph", "dev", "--port", "8133"],
        check=True,
    )


if __name__ == "__main__":
    main()

