# CLAUDE.md — CloudShell LLM

## Project Overview

CloudShell LLM is a web application that provides a natural language interface to Azure. Instead of memorizing CLI commands, users type what they want to do in plain English and the system translates their intent into valid Azure CLI commands (for display) and Azure Management REST API calls (for actual execution). Commands run directly against `management.azure.com` using the user's authenticated MSAL bearer token — no local tooling, no Cloud Shell session required.

The user authenticates via Microsoft Entra ID (Azure AD). Their security context (RBAC roles, conditional access policies) is inherited directly by the REST API calls, so permissions are enforced identically to native Azure tooling.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│                     React + MSAL.js                         │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  Auth UI  │  │  Chat / NL   │  │  Command Confirmation │  │
│  │  (Login)  │  │  Input Panel │  │  + Output Display     │  │
│  └──────────┘  └──────────────┘  └───────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────────┐
│                        BACKEND                              │
│               Node.js + Express on Azure App Service        │
│                                                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Session Manager  │  │  LLM Service │  │  Azure REST    │  │
│  │ (subscription    │  │  (Anthropic  │  │  Proxy (calls  │  │
│  │  context cache)  │  │   Claude API)│  │  mgmt API)     │  │
│  └─────────────────┘  └──────────────┘  └────────────────┘  │
└────────┬──────────────────────┬─────────────────┬───────────┘
         │                      │                 │
         ▼                      ▼                 ▼
   ┌──────────┐         ┌────────────┐    ┌──────────────────┐
   │ Entra ID │         │ Claude API │    │ Azure Management │
   │ (OAuth2/ │         │ (Anthropic)│    │ REST API         │
   │  OIDC)   │         └────────────┘    │ (management.     │
   └──────────┘                           │  azure.com)      │
                                          └──────────────────┘
```

## How It Works

1. User authenticates with Entra ID via MSAL.js (PKCE flow). An access token scoped to `https://management.azure.com/.default` is obtained.
2. On authentication, the frontend automatically calls `POST /api/shell/provision`, which fetches the user's subscription info from the Azure Management API and caches it server-side (no manual "connect" step).
3. User types a natural language request. The backend sends it to Claude along with session context (subscription ID, resource group).
4. Claude returns **two things**: an `az` CLI command (shown in the UI for transparency) and an Azure Management REST API spec (`rest_method`, `rest_url`, `rest_body`) for actual execution.
5. The frontend displays the `az` command with a risk badge and prompts for user confirmation.
6. On approval, the backend executes the REST API call against `management.azure.com` using the user's bearer token. No local `az` CLI, no Cloud Shell WebSocket.
7. Results are returned as formatted JSON, displayed in the UI, and appended to the conversation context.

## Why Not Azure Cloud Shell?

Azure's Cloud Shell provisioning API (`management.azure.com/providers/Microsoft.Portal/consoles`) validates the `appid` JWT claim and only permits whitelisted Microsoft first-party client IDs. Custom Entra ID app registrations receive a `ClientNotAllowed` (400) error regardless of API version. This is a hard Microsoft platform restriction with no workaround for third-party apps.

The direct REST API approach is actually superior for this use case:
- No WebSocket lifecycle complexity or idle session timeouts
- Fully deployable to any hosted environment — no `az` CLI required on the server
- User's Azure RBAC is enforced natively — the backend never injects its own credentials
- Works immediately after authentication with no provisioning delay

## Tech Stack

### Frontend
- **React** with **Vite** + `@vitejs/plugin-react-swc` (SWC-based, avoids Babel/Node 20 conflicts)
- **TypeScript** throughout
- **MSAL.js v2** (`@azure/msal-browser`) for Entra ID authentication
- **xterm.js v5** (`@xterm/xterm`, `@xterm/addon-fit`) for output display
- **Tailwind CSS v3** for styling

### Backend
- **Node.js** with **Express**
- **TypeScript** throughout (CommonJS, ts-node — no `.js` extensions in imports)
- **@anthropic-ai/sdk** for Claude API calls
- **jsonwebtoken** + **jwks-rsa** for JWT validation
- Native `fetch` for Azure Management REST API calls (no Azure SDK needed)

### Infrastructure
- **Azure App Service** (backend hosting)
- **Azure Static Web Apps** or **App Service** (frontend hosting)
- **Entra ID App Registration** (OAuth2 client)
- **Azure Management REST API** (`management.azure.com`) — command execution target

