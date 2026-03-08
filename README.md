# CloudShell LLM

A natural language interface for managing Azure resources. Describe what you want to do in plain English — no commands, no syntax, no CLI knowledge required. The app translates your intent into Azure Management REST API calls, executes them using your own Azure identity, and returns conversational results.

![CloudShell LLM](https://img.shields.io/badge/Azure-Management_API-0078d4?style=flat&logo=microsoftazure) ![Claude](https://img.shields.io/badge/Anthropic-Claude-black?style=flat) ![React](https://img.shields.io/badge/React-TypeScript-61dafb?style=flat&logo=react)

## How It Works

1. You authenticate with your Microsoft Entra ID (Azure AD) account via the browser
2. You type a natural language request: *"create an Ubuntu VM named WEB1 in the webservers resource group"*
3. Claude classifies your request and chooses the right execution mode:
   - **Direct query** — a single Azure REST API call (e.g. list VMs, show a resource group)
   - **Synthesized query** — a query where the result is summarized in plain English (e.g. "how many resource groups do I have?")
   - **Agent** — a multi-step task where dependencies must be checked and created in the correct order (e.g. VM creation, AKS deployment)
4. Queries execute using **your Azure access token** — your RBAC roles and permissions apply exactly as they would in the Azure Portal

## Features

- **Natural language to Azure REST API** — describe what you want, not how to do it
- **Streaming responses** — synthesis answers stream token-by-token as Claude generates them
- **Agentic resource creation** — the agent checks what exists, creates prerequisites in order (VNet → subnet → NIC → VM), waits for each async operation to complete, and uses real resource IDs between steps
- **Conversational synthesis** — aggregation queries return plain-English summaries ("You have 7 resource groups across 3 regions")
- **Raw data access** — every synthesized response includes a collapsible JSON view of the underlying API data
- **Async operation tracking** — long-running operations (storage accounts, VMs) show a live provisioning status indicator
- **Destructive command protection** — delete/purge operations always require explicit typed confirmation
- **Your identity, your permissions** — the backend never injects its own credentials; all API calls use your delegated access token

## Architecture

```
Browser (React + MSAL.js)
    │
    │  HTTPS
    ▼
Node.js / Express (Azure App Service)
    ├── /api/chat          — LLM classification + streaming synthesis (Claude)
    ├── /api/agent/run     — Agentic loop with SSE streaming
    └── /api/shell/*       — Azure Management REST API proxy
    │
    ├── Anthropic Claude API
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
| LLM | Anthropic Claude (`claude-sonnet-4-6`) |
| Azure API | Azure Management REST API (`management.azure.com`) |

## Prerequisites

- Node.js 20+
- An Azure subscription
- An **Entra ID App Registration** configured as a SPA with `Azure Service Management` → `user_impersonation` permission
- An Anthropic API key

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
│       │   └── useCloudShell.ts # Azure REST API execution
│       ├── services/
│       │   └── api.ts           # HTTP + SSE client (agent stream, synthesis stream)
│       └── config/
│           └── appConfig.ts     # Static config (confirmation toggle)
│
├── server/                      # Node.js backend
│   └── src/
│       ├── middleware/
│       │   ├── auth.ts          # Entra ID token validation
│       │   └── rateLimit.ts
│       ├── routes/
│       │   ├── agent.ts         # POST /api/agent/run (SSE)
│       │   ├── chat.ts          # POST /api/chat, POST /api/chat/synthesize (SSE)
│       │   └── shell.ts         # POST /api/shell/execute, /poll, etc.
│       └── services/
│           ├── agent.ts         # Agentic loop (async generator)
│           ├── cloudShell.ts    # Azure REST API client + async polling
│           ├── llm.ts           # Claude integration + streaming synthesis
│           └── sessionStore.ts  # In-memory session state per user
│
└── shared/
    └── types.ts                 # Shared TypeScript interfaces
```

## The Agent

For complex tasks requiring multiple interdependent resources, the app uses an agentic loop rather than a pre-generated plan:

1. Claude classifies the request as `type: "agent"` and passes the goal to the agent endpoint
2. The agent calls Claude repeatedly in a loop: *"given the goal and what has happened so far, what is the next single API call?"*
3. Each step's real output (including Azure resource IDs) is passed back to Claude before the next step — so the VM creation step can reference the actual NIC resource ID that was just created
4. If a step fails, the error is passed back to Claude as context; it can attempt recovery (e.g. a 404 on a GET means the resource doesn't exist and needs to be created)
5. When the goal is achieved, Claude responds with `action: "done"` and a plain-English summary

The agent handles up to 12 steps and stops after 3 consecutive failures.

## Configuration

`client/src/config/appConfig.ts` contains a static configuration flag:

```typescript
export const appConfig = {
  requireConfirmation: false, // set true to show approval UI for all commands
};
```

When `requireConfirmation` is `false`, read and modify commands auto-execute. Destructive commands (DELETE, purge) always require explicit typed confirmation regardless of this setting.

## Security Notes

- User access tokens are held in memory only — never written to disk or logged
- The backend validates every request against Entra ID (signature, audience, issuer, expiry)
- All Azure API calls use the user's delegated token; the server has no Azure credentials of its own
- The poll endpoint only accepts `management.azure.com` URLs to prevent SSRF
- Rate limiting is applied per user on all shell and chat endpoints
