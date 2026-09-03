import type { SessionApi } from "@opencode-ai/client/promise/api"
import type { GenerationOptionsFields, Message, SystemPart } from "@opencode-ai/ai"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Model } from "@opencode-ai/schema/model"
import type { PromptInput } from "@opencode-ai/schema/prompt-input"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import type { SessionError } from "@opencode-ai/schema/session-error"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import type { JsonSchema, Types } from "effect"
import type { ModelHooks } from "./registration.js"

export interface SessionPrompt {
  readonly sessionID: Session.ID
  readonly messageID: SessionMessage.ID
  prompt: Types.DeepMutable<PromptInput.Prompt>
  metadata?: Record<string, unknown>
  delivery: SessionInbox.Delivery
}

export interface SessionContext {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  system: Array<SystemPart>
  messages: Array<Message>
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>
  /** Request overrides; unset fields retain route and model defaults. */
  generation: Types.DeepMutable<GenerationOptionsFields>
  providerOptions: Record<string, unknown>
}

export interface SessionModelRequest {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  baseURL?: string
  headers: Record<string, string>
}

export interface SessionHttpRequest {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  request: Request
}

export interface SessionHttpResponse {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly request: Request
  response: Response
}

export type SessionRetryDecision = { retry: false } | { retry: true; delay: number }

export interface SessionRetry {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly error: SessionError.Error
  readonly attempt: number
  decision: SessionRetryDecision
}

export interface SessionHooks {
  readonly prompt: SessionPrompt
  readonly context: SessionContext
  readonly "model.request": SessionModelRequest
  readonly "http.request": SessionHttpRequest
  readonly "http.response": SessionHttpResponse
  readonly retry: SessionRetry
}

export type SessionDomain = Pick<
  SessionApi,
  | "create"
  | "get"
  | "switchAgent"
  | "switchModel"
  | "prompt"
  | "generate"
  | "command"
  | "synthetic"
  | "interrupt"
  | "rename"
  | "move"
  | "wait"
  | "context"
> & {
  readonly hook: ModelHooks<SessionHooks>
}
