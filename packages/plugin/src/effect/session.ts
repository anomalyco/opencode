import type { SessionApi } from "@opencode-ai/client/effect/api"
import type { Message, SystemPart } from "@opencode-ai/ai"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Model } from "@opencode-ai/schema/model"
import type { Session } from "@opencode-ai/schema/session"
import type { Effect, JsonSchema } from "effect"
import type { Hooks } from "./registration.js"

export interface SessionContext {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  system: Array<SystemPart>
  messages: Array<Message>
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>
}

export interface SessionHttp {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly use: (middleware: SessionHttpMiddleware) => Effect.Effect<void>
}

export type SessionHttpHandler = (request: Request) => Effect.Effect<Response, Error>

export type SessionHttpMiddleware = (
  request: Request,
  next: SessionHttpHandler,
) => Effect.Effect<Response, Error>

export interface SessionHooks {
  readonly context: SessionContext
  readonly http: SessionHttp
}

export type SessionDomain = Pick<
  SessionApi<unknown>,
  "create" | "get" | "prompt" | "generate" | "command" | "synthetic" | "interrupt" | "rename" | "wait"
> & {
  readonly hook: Hooks<SessionHooks>
}
