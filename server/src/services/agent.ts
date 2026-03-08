import Anthropic from '@anthropic-ai/sdk';
import { ShellSession } from './sessionStore';
import { executeRestCall, pollAsyncOperation } from './cloudShell';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_STEPS = 12;
const MAX_CONSECUTIVE_ERRORS = 3;
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 75;

export type AgentEvent =
  | { type: 'step_start'; stepIndex: number; description: string; command: string }
  | { type: 'step_done'; stepIndex: number; output: string }
  | { type: 'step_error'; stepIndex: number; error: string }
  | { type: 'done'; summary: string }
  | { type: 'clarify'; message: string }
  | { type: 'error'; message: string };

interface AgentAction {
  action: 'execute' | 'done' | 'clarify';
  description?: string;
  command?: string;
  rest_method?: string;
  rest_url?: string;
  rest_body?: Record<string, unknown>;
  summary?: string;
  message?: string;
}

interface StepRecord {
  description: string;
  command: string;
  output: string;
  failed?: boolean;
}

function buildSystemPrompt(session: ShellSession | undefined): string {
  const subscription = session?.subscriptionName
    ? `${session.subscriptionName} (${session.subscriptionId})`
    : 'Unknown';

  return `You are an Azure infrastructure agent. You achieve user goals by executing Azure Management REST API calls one step at a time.

At each turn you receive the original goal and a history of steps already executed (including their outputs or errors). Respond with exactly one JSON action — no other text.

ACTIONS:

1. Execute a REST call:
{"action":"execute","description":"<shown to user>","command":"<az CLI equivalent, display only>","rest_method":"GET|POST|PUT|PATCH|DELETE","rest_url":"https://management.azure.com/...","rest_body":{}}

2. Request clarification from the user:
{"action":"clarify","message":"<your question>"}

3. Signal that the goal is complete:
{"action":"done","summary":"<conversational summary of what was accomplished>"}

RULES:
- Use actual resource IDs and names from previous step outputs when referencing resources in subsequent steps.
- Before creating a resource, check if it exists with a GET. If the GET returns NOT_FOUND, create it.
- For VM creation, always follow this order: check VNet → check/create subnet → create NIC → create VM.
- The NIC resource ID must appear verbatim in the VM body's networkProfile.networkInterfaces[].id.
- Use {subscriptionId} as a placeholder in REST URLs — it is substituted at runtime. Never hardcode subscription IDs in URLs.
- Always include api-version. Common versions: VMs 2023-03-01, Network 2023-05-01, Storage 2023-01-01, AKS 2023-08-01, Resource Groups 2021-04-01.
- For location, use the same region as the resource group unless the user specifies otherwise.
- If a step fails with an error, analyze the error and try a corrective action. Do not repeat the exact same failed call.
- When all required resources are created and confirmed, respond with "done".

CURRENT SESSION:
- Active subscription: ${subscription}
- Subscription ID: ${session?.subscriptionId ?? 'unknown'}
- Default resource group: ${session?.defaultResourceGroup ?? 'Not set'}`;
}

async function waitForPoll(accessToken: string, pollUrl: string): Promise<void> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await pollAsyncOperation(accessToken, pollUrl);
    if (result.status === 'Succeeded') return;
    if (result.status === 'Failed' || result.status === 'Canceled') {
      throw new Error(`Operation ${result.status.toLowerCase()}${result.error ? ': ' + result.error : ''}`);
    }
  }
  throw new Error('Operation timed out after ~5 minutes');
}

export async function* runAgentLoop(
  goal: string,
  session: ShellSession | undefined,
  accessToken: string,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const systemPrompt = buildSystemPrompt(session);
  const stepHistory: StepRecord[] = [];
  const messages: Anthropic.MessageParam[] = [];
  let consecutiveErrors = 0;

  for (let stepIndex = 0; stepIndex < MAX_STEPS; stepIndex++) {
    if (signal?.aborted) break;

    const historyText =
      stepHistory.length === 0
        ? 'No steps executed yet.'
        : stepHistory
            .map(
              (s, i) =>
                `Step ${i + 1}${s.failed ? ' [FAILED]' : ''}: ${s.description}\n` +
                `Command: ${s.command}\n` +
                `Output:\n${s.output.slice(0, 8000)}`
            )
            .join('\n\n---\n\n');

    messages.push({
      role: 'user',
      content: `Goal: ${goal}\n\nStep history:\n${historyText}\n\nWhat is the next action?`,
    });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    messages.push({ role: 'assistant', content: text });

    // Extract JSON: prefer fenced code block, otherwise find outermost { ... }
    let jsonText: string | null = null;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) {
      jsonText = codeBlock[1];
    } else {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) jsonText = text.slice(start, end + 1);
    }

    if (!jsonText) {
      yield { type: 'error', message: 'Agent returned an unparseable response.' };
      return;
    }

    let action: AgentAction;
    try {
      action = JSON.parse(jsonText) as AgentAction;
    } catch {
      yield { type: 'error', message: 'Agent returned invalid JSON.' };
      return;
    }

    if (action.action === 'clarify') {
      yield { type: 'clarify', message: action.message ?? 'Need more information.' };
      return;
    }

    if (action.action === 'done') {
      yield { type: 'done', summary: action.summary ?? 'Done.' };
      return;
    }

    if (action.action === 'execute') {
      const description = action.description ?? 'Executing step';
      const command = action.command ?? '';
      yield { type: 'step_start', stepIndex, description, command };

      try {
        const result = await executeRestCall(
          accessToken,
          action.rest_method ?? 'GET',
          action.rest_url ?? '',
          session?.subscriptionId,
          session?.defaultResourceGroup,
          action.rest_body
        );

        if (result.pollUrl) {
          await waitForPoll(accessToken, result.pollUrl);
        }

        yield { type: 'step_done', stepIndex, output: result.output };
        stepHistory.push({ description, command, output: result.output });
        consecutiveErrors = 0;
      } catch (err) {
        const errMsg = (err as Error).message ?? 'Unknown error';
        yield { type: 'step_error', stepIndex, error: errMsg };
        // Pass the error back to the LLM as context so it can attempt recovery
        stepHistory.push({ description, command, output: `ERROR: ${errMsg}`, failed: true });
        consecutiveErrors++;

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          yield {
            type: 'error',
            message: `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive failures. Last error: ${errMsg}`,
          };
          return;
        }
      }
    }
  }

  yield { type: 'error', message: 'Agent reached the maximum step limit without completing the goal.' };
}
