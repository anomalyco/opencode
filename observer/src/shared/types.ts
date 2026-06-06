// Session info from opencode API
export interface SessionInfo {
  id: string;
  title: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  cost?: number;
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  time: { created: number; updated: number; archived?: number };
  parentID?: string;
  directory?: string;
  share?: { url: string };
}

// Session status: idle | busy | retry
export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

// Message types
export interface UserMessage {
  id: string;
  sessionID: string;
  role: "user";
  time: { created: number };
  agent: string;
  model?: { providerID: string; modelID: string; variant?: string };
  text?: string;
  files?: Array<{ name: string; path: string }>;
  agents?: string[];
}

export interface AssistantMessage {
  id: string;
  sessionID: string;
  role: "assistant";
  time: { created: number; completed?: number };
  agent: string;
  modelID: string;
  providerID: string;
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  finish?: string;
  error?: { name: string; data: { message: string } };
}

export type Message = UserMessage | AssistantMessage;

// Part types
export interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  time?: { start: number; end?: number };
}

export interface ReasoningPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
  time: { start: number; end?: number };
}

export interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: ToolState;
}

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | { status: "running"; input: Record<string, unknown>; title?: string; time: { start: number } }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string; time: { start: number; end: number } }
  | { status: "error"; input: Record<string, unknown>; error: string; time: { start: number; end: number } };

export interface SubtaskPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "subtask";
  prompt: string;
  description: string;
  agent: string;
  status?: "pending" | "running" | "completed" | "error";
}

export interface StepStartPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
  snapshot?: string;
}

export interface StepFinishPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason: string;
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
}

export interface AgentPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "agent";
  name: string;
}

export interface CompactionPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "compaction";
  auto: boolean;
  summary?: string;
}

export type Part = TextPart | ReasoningPart | ToolPart | SubtaskPart | StepStartPart | StepFinishPart | AgentPart | CompactionPart;

// Message with parts (from V1 API)
export interface MessageWithParts {
  info: Message;
  parts: Part[];
}

// Active stream tracking
export interface ActiveStream {
  sessionID: string;
  messageID: string;
  partID: string;
  type: "text" | "reasoning";
}

// WebSocket message types (server -> client)
export type ServerMessage =
  | { type: "connected" }
  | { type: "session.list"; sessions: SessionInfo[] }
  | { type: "session.status"; sessionID: string; status: SessionStatus }
  | { type: "session.created"; session: SessionInfo }
  | { type: "session.updated"; session: SessionInfo }
  | { type: "session.deleted"; sessionID: string }
  | { type: "session.messages"; sessionID: string; messages: MessageWithParts[] }
  | { type: "message.updated"; sessionID: string; message: MessageWithParts }
  | { type: "part.updated"; sessionID: string; part: Part }
  | { type: "text.delta"; sessionID: string; messageID: string; partID: string; delta: string }
  | { type: "reasoning.delta"; sessionID: string; messageID: string; partID: string; delta: string }
  | { type: "tool.progress"; sessionID: string; part: ToolPart }
  | { type: "step.started"; sessionID: string; data: { assistantMessageID: string; agent: string; model: { id: string; providerID: string } } }
  | { type: "step.ended"; sessionID: string; data: { assistantMessageID: string; cost: number; tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } } }
  | { type: "pong" }
  | { type: "error"; message: string };

// WebSocket message types (client -> server)
export type ClientMessage =
  | { type: "subscribe"; sessionID: string }
  | { type: "unsubscribe"; sessionID: string }
  | { type: "ping" }
  | { type: "get.sessions" }
  | { type: "get.messages"; sessionID: string };

// Global event from opencode SSE
export interface GlobalEvent {
  directory?: string;
  project?: string;
  workspace?: string;
  payload: {
    id: string;
    type: string;
    properties: Record<string, unknown>;
  };
}
