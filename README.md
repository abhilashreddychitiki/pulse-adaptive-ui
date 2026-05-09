# Pulse Adaptive UI (Project Morphos)

Welcome to **Pulse Adaptive UI**, our submission for the **Generative UI Global Hackathon: Agentic Interfaces**.

**Core Thesis:** AI should not just generate content; it should generate the *interface* required to consume that content based on the user's current mental bandwidth.

### What is Morphos?
Morphos is a "Cognitive-Load Aware UI" designed for Cloud Infrastructure Management. It monitors real-time user interaction signals (captured via cursor velocity and interactions in our "Sensory Layer") to autonomously mutate its UI complexity using the Generative UI stack.

Most AI applications suffer from "Dashboard Bloat." Morphos solves this by providing "Just-in-Time Infrastructure"—collapsing or expanding the UI based on cognitive load:
- **Panic Mode (High Load):** Simple, high-contrast UI with single-click "Auto-Fix" buttons. No dense charts or raw logs.
- **Expert Mode (Low Load):** Dense, data-rich UI with full metric charts, real-time logs, and a mock shell execution terminal.
- **Progressive Disclosure (Medium Load):** Medium verbosity showing key metrics inline.

## The Stack
- **CopilotKit:** Powers the main chat sidebar and connects the LangGraph agent to the Next.js frontend using `useFrontendTool`.
- **LangChain Deep Agents & LangGraph:** The backend orchestrator running the Python agent that manages state and executes infrastructure workflows.
- **Gemini 3.1 Pro:** The reasoning engine that processes system telemetry, diagnoses root causes, and chooses the correct generative UI components.
- **Notion MCP Server:** We integrated the official Notion MCP server using `mcp-use`. Whenever the agent automatically fixes a critical infrastructure issue, it proactively formats an Incident RCA (Root Cause Analysis) and pushes it to our central Notion workspace.
- **Framer Motion & A2UI Principles:** Used to power the fluid, dynamic component transitions when switching between "Zen" and "Panic" modes.

## How to Run Locally

### 1. Configure the Environment
Copy the example environment file:
```bash
cp .env.example .env
cp .env apps/agent/.env
```

Ensure the following keys are set in both files:
- `GEMINI_API_KEY`: Required for the LLM orchestration.
- `NOTION_TOKEN`: Required for the Incident RCA Logging integration.
- `NOTION_LEADS_DATABASE_ID`: The ID of the Notion Database to log incidents into.

### 2. Install Dependencies
Install all node and python dependencies (requires `python` to be installed):
```bash
npm install
npm run install:agent
```

### 3. Start the Stack
Start the Next.js UI, the Node BFF, the Python LangGraph Agent, and the MCP server in parallel (no Docker required!):
```bash
npx concurrently -k -n ui,bff,agent,mcp -c blue,cyan,green,magenta "npm run dev:ui" "npm run dev:bff" "npm run dev:agent" "npm run dev:mcp"
```

### 4. Test the Demo
Open `http://localhost:3010/morphos` in your browser.
1. Observe the **Cognitive Orb** in the bottom right corner tracking your activity.
2. Ask the agent: *"What is the system status?"*
3. The agent will render the adaptive system topology directly onto the canvas.
4. Try to trigger "Panic Mode" by clicking around rapidly, or just ask the agent to *"Fix everything"*, and watch it execute an automated recovery and proactively log a Root Cause Analysis to Notion!
