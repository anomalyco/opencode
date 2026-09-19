export type Role = "user" | "assistant" | "tool";

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface UserMessage {
  role: "user";
  text: string;
}

export interface AssistantMessage {
  role: "assistant";
  text: string;
  toolCalls: ToolCallRequest[];
}

export interface ToolMessage {
  role: "tool";
  callId: string;
  name: string;
  output: string;
  isError: boolean;
}

export type ConversationMessage = UserMessage | AssistantMessage | ToolMessage;

export function isToolMessage(m: ConversationMessage): m is ToolMessage {
  return m.role === "tool";
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
}

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export type StreamEvent =
  | { kind: "text_delta"; text: string }
  | { kind: "message"; message: AssistantMessage }
  | { kind: "usage"; inputTokens?: number; outputTokens?: number };

export interface Provider {
  readonly name: string;
  readonly model: string;
  stream(options: {
    messages: ConversationMessage[];
    system: string;
    tools: ToolSpec[];
    signal?: AbortSignal;
  }): AsyncIterable<StreamEvent>;
}

export interface ApprovalRequest {
  kind: "run_command" | "write_file" | "edit_file";
  title: string;
  detail: string;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<boolean>;

export type AgentEvent =
  | { kind: "turn_start"; turn: number }
  | { kind: "text_delta"; text: string }
  | { kind: "assistant_message"; message: AssistantMessage }
  | { kind: "tool_start"; call: ToolCallRequest }
  | {
      kind: "tool_end";
      callId: string;
      name: string;
      output: string;
      isError: boolean;
      durationMs: number;
    }
  | { kind: "usage"; inputTokens?: number; outputTokens?: number }
  | { kind: "done"; stopReason: StopReason; error?: string };

export type StopReason =
  | "end_turn"
  | "max_turns"
  | "aborted"
  | "provider_error";

export interface AgentOptions {
  provider: Provider;
  tools: ToolRegistryLike;
  system: string;
  maxTurns?: number;
  signal?: AbortSignal;
  approval?: ApprovalHandler;
}

export interface ToolRegistryLike {
  specs(): ToolSpec[];
  invoke(
    call: ToolCallRequest,
    ctx: { approval: ApprovalHandler },
  ): Promise<{ output: string; isError: boolean }>;
}