## Authentication Flow

1. User clicks "Sign In" in the React frontend.
2. MSAL.js initiates an OAuth2 authorization code flow with PKCE against Entra ID.
3. Requested scopes:
   - `openid`, `profile`, `email` (standard OIDC)
   - `https://management.azure.com/.default` (Azure Management API)
4. On success, MSAL.js stores tokens in session storage.
5. Frontend sends the access token to the backend on each request via `Authorization: Bearer <token>` header.
6. Backend validates the token (signature, audience, issuer, expiry) before processing any request.
7. The same token is forwarded to `management.azure.com` for actual command execution — the backend acts as a proxy, never substituting its own credentials.

### Entra ID App Registration Requirements
- **Redirect URI**: `http://localhost:5173` (dev), production URL (prod)
- **Platform**: SPA (not web — this enables PKCE)
- **API Permissions**: `Azure Service Management` → `user_impersonation`
- **Supported account types**: Single tenant or multi-tenant

### JWT Validation Notes
- Token audience: `https://management.azure.com` (no trailing slash) — validate against both `https://management.azure.com` and `https://management.azure.com/` (trailing slash variant)
- Issuer: `https://sts.windows.net/<tenant-id>/`
- Algorithm: RS256; keys fetched from `https://login.microsoftonline.com/common/discovery/v2.0/keys`

## LLM Integration (Claude API)

### What Claude Generates
Claude returns a single JSON object containing both the display command and the execution spec:

```json
{
  "command": "az network nsg list --resource-group myRG -o table",
  "description": "Lists all network security groups in the 'myRG' resource group",
  "risk_level": "read",
  "rest_method": "GET",
  "rest_url": "https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/myRG/providers/Microsoft.Network/networkSecurityGroups?api-version=2023-09-01",
  "rest_body": null
}
```

Or a clarification when intent is ambiguous:
```json
{ "clarification": "Which resource group would you like to list NSGs from?" }
```

### System Prompt Design

The system prompt instructs Claude to:
1. Generate a valid `az` CLI command for display (user transparency).
2. Generate the equivalent Azure Management REST API spec for actual execution.
3. Use `{subscriptionId}` and `{resourceGroup}` as URL placeholders — the backend substitutes real values from the session store.
4. Ask clarifying questions rather than guessing when intent is ambiguous.
5. Classify commands by risk level: `read`, `modify`, or `destructive`.
6. Never generate destructive operations without explicit user intent.

```
You are an Azure CLI assistant. Translate natural language into Azure CLI commands and their equivalent Azure Management REST API calls.

Respond ONLY with a JSON object in this exact format:
{
  "command": "<az cli command for display>",
  "description": "<one-line explanation>",
  "risk_level": "read|modify|destructive",
  "rest_method": "GET|POST|PUT|PATCH|DELETE",
  "rest_url": "<full management.azure.com URL with api-version, use {subscriptionId} and {resourceGroup} as placeholders>",
  "rest_body": <JSON body object or null>
}

If the request is ambiguous, respond ONLY with:
{ "clarification": "<your question>" }

Rules:
- Never generate destructive operations unless explicitly requested.
- Use {subscriptionId} and {resourceGroup} as URL placeholders.
- Always include the correct api-version query parameter.
- risk_level "destructive" = any DELETE or purge operation.
- risk_level "modify" = POST/PUT/PATCH that creates or changes resources.
- risk_level "read" = GET operations only.

Current session context:
- Active subscription: {{subscription_name}} ({{subscription_id}})
- Default resource group: {{resource_group}} (if set)
```

### Model
- `claude-sonnet-4-6` — speed/cost balance for interactive use

### LLM Request/Response Flow
1. User input (natural language) → `POST /api/chat`
2. Backend constructs messages array: system prompt (with session context) + conversation history + new user message
3. Call Claude API, parse JSON response
4. If `clarification`: return to frontend, display as assistant message, loop
5. If `command`: return full spec (`command`, `description`, `risk_level`, `rest_method`, `rest_url`, `rest_body`) to frontend for confirmation

## Command Safety Tiers

| Risk Level    | Behavior                               | Examples                                         |
|--------------|----------------------------------------|--------------------------------------------------|
| `read`       | Execute after brief display            | `az vm list`, `az account show`                  |
| `modify`     | Require explicit user approval         | `az vm start`, `az network nsg create`           |
| `destructive`| Require typed confirmation             | `az group delete`, `az vm delete`                |

