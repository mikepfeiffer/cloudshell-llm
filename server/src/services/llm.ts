import Anthropic from '@anthropic-ai/sdk';
import { ChatMessage, LLMResponse, PlanStep, AgentGoal } from '../../../shared/types';
import { ShellSession } from './sessionStore';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_HISTORY = 15;

function buildSystemPrompt(session: ShellSession | undefined): string {
  const subscription = session?.subscriptionName
    ? `${session.subscriptionName} (${session.subscriptionId})`
    : 'Unknown';
  const resourceGroup = session?.defaultResourceGroup ?? 'Not set';

  return `You are an Azure command generator. Your ONLY job is to translate natural language requests into Azure Management REST API calls.

Rules:
1. Respond ONLY with a JSON object in this exact format:
   {
     "command": "<the equivalent az CLI command, for display only>",
     "description": "<one-line explanation of what this does>",
     "risk_level": "read|modify|destructive",
     "rest_method": "GET|POST|PUT|PATCH|DELETE",
     "rest_url": "https://management.azure.com/...",
     "rest_body": {}
   }
   Omit "rest_body" for GET and DELETE requests.

2. If the request is ambiguous, respond with:
   {"clarification": "<your question to the user>"}

3. For rest_url, use these exact placeholder strings which will be substituted at runtime:
   - {subscriptionId} for the subscription ID
   - {resourceGroup} for the default resource group (only when a resource group is known)
   Always include the api-version query parameter.

4. risk_level rules:
   - "read" for GET requests
   - "modify" for POST, PUT, PATCH (create, update, start, stop, restart)
   - "destructive" for DELETE or any operation that purges/removes resources permanently

5. Never generate DELETE or purge operations unless the user explicitly and specifically requests deletion.

6. Never generate operations that modify IAM roles, policy assignments, or Entra ID configurations unless explicitly requested.

7. Common API versions to use:
   - Virtual Machines: 2023-03-01
   - Resource Groups: 2021-04-01
   - Storage Accounts: 2023-01-01
   - App Services: 2022-03-01
   - Key Vault: 2023-02-01
   - Subscriptions: 2022-12-01
   - Network: 2023-05-01
   - AKS: 2023-08-01
   - Container Registry: 2023-07-01

8. For questions asking about counts, aggregations, or that need a conversational answer (e.g. "how many X do I have?", "what are all my Y?", "do I have any Z?"), add "synthesize": true to your single-command response. This causes the results to be summarized in plain English after execution.

9. Use a plan whenever multiple sequential API calls are required — both for read queries AND for resource creation with dependencies:
   - Read/aggregation examples: "compare X across resource groups", "which resource group has the most VMs"
   - Creation examples: creating a VM (must create NIC first), creating an AKS cluster (may need subnet), etc.

   For VM creation, ALWAYS use a plan with these steps in order:
   a. Create the network interface (NIC) — PUT .../networkInterfaces/<name>
   b. Create the virtual machine — PUT .../virtualMachines/<name>, referencing the NIC by its full resource ID

   The NIC step must include a valid subnet reference. If the user has not specified a VNet/subnet, use a sensible default (e.g. ask for clarification, or use "default"/"default" as VNet/subnet names).

   Plan format:
   {
     "type": "plan",
     "description": "<overall description of what this plan does>",
     "risk_level": "read|modify|destructive",
     "synthesize": true,
     "steps": [
       {
         "command": "<az cli command for display>",
         "description": "<what this step does>",
         "rest_method": "GET|POST|PUT|PATCH|DELETE",
         "rest_url": "https://management.azure.com/...",
         "rest_body": {}
       }
     ]
   }
   Keep plans to a maximum of 3 steps. Only use plans when multiple API calls are truly necessary.

10. For tasks that require creating or configuring multiple interdependent Azure resources (e.g. "create a VM", "deploy an AKS cluster", "set up a web app with a database"), respond with:
    { "type": "agent", "goal": "<restate the user's goal clearly and completely>", "description": "<one sentence: what the agent will do>" }
    The agent will check prerequisites, create each resource in the correct dependency order, and wait for each to fully provision before proceeding. Use this any time the correct sequence of steps depends on what already exists in the environment.

Current session context:
- Active subscription: ${subscription}
- Subscription ID: ${session?.subscriptionId ?? 'unknown'}
- Default resource group: ${resourceGroup}`;
}

export async function generateCommand(
  message: string,
  history: ChatMessage[],
  session: ShellSession | undefined
): Promise<LLMResponse | AgentGoal> {
  const systemPrompt = buildSystemPrompt(session);
  const recentHistory = history.slice(-MAX_HISTORY);

  const messages: Anthropic.MessageParam[] = recentHistory.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.content,
  }));
  messages.push({ role: 'user', content: message });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/);

  if (!jsonMatch) {
    return { clarification: 'I could not understand that request. Could you rephrase it?' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]) as Record<string, unknown>;

    if ('clarification' in parsed) {
      return { clarification: parsed.clarification as string };
    }

    if (parsed.type === 'agent' && parsed.goal) {
      return {
        type: 'agent',
        goal: parsed.goal as string,
        description: (parsed.description as string) ?? '',
      };
    }

    if (parsed.type === 'plan' && Array.isArray(parsed.steps)) {
      return {
        type: 'plan',
        description: (parsed.description as string) ?? '',
        risk_level: (parsed.risk_level as 'read' | 'modify' | 'destructive') ?? 'read',
        steps: parsed.steps as PlanStep[],
        synthesize: true,
      };
    }

    if ('command' in parsed && 'rest_method' in parsed && 'rest_url' in parsed) {
      return {
        command: parsed.command as string,
        description: (parsed.description as string) ?? '',
        risk_level: (parsed.risk_level as 'read' | 'modify' | 'destructive') ?? 'read',
        rest_method: parsed.rest_method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        rest_url: parsed.rest_url as string,
        rest_body: parsed.rest_body as Record<string, unknown> | undefined,
        synthesize: parsed.synthesize === true,
      };
    }
  } catch {
    // Fall through
  }

  return { clarification: 'I could not generate a valid command. Could you rephrase your request?' };
}

export async function synthesizeResults(
  originalQuestion: string,
  results: Array<{ command: string; output: string }>
): Promise<string> {
  const resultsText = results
    .map(({ command, output }) => `Command: ${command}\nOutput:\n${output.slice(0, 20000)}`)
    .join('\n\n---\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system:
      'You are a helpful Azure assistant. The user asked a question, Azure API calls were executed, and you must summarize the results conversationally. Be concise and direct. Answer the question first, then provide relevant details. Use plain text — no JSON, no markdown code blocks, no bullet points unless listing items naturally. Write in a friendly, informative tone.',
    messages: [
      {
        role: 'user',
        content: `The user asked: "${originalQuestion}"\n\nHere are the Azure API results:\n\n${resultsText}\n\nAnswer the user's question conversationally based on these results.`,
      },
    ],
  });

  return response.content[0].type === 'text'
    ? response.content[0].text
    : 'I was unable to summarize the results.';
}
