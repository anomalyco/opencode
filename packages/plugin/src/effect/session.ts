import type { SessionApi } from "@opencode-ai/client/effect/api"
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

/**
 * Why a Session request is being made. Auxiliary requests share the Session's
 * hook identity but need to be told apart from the agent loop.
 */
export type SessionRequestKind = "primary" | "compaction" | "title" | "generate"

/**
 * Request overrides. Typed keys are the protocol-neutral generation settings;
 * any other key is passed to the selected protocol as a provider option under its
 * semantic name, such as `reasoningEffort` for OpenAI Responses. Unset fields
 * retain route and model defaults.
 */
export type SessionRequestOptions = Types.DeepMutable<GenerationOptionsFields> & Record<string, unknown>

export interface SessionContext {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  /** Titles do not run context hooks; they will get a dedicated hook. */
  readonly kind: Exclude<SessionRequestKind, "title">
  system: Array<SystemPart>
  messages: Array<Message>
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>
  options: SessionRequestOptions
}

export interface SessionModelRequest {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly kind: SessionRequestKind
  baseURL?: string
  headers: Record<string, string>
}

export interface SessionHttpRequest {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly kind: SessionRequestKind
  request: Request
}

export interface SessionHttpResponse {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly kind: SessionRequestKind
  readonly request: Request
  response: Response
}

export type SessionRetryDecision = { retry: false } | { retry: true; delay: number }

export interface SessionRetry {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly kind: SessionRequestKind
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
  SessionApi<unknown>,
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
