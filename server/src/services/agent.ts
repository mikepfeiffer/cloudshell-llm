import { randomBytes } from 'crypto';
import { ShellSession } from './sessionStore';
import { executeRestCall, pollAsyncOperation } from './cloudShell';
import { ProviderConfig, completeText } from './llmProvider';

const MAX_STEPS = 12;
const MAX_STEPS_VM = 24;
const MAX_CONSECUTIVE_ERRORS = 3;
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 75;
const MAX_STEP_OUTPUT_CHARS = 3000;

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

interface VmRunContext {
  isVmRequest: boolean;
  vmName?: string;
  resourceGroup?: string;
  fromScratch: boolean;
  authMode: 'password' | 'ssh';
  vmSku: string;
  dependencyNames?: {
    vnet: string;
    subnet: string;
    nic: string;
  };
  generatedAdminUsername?: string;
  generatedAdminPassword?: string;
  credentialsApplied: boolean;
  discoveredRegion?: string;
}

function parseVmName(goal: string): string | undefined {
  const named = goal.match(/\bnamed\s+['"]?([a-zA-Z0-9-]+)['"]?/i);
  if (named?.[1]) return named[1];
  const createVm = goal.match(/\b(?:create|deploy|provision)\s+(?:an?\s+)?(?:ubuntu|linux|windows)?\s*vm\s+['"]?([a-zA-Z0-9-]+)['"]?/i);
  if (createVm?.[1]) return createVm[1];
  return undefined;
}

function parseResourceGroup(goal: string): string | undefined {
  const match = goal.match(/\bin\s+(?:the\s+)?([a-zA-Z0-9-_]+)\s+resource\s+group\b/i);
  return match?.[1];
}

function parseVmSku(goal: string): string | undefined {
  const match = goal.match(/\bstandard_[a-z0-9_]+\b/i);
  return match?.[0];
}

function detectAuthMode(goal: string): 'password' | 'ssh' {
  const text = goal.toLowerCase();
  if (text.includes('ssh') || text.includes('public key')) return 'ssh';
  return 'password';
}

function randomSuffix(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

function generateAdminUsername(): string {
  return `azureuser${randomSuffix(4)}`;
}

function generateAdminPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^*_-+=';
  const all = upper + lower + digits + symbols;

  const chars = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  for (let i = chars.length; i < 18; i++) {
    chars.push(all[Math.floor(Math.random() * all.length)]);
  }

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

function buildVmRunContext(goal: string, session: ShellSession | undefined): VmRunContext {
  const lower = goal.toLowerCase();
  const vmIntent =
    (lower.includes('create') || lower.includes('deploy') || lower.includes('provision') || lower.includes('build')) &&
    (lower.includes(' vm') || lower.includes('virtual machine'));

  const vmName = parseVmName(goal);
  const resourceGroup = parseResourceGroup(goal) ?? session?.defaultResourceGroup;
  const authMode = detectAuthMode(goal);
  const fromScratch =
    lower.includes('from scratch') ||
    lower.includes('no existing') ||
    (lower.includes('vnet') && lower.includes('subnet') && lower.includes('nic'));
  const vmSku = parseVmSku(goal) ?? 'Standard_B1ms';

  const ctx: VmRunContext = {
    isVmRequest: vmIntent,
    vmName,
    resourceGroup,
    fromScratch,
    authMode,
    vmSku,
    credentialsApplied: false,
  };

  if (vmName) {
    ctx.dependencyNames = {
      vnet: `${vmName}-vnet`,
      subnet: `${vmName}-subnet`,
      nic: `${vmName}-nic`,
    };
  }

  if (vmIntent && authMode === 'password') {
    ctx.generatedAdminUsername = generateAdminUsername();
    ctx.generatedAdminPassword = generateAdminPassword();
  }

  return ctx;
}

function isRedundantGoalClarification(message?: string): boolean {
  const text = (message ?? '').toLowerCase();
  return text.includes('what is your goal') || text.includes('provide your goal');
}

function isCriticalClarification(message: string, vmCtx: VmRunContext): boolean {
  const text = message.toLowerCase();

  if (text.includes('resource group') && !vmCtx.resourceGroup) return true;
  if (text.includes('subscription')) return true;
  if (text.includes('tenant')) return true;

  // VM-specific defaults handle these safely without user interruption.
  if (vmCtx.isVmRequest) {
    if (text.includes('region') || text.includes('location')) return false;
    if (text.includes('vnet') || text.includes('subnet') || text.includes('nic')) return false;
    if (text.includes('username') || text.includes('password') || text.includes('credential')) return false;
    if (text.includes('sku') || text.includes('size')) return false;
  }

  return false;
}

function isRecoverableNotFoundError(restMethod: string | undefined, errorMessage: string): boolean {
  if ((restMethod ?? 'GET').toUpperCase() !== 'GET') return false;
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('resourcenotfound') ||
    msg.includes('resourcegroupnotfound')
  );
}

function extractLocationFromOutput(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as { location?: string };
    if (typeof parsed?.location === 'string' && parsed.location.length > 0) {
      return parsed.location;
    }
  } catch {
    // ignore non-JSON output
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeVmBodyForArm(
  body: Record<string, unknown>,
  vmCtx: VmRunContext
): Record<string, unknown> {
  const top = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const existingProps = asObject(top.properties);

  const hardwareProfile = {
    ...asObject(existingProps.hardwareProfile),
    ...asObject(top.hardwareProfile),
  };
  if (!hardwareProfile.vmSize) {
    hardwareProfile.vmSize = vmCtx.vmSku;
  }

  const osProfile = {
    ...asObject(existingProps.osProfile),
    ...asObject(top.osProfile),
  };
  if (!osProfile.computerName && vmCtx.vmName) {
    osProfile.computerName = vmCtx.vmName;
  }
  if (vmCtx.authMode === 'password') {
    if (vmCtx.generatedAdminUsername) {
      osProfile.adminUsername = vmCtx.generatedAdminUsername;
    }
    if (vmCtx.generatedAdminPassword) {
      osProfile.adminPassword = vmCtx.generatedAdminPassword;
      vmCtx.credentialsApplied = true;
    }
    const linuxConfiguration = {
      ...asObject(osProfile.linuxConfiguration),
      disablePasswordAuthentication: false,
    };
    osProfile.linuxConfiguration = linuxConfiguration;
  }

  const storageProfile = {
    ...asObject(existingProps.storageProfile),
    ...asObject(top.storageProfile),
  };
  if (!storageProfile.imageReference) {
    // Ubuntu Server 22.04 LTS Gen2
    storageProfile.imageReference = {
      publisher: 'Canonical',
      offer: '0001-com-ubuntu-server-jammy',
      sku: '22_04-lts-gen2',
      version: 'latest',
    };
  }
  const osDisk = {
    ...asObject(storageProfile.osDisk),
  };
  if (!osDisk.createOption) {
    osDisk.createOption = 'FromImage';
  }
  if (!osDisk.managedDisk) {
    osDisk.managedDisk = { storageAccountType: 'Standard_LRS' };
  }
  storageProfile.osDisk = osDisk;

  const networkProfile = {
    ...asObject(existingProps.networkProfile),
    ...asObject(top.networkProfile),
  };
  let networkInterfaces = Array.isArray(networkProfile.networkInterfaces)
    ? (networkProfile.networkInterfaces as Array<Record<string, unknown>>)
    : [];

  if (networkInterfaces.length === 0) {
    const nicName = vmCtx.dependencyNames?.nic ?? (vmCtx.vmName ? `${vmCtx.vmName}-nic` : 'vm-nic');
    const rg = vmCtx.resourceGroup ?? '{resourceGroup}';
    const nicId = `/subscriptions/{subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Network/networkInterfaces/${nicName}`;
    networkInterfaces = [{ id: nicId, properties: { primary: true } }];
  } else {
    const first = asObject(networkInterfaces[0]);
    const firstProps = { ...asObject(first.properties), primary: true };
    networkInterfaces[0] = { ...first, properties: firstProps };
  }
  networkProfile.networkInterfaces = networkInterfaces;

  const properties: Record<string, unknown> = {
    ...existingProps,
    hardwareProfile,
    storageProfile,
    osProfile,
    networkProfile,
  };

  const normalized: Record<string, unknown> = {
    ...top,
    properties,
  };
  if (!normalized.location && vmCtx.discoveredRegion) {
    normalized.location = vmCtx.discoveredRegion;
  }

  // ARM VM create expects these under properties, not top-level.
  delete normalized.hardwareProfile;
  delete normalized.storageProfile;
  delete normalized.osProfile;
  delete normalized.networkProfile;

  return normalized;
}

function applyVmDefaultsToAction(action: AgentAction, vmCtx: VmRunContext): AgentAction {
  if (!vmCtx.isVmRequest || action.action !== 'execute') return action;
  const method = (action.rest_method ?? 'GET').toUpperCase();
  const url = action.rest_url ?? '';
  const mutableBody = action.rest_body
    ? (JSON.parse(JSON.stringify(action.rest_body)) as Record<string, unknown>)
    : ({} as Record<string, unknown>);
  let resolvedBody = mutableBody;

  let changed = false;

  if ((url.includes('/virtualNetworks/') || url.includes('/subnets/') || url.includes('/networkInterfaces/')) && method === 'PUT') {
    if (!('location' in mutableBody) && vmCtx.discoveredRegion) {
      mutableBody.location = vmCtx.discoveredRegion;
      changed = true;
    }
  }

  if (url.includes('/virtualMachines/') && (method === 'PUT' || method === 'PATCH')) {
    const normalized = normalizeVmBodyForArm(mutableBody, vmCtx);
    if (JSON.stringify(normalized) !== JSON.stringify(mutableBody)) {
      changed = true;
      resolvedBody = normalized;
    }
  }

  if (!changed) return action;
  return { ...action, rest_body: resolvedBody };
}

function buildAssumptionsUsedMarkdown(vmCtx: VmRunContext): string {
  if (!vmCtx.isVmRequest) return '';

  const lines: string[] = [];
  if (vmCtx.resourceGroup) {
    lines.push(`- Resource group: \`${vmCtx.resourceGroup}\``);
  }
  lines.push(`- Region: \`${vmCtx.discoveredRegion ?? 'resource group location'}\``);
  lines.push(`- VM size: \`${vmCtx.vmSku}\``);

  if (vmCtx.vmName && vmCtx.dependencyNames) {
    lines.push(`- Dependency naming: \`${vmCtx.dependencyNames.vnet}\`, \`${vmCtx.dependencyNames.subnet}\`, \`${vmCtx.dependencyNames.nic}\``);
  }
  if (vmCtx.fromScratch) {
    lines.push('- Build mode: from scratch (check/create dependencies in order)');
  }
  lines.push(`- Auth mode: \`${vmCtx.authMode}\``);

  let credentialsBlock = '';
  if (vmCtx.authMode === 'password' && vmCtx.credentialsApplied && vmCtx.generatedAdminUsername && vmCtx.generatedAdminPassword) {
    credentialsBlock = [
      '',
      '### Generated Credentials',
      `- Username: \`${vmCtx.generatedAdminUsername}\``,
      `- Password: \`${vmCtx.generatedAdminPassword}\``,
      '',
      'Save these credentials now. They are shown once in this run summary.',
    ].join('\n');
  }

  return `\n\n### Assumptions Used\n${lines.join('\n')}${credentialsBlock}`;
}

function extractJsonObject(text: string): string | null {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock?.[1]) return codeBlock[1];

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return null;
}

function parseAgentAction(text: string): AgentAction | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as AgentAction;
  } catch {
    return null;
  }
}

async function getNextAgentAction(
  systemPrompt: string,
  turnPrompt: string,
  providerConfig: ProviderConfig
): Promise<AgentAction | null> {
  const initialText = await completeText(
    providerConfig,
    systemPrompt,
    [{ role: 'user', content: turnPrompt }],
    1024
  );
  const initialAction = parseAgentAction(initialText);
  if (initialAction) {
    if (initialAction.action === 'clarify' && isRedundantGoalClarification(initialAction.message)) {
      const nudgedText = await completeText(
        providerConfig,
        systemPrompt,
        [
          { role: 'user', content: turnPrompt },
          { role: 'assistant', content: initialText },
          {
            role: 'user',
            content:
              'The goal was already provided. Do not ask for it again. Return the next JSON action now.',
          },
        ],
        1024
      );
      return parseAgentAction(nudgedText);
    }
    return initialAction;
  }

  // One repair attempt to avoid failing the entire run due to minor JSON formatting issues.
  const repairText = await completeText(
    providerConfig,
    systemPrompt,
    [
      { role: 'assistant', content: initialText },
      {
        role: 'user',
        content:
          'Your previous response was invalid JSON. Return exactly one valid JSON object with no markdown fences, no prose, and one of actions: execute, clarify, done.',
      },
    ],
    1024
  );

  return parseAgentAction(repairText);
}

function buildSystemPrompt(session: ShellSession | undefined): string {
  const subscription = session?.subscriptionName
    ? `${session.subscriptionName} (${session.subscriptionId})`
    : 'Unknown';

  return `You are an Azure infrastructure agent. You achieve user goals by executing Azure Management REST API calls one step at a time.

At each turn you receive the original goal and a history of steps already executed (including their outputs or errors). Respond with exactly one JSON action — no other text.

ACTIONS:

1. Execute a REST call:
{"action":"execute","description":"<shown to user>","command":"<concise plain-English label, e.g. 'Check if VNet exists', 'Create NIC WEB1-nic'>","rest_method":"GET|POST|PUT|PATCH|DELETE","rest_url":"https://management.azure.com/...","rest_body":{}}

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
- For VM create/update calls, use ARM VM schema with fields under properties (e.g. properties.hardwareProfile), not top-level hardwareProfile.
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
  providerConfig: ProviderConfig,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const vmCtx = buildVmRunContext(goal, session);
  const vmDefaultingNotes = vmCtx.isVmRequest
    ? [
        '',
        'VM DEFAULTING POLICY (apply these without clarifying unless truly blocked):',
        vmCtx.resourceGroup
          ? `- Target resource group: ${vmCtx.resourceGroup}`
          : '- If resource group is missing and no default exists, ask clarification.',
        `- VM size default: ${vmCtx.vmSku}`,
        vmCtx.vmName && vmCtx.dependencyNames
          ? `- Dependency names from VM name "${vmCtx.vmName}": VNet=${vmCtx.dependencyNames.vnet}, Subnet=${vmCtx.dependencyNames.subnet}, NIC=${vmCtx.dependencyNames.nic}`
          : '- Derive dependency names from VM name when available.',
        vmCtx.fromScratch
          ? '- "From scratch" requested: always perform existence checks then create missing VNet/subnet/NIC before VM.'
          : '- For VM tasks, check/create dependencies as needed.',
        '- Use resource group region for all created resources.',
        '- Do NOT ask for username/password. Backend injects generated credentials for password auth.',
      ].join('\n')
    : '';

  const systemPrompt = `${buildSystemPrompt(session)}${vmDefaultingNotes}`;
  const stepHistory: StepRecord[] = [];
  let consecutiveErrors = 0;
  const maxSteps = vmCtx.isVmRequest ? MAX_STEPS_VM : MAX_STEPS;

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    if (signal?.aborted) break;

    const historyText =
      stepHistory.length === 0
        ? 'No steps executed yet.'
        : stepHistory
            .map(
              (s, i) =>
                `Step ${i + 1}${s.failed ? ' [FAILED]' : ''}: ${s.description}\n` +
                `Command: ${s.command}\n` +
                `Output excerpt:\n${s.output.slice(0, MAX_STEP_OUTPUT_CHARS)}`
            )
            .join('\n\n---\n\n');

    const turnPrompt = `Goal: ${goal}\n\nStep history:\n${historyText}\n\nWhat is the next action?`;
    const action = await getNextAgentAction(systemPrompt, turnPrompt, providerConfig);
    if (!action) {
      yield { type: 'error', message: 'Agent returned invalid JSON.' };
      return;
    }

    if (action.action === 'clarify') {
      if (vmCtx.isVmRequest && !isCriticalClarification(action.message ?? '', vmCtx)) {
        const note = `Ignored non-critical clarification and continued with defaults: ${action.message ?? 'N/A'}`;
        stepHistory.push({ description: 'Apply VM defaults', command: 'Continue without clarification', output: note });
        continue;
      }
      yield { type: 'clarify', message: action.message ?? 'Need more information.' };
      return;
    }

    if (action.action === 'done') {
      yield { type: 'done', summary: `${action.summary ?? 'Done.'}${buildAssumptionsUsedMarkdown(vmCtx)}` };
      return;
    }

    if (action.action === 'execute') {
      const resolvedAction = applyVmDefaultsToAction(action, vmCtx);
      const description = resolvedAction.description ?? 'Executing step';
      const command = resolvedAction.command ?? '';
      yield { type: 'step_start', stepIndex, description, command };

      try {
        const result = await executeRestCall(
          accessToken,
          resolvedAction.rest_method ?? 'GET',
          resolvedAction.rest_url ?? '',
          session?.subscriptionId,
          session?.defaultResourceGroup,
          resolvedAction.rest_body
        );

        if (result.pollUrl) {
          await waitForPoll(accessToken, result.pollUrl);
        }

        const location = extractLocationFromOutput(result.output);
        if (location) vmCtx.discoveredRegion = location;

        yield { type: 'step_done', stepIndex, output: result.output };
        stepHistory.push({ description, command, output: result.output });
        consecutiveErrors = 0;
      } catch (err) {
        const errMsg = (err as Error).message ?? 'Unknown error';
        if (isRecoverableNotFoundError(resolvedAction.rest_method, errMsg)) {
          const output = 'NOT_FOUND during existence check. Create this resource if required.';
          yield { type: 'step_done', stepIndex, output };
          // Keep the NOT_FOUND detail in model context so it can choose the create step next.
          stepHistory.push({ description, command, output });
          consecutiveErrors = 0;
          continue;
        }

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

  yield {
    type: 'error',
    message: `Agent reached the maximum step limit (${maxSteps}) without completing the goal.`,
  };
}