## REST API Execution

The backend's `executeRestCall` function in `server/src/services/cloudShell.ts`:
1. Substitutes `{subscriptionId}` and `{resourceGroup}` placeholders with values from the user's cached session.
2. Calls the Azure Management REST API using the user's bearer token from the JWT (`req.user.accessToken`).
3. Unwraps `{ value: [...] }` envelope responses for cleaner list output.
4. Returns prettified JSON string.

```typescript
export async function executeRestCall(
  accessToken: string,
  method: string,
  url: string,
  subscriptionId?: string,
  resourceGroup?: string,
  body?: Record<string, unknown>
): Promise<string> {
  const resolvedUrl = url
    .replace(/\{subscriptionId\}/g, subscriptionId ?? '')
    .replace(/\{resourceGroup\}/g, resourceGroup ?? '');

  const response = await fetch(resolvedUrl, {
    method: method.toUpperCase(),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  const result = (data as { value?: unknown })?.value ?? data;
  return JSON.stringify(result, null, 2);
}
```

## Project Structure

```
cloudshell-llm/
├── CLAUDE.md                     # This file
├── README.md
├── package.json                  # Root workspace config (npm workspaces)
│
├── client/                       # React frontend
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts            # @vitejs/plugin-react-swc; proxy /api → :3001
│   ├── index.html
│   └── src/
│       ├── main.tsx              # Entry point; MsalProvider; imports xterm CSS before index.css
│       ├── App.tsx               # Root component; auto-provisions on auth; handleApprove calls execute()
│       ├── config/
│       │   └── authConfig.ts     # MSAL config (client ID, authority, scopes)
│       ├── components/
│       │   ├── LoginButton.tsx
│       │   ├── ChatInput.tsx
│       │   ├── CommandPreview.tsx # Shows az command + risk badge; approve/reject buttons
│       │   ├── TerminalOutput.tsx # xterm.js wrapper for output display
│       │   ├── SessionStatus.tsx  # Shows subscription name; auto-connects (no manual button)
│       │   └── RiskBadge.tsx
│       ├── hooks/
│       │   ├── useAuth.ts        # MSAL hook (getToken, isAuthenticated, user)
│       │   ├── useCloudShell.ts  # provision/execute/disconnect/refreshStatus via REST
│       │   └── useChat.ts        # Chat history, LLM state; pendingCommand includes REST fields
│       ├── services/
│       │   └── api.ts            # HTTP client; executeCommand(token, rest_method, rest_url, rest_body)
│       └── types/
│           └── index.ts
│
├── server/                       # Node.js backend
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              # Express app; CORS for :5173; routes under /api
│       ├── middleware/
│       │   ├── auth.ts           # JWT validation (jwks-rsa + jsonwebtoken); attaches user + accessToken
│       │   └── rateLimit.ts      # Per-user rate limiting
│       ├── routes/
│       │   ├── shell.ts          # /provision, /execute, /status, DELETE /session
│       │   └── chat.ts           # POST /chat → LLM → command or clarification
│       ├── services/
│       │   ├── cloudShell.ts     # getSubscriptionInfo(), executeRestCall()
│       │   ├── llm.ts            # Claude API; generates az command + REST spec; imports ShellSession from sessionStore
│       │   └── sessionStore.ts   # In-memory Map<userId, ShellSession> (subscription context only, no WebSocket)
│       └── types/
│           └── index.ts          # AuthenticatedUser, AuthenticatedRequest
│
└── shared/                       # Shared types between client and server
    └── types.ts
```

## Shared TypeScript Interfaces

```typescript
// shared/types.ts

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface GeneratedCommand {
  command: string;           // az CLI command — displayed to user for transparency
  description: string;
  risk_level: 'read' | 'modify' | 'destructive';
  rest_method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';  // used for actual execution
  rest_url: string;          // full management.azure.com URL with {subscriptionId}/{resourceGroup} placeholders
  rest_body?: Record<string, unknown>;
}

export interface ClarificationRequest {
  clarification: string;
}

export type LLMResponse = GeneratedCommand | ClarificationRequest;

export interface SessionState {
  isConnected: boolean;
  subscriptionName?: string;
  subscriptionId?: string;
  defaultResourceGroup?: string;
}
```

