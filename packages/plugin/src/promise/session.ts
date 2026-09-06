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

/**
 * Request overrides. Typed keys are the protocol-neutral generation settings;
 * any other key is passed to the selected protocol as a provider option under its
 * semantic name, such as `reasoningEffort` for OpenAI Responses. Unset fields
 * retain route and model defaults.
 */
export type SessionRequestOptions = Types.DeepMutable<GenerationOptionsFields> & Record<string, unknown>

/** The parts of an outbound model request every Session request hook exposes. */
export interface SessionRequest {
  readonly sessionID: Session.ID
  readonly model: Model.Ref
  system: Array<SystemPart>
  messages: Array<Message>
  options: SessionRequestOptions
}

/** The agent conversation: loop steps, compaction summaries, and transient generation. */
export interface SessionContext extends SessionRequest {
  readonly agent: Agent.ID
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>
}

/** Title generation. It is not an agent conversation and carries no tools. */
export interface SessionTitle extends SessionRequest {}

/**
 * Why a Session request is being made. Auxiliary requests share the Session's
 * hook identity but need to be told apart from the agent loop.
 */
export type SessionRequestKind = "primary" | "compaction" | "title" | "generate"

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
  readonly error: SessionError.Error
  readonly attempt: number
  decision: SessionRetryDecision
}

export interface SessionHooks {
  readonly prompt: SessionPrompt
  readonly context: SessionContext
  readonly title: SessionTitle
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
