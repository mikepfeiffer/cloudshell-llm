export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export type LlmProvider = 'claude' | 'openai';

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'claude';

export const LLM_PROVIDER_MODELS: Record<LlmProvider, readonly string[]> = {
  claude: ['claude-sonnet-4-6', 'claude-3-7-sonnet-latest'],
  openai: ['gpt-5.1', 'gpt-5-mini'],
};

export const DEFAULT_LLM_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-5.1',
};

export interface GeneratedCommand {
  command: string;
  description: string;
  risk_level: "read" | "modify" | "destructive";
  rest_method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  rest_url: string;
  rest_body?: Record<string, unknown>;
  synthesize?: boolean;
}

export interface PlanStep {
  command: string;
  description: string;
  rest_method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  rest_url: string;
  rest_body?: Record<string, unknown>;
}

export interface CommandPlan {
  type: "plan";
  description: string;
  risk_level: "read" | "modify" | "destructive";
  steps: PlanStep[];
  synthesize: true;
}

export interface ClarificationRequest {
  clarification: string;
}

export interface AgentGoal {
  type: 'agent';
  goal: string;
  description: string;
}

export interface AgentStep {
  stepIndex: number;
  description: string;
  command: string;
  status: 'running' | 'done' | 'error';
  output?: string;
  error?: string;
}

export type LLMResponse = GeneratedCommand | CommandPlan | ClarificationRequest;

export interface CommandExecutionResult {
  command: string;
  output: string;
  exitCode?: number;
  executedAt: number;
}

export interface SessionState {
  isConnected: boolean;
  subscriptionName?: string;
  subscriptionId?: string;
  defaultResourceGroup?: string;
}

export interface UserSettings {
  requireConfirmation: boolean;
  defaultResourceGroup: string;
  llmProvider: LlmProvider;
  llmModel: string;
}