## API Endpoints

### POST /api/chat
Sends a natural language message to Claude and returns a generated command or clarification.

**Request:**
```json
{
  "message": "show me all VMs in the dev resource group",
  "history": []
}
```

**Response (command):**
```json
{
  "type": "command",
  "command": "az vm list --resource-group dev -o table",
  "description": "Lists all virtual machines in the 'dev' resource group",
  "risk_level": "read",
  "rest_method": "GET",
  "rest_url": "https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/dev/providers/Microsoft.Compute/virtualMachines?api-version=2023-09-01",
  "rest_body": null
}
```

**Response (clarification):**
```json
{
  "type": "clarification",
  "message": "Which resource group would you like to list VMs from?"
}
```

### POST /api/shell/provision
Fetches the user's Azure subscription info using their bearer token and caches it in the in-memory session store. Called automatically on authentication — no manual trigger needed. Returns immediately if a session already exists.

**Response:**
```json
{
  "status": "connected",
  "subscriptionId": "...",
  "subscriptionName": "My Subscription"
}
```

### POST /api/shell/execute
Executes an Azure Management REST API call using the user's token. The backend substitutes `{subscriptionId}` and `{resourceGroup}` from the cached session.

**Request:**
```json
{
  "rest_method": "GET",
  "rest_url": "https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/dev/providers/Microsoft.Compute/virtualMachines?api-version=2023-09-01"
}
```

**Response:**
```json
{
  "output": "[\n  { \"name\": \"my-vm\", ... }\n]",
  "executedAt": 1234567890
}
```

### GET /api/shell/status
Returns the current session state from the in-memory cache (subscription info).

### DELETE /api/shell/session
Clears the in-memory session for the authenticated user.

## Environment Variables

```
# server/.env
ANTHROPIC_API_KEY=sk-ant-...
AZURE_CLIENT_ID=<app-registration-client-id>
AZURE_TENANT_ID=<your-tenant-id>
PORT=3001

# client/.env
VITE_AZURE_CLIENT_ID=<app-registration-client-id>
VITE_AZURE_TENANT_ID=<your-tenant-id>
```

## Development Workflow

### Prerequisites
- Node.js 20+ (tested on 20.6+; use `@vitejs/plugin-react-swc@3` for Node < 20.19)
- An Azure subscription with an Entra ID App Registration
- An Anthropic API key

### Running Locally
```bash
# From repo root
npm install

# Terminal 1 — backend (port 3001)
cd server && npm run dev

# Terminal 2 — frontend (port 5173)
cd client && npm run dev
```

Frontend at `http://localhost:5173` — all `/api` requests proxied to `:3001`.

### Key Implementation Notes

- **No `.js` extensions in server imports** — ts-node with CommonJS doesn't resolve them; use bare relative paths.
- **SWC not Babel** — `@vitejs/plugin-react-swc` avoids the `Cannot redefine property: File` error on Node 20.6 caused by Babel.
- **xterm CSS** — import `@xterm/xterm/css/xterm.css` in `main.tsx` before `./index.css`, not inside a CSS file (Tailwind's `@tailwind` directives must come first in CSS files).
- **JWT audience** — validate against both `https://management.azure.com` and `https://management.azure.com/` (trailing slash varies by token issuer).
- **Auto-provision** — `App.tsx` calls `provision()` in a `useEffect` when `isAuthenticated` becomes true; `SessionStatus` shows a pulsing indicator while provisioning, then the subscription name when ready.
- **ShellSession import** — `llm.ts` imports `ShellSession` from `./sessionStore`, not from `../types/index`.
- **Conversation context** — command outputs (truncated to 500 chars) are appended to chat history so Claude can reference previous results (e.g., "stop the second one").

### Testing Strategy
- **Unit tests**: LLM response parsing, command risk classification, JWT validation logic.
- **Integration tests**: Mock `fetch` to stub Azure Management API responses and test the full command lifecycle.
- **Manual E2E**: Test with a real Azure subscription (use a sandbox subscription with limited resources).

## Future Enhancements (Out of Scope for MVP)
- Streaming output display.
- Multi-subscription switching within a session.
- Default resource group selection in UI.
- Command history search and replay.
- Cost estimation before provisioning commands.
- Voice input for natural language commands.
