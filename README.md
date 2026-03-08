# CloudShell LLM

A natural language interface for managing Azure resources. Describe what you want to do in plain English — no commands, no syntax, no CLI knowledge required. The app translates your intent into Azure Management REST API calls, executes them using your own Azure identity, and returns conversational results.

![CloudShell LLM](https://img.shields.io/badge/Azure-Management_API-0078d4?style=flat&logo=microsoftazure) ![Anthropic Claude](https://img.shields.io/badge/Anthropic-Claude-191919?style=flat) ![OpenAI ChatGPT](https://img.shields.io/badge/OpenAI-ChatGPT-10a37f?style=flat&logo=openai&logoColor=white) ![React](https://img.shields.io/badge/React-TypeScript-61dafb?style=flat&logo=react)

## How It Works

1. You authenticate with your Microsoft Entra ID (Azure AD) account via the browser
2. You type a natural language request: *"create an Ubuntu VM named WEB1 in the webservers resource group"*
3. Your selected LLM provider (Claude or ChatGPT) classifies your request and chooses the right execution mode:
   - **Direct query** — a single Azure REST API call (e.g. list VMs, show a resource group)
   - **Synthesized query** — a query where the result is summarized in plain English (e.g. "how many resource groups do I have?")
   - **Agent** — a multi-step task where dependencies must be checked and created in the correct order (e.g. VM creation, AKS deployment)
4. Queries execute using **your Azure access token** — your RBAC roles and permissions apply exactly as they would in the Azure Portal

## Features

- **Natural language to Azure REST API** — describe what you want, not how to do it
- **Streaming responses** — synthesis answers stream token-by-token as the selected model generates them
- **Agentic resource creation** — the agent checks what exists, creates prerequisites in order (VNet → subnet → NIC → VM), waits for each async operation to complete, and uses real resource IDs between steps
- **Conversational synthesis** — aggregation queries return plain-English summaries ("You have 7 resource groups across 3 regions")
- **Raw data access** — every synthesized response includes a collapsible JSON view of the underlying API data
- **Async operation tracking** — long-running operations (storage accounts, VMs) show a live provisioning status indicator
- **Destructive command protection** — delete/purge operations always require explicit typed confirmation
- **Your identity, your permissions** — the backend never injects its own credentials; all API calls use your delegated access token

## In Action

Same app, three execution modes.

### Direct Query

Single API call, immediate raw result for targeted lookups.

**Prompt:** `show me all virtual machines in my webservers resource group`

![Direct query screenshot](docs/images/direct-query.png)

**What's happening:** The app maps intent to one Azure Management REST GET and returns the response directly.

### Synthesized Query

Aggregates API output into a plain-English answer while preserving access to raw data.

**Prompt:** `how many resource groups do I have and which regions are they in?`

![Synthesized query screenshot](docs/images/synthesized-query.png)

**What's happening:** The app executes the query, then streams a conversational summary from the selected model.

### Agent Execution (VM Provisioning)

Multi-step orchestration for dependent resources when one request requires ordered creation.

**Prompt:** `create an Ubuntu VM named WEB1 in the webservers resource group`

![Agent VM execution screenshot](docs/images/agent-vm-execution.png)

**What's happening:** The agent plans and executes dependencies in sequence: **VNet/Subnet → NIC → VM**.

## Architecture

```
Browser (React + MSAL.js)
    │
    │  HTTPS
    ▼
Node.js / Express (Azure App Service)
    ├── /api/chat          — LLM classification + streaming synthesis (Claude/OpenAI)
    ├── /api/agent/run     — Agentic loop with SSE streaming
    └── /api/shell/*       — Azure Management REST API proxy
    │
    ├── Anthropic Claude API or OpenAI API
    └── Azure Management API (management.azure.com)
         └── authenticated with the user's delegated token
```

The backend is a thin proxy — it validates your Entra ID token on every request, substitutes session context (subscription ID, resource group) into generated REST calls, and forwards them to Azure using your access token. No Azure credentials are stored on the server.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Auth | MSAL.js v2 (`@azure/msal-browser`) |
| Backend | Node.js, Express, TypeScript |
| LLM | Anthropic Claude or OpenAI ChatGPT (user-selectable per settings) |
| Azure API | Azure Management REST API (`management.azure.com`) |

## Prerequisites

- Node.js 20+
- An Azure subscription
- An **Entra ID App Registration** configured as a SPA with `Azure Service Management` → `user_impersonation` permission
- An Anthropic API key and/or an OpenAI API key

## Setup

### 1. Entra ID App Registration

In the Azure Portal:

1. Go to **Entra ID** → **App registrations** → **New registration**
2. Set the redirect URI to `http://localhost:5173` (platform: **Single-page application**)
3. Under **API permissions**, add: `Azure Service Management` → `user_impersonation`
4. Note your **Application (client) ID** and **Directory (tenant) ID**

### 2. Environment Variables

**`server/.env`**
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
AZURE_CLIENT_ID=<your-app-registration-client-id>
AZURE_TENANT_ID=<your-tenant-id>
PORT=3001
```

**`client/.env`**
```
VITE_AZURE_CLIENT_ID=<your-app-registration-client-id>
VITE_AZURE_TENANT_ID=<your-tenant-id>
```

### 3. Install and Run

```bash
# Install root workspace dependencies
npm install

# Start both client and server (from repo root)
npm run dev
```

Or start them separately:

```bash
# Terminal 1 — backend
cd server && npm run dev

# Terminal 2 — frontend
cd client && npm run dev
```

The app will be available at `http://localhost:5173`.

## Project Structure

```
cloudshell-llm/
├── client/                      # React frontend
│   └── src/
│       ├── components/
│       │   ├── AgentView.tsx    # Live step-by-step agent progress
│       │   ├── ChatInput.tsx
│       │   ├── CommandPreview.tsx   # Action description + REST endpoint display
│       │   ├── OutputView.tsx   # Raw JSON output view
│       │   ├── PlanPreview.tsx
│       │   ├── ProvisioningTracker.tsx  # Async operation polling UI
│       │   ├── SessionStatus.tsx
│       │   └── SynthesisView.tsx    # Streaming markdown response + raw data toggle
│       ├── hooks/
│       │   ├── useAuth.ts       # MSAL authentication
│       │   ├── useChat.ts       # Chat history + agent/synthesis stream handling
│       │   ├── useCloudShell.ts # Azure REST API execution
│       │   └── useSettings.ts   # User settings (load/save)
│       └── services/
│           └── api.ts           # HTTP + SSE client (agent stream, synthesis stream)
│
├── server/                      # Node.js backend
│   └── src/
│       ├── middleware/
│       │   ├── auth.ts          # Entra ID token validation
│       │   └── rateLimit.ts
│       ├── routes/
│       │   ├── agent.ts         # POST /api/agent/run (SSE)
│       │   ├── chat.ts          # POST /api/chat, POST /api/chat/synthesize (SSE)
│       │   ├── settings.ts      # GET/POST /api/settings
│       │   └── shell.ts         # POST /api/shell/execute, /poll, etc.
│       └── services/
│           ├── agent.ts         # Agentic loop (async generator)
│           ├── cloudShell.ts    # Azure REST API client + async polling
│           ├── llm.ts           # Provider-agnostic command generation + synthesis
│           ├── llmProvider.ts   # Claude/OpenAI provider adapters + validation
│           ├── sessionStore.ts  # In-memory session state per user
│           └── settingsStore.ts # Per-user settings persistence (JSON file)
│
└── shared/
    └── types.ts                 # Shared TypeScript interfaces
```

## The Agent

For complex tasks requiring multiple interdependent resources, the app uses an agentic loop rather than a pre-generated plan:

1. The selected provider classifies the request as `type: "agent"` and passes the goal to the agent endpoint
2. The agent calls the selected provider repeatedly in a loop: *"given the goal and what has happened so far, what is the next single API call?"*
3. Each step's real output (including Azure resource IDs) is passed back to the model before the next step — so the VM creation step can reference the actual NIC resource ID that was just created
4. If a step fails, the error is passed back as context so the model can attempt recovery (e.g. a 404 on a GET means the resource doesn't exist and needs to be created)
5. When the goal is achieved, the model responds with `action: "done"` and a plain-English summary

The agent handles up to 12 steps and stops after 3 consecutive failures.

## Configuration

User settings are available via the gear icon in the top-right corner and are persisted per Entra ID user in `server/data/settings.json` (excluded from source control).

| Setting | Description |
|---------|-------------|
| **Require confirmation** | When enabled, shows an approval prompt before running any command. When disabled, read and modify commands auto-execute. Destructive commands (DELETE, purge) always require explicit typed confirmation regardless of this setting. |
| **Default resource group** | Pre-fills the `{resourceGroup}` placeholder in all Azure REST API calls. Useful when most of your work targets a single resource group. |
| **LLM provider** | Choose whether Anthropic Claude or OpenAI ChatGPT powers command generation, synthesis, and the agent loop. |
| **Model** | Select a curated model from the chosen provider (provider-specific dropdown). |

## Security Notes

- User access tokens are held in memory only — never written to disk or logged
- The backend validates every request against Entra ID (signature, audience, issuer, expiry)
- All Azure API calls use the user's delegated token; the server has no Azure credentials of its own
- The poll endpoint only accepts `management.azure.com` URLs to prevent SSRF
- Rate limiting is applied per user on all shell and chat endpoints
