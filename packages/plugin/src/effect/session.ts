import type { SessionApi } from "@opencode-ai/client/effect/api"
import type { Message, SystemPart } from "@opencode-ai/ai"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Model } from "@opencode-ai/schema/model"
import type { Session } from "@opencode-ai/schema/session"
import type { Effect, JsonSchema, Scope } from "effect"
import type { Registration } from "./registration.js"

export interface SessionContext {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  system: Array<SystemPart>
  messages: Array<Message>
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>
}

export interface SessionHttpContext {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
}

export type SessionHttpMiddleware = (
  context: SessionHttpContext,
  request: Request,
  next: (request: Request) => Effect.Effect<Response, Error>,
) => Effect.Effect<Response, Error>

export interface SessionHooks {
  readonly context: SessionContext
}

export type SessionHookRegistration =
  | {
      [Name in keyof SessionHooks]: [name: Name, callback: (event: SessionHooks[Name]) => Effect.Effect<void>]
    }[keyof SessionHooks]
  | [name: "http", middleware: SessionHttpMiddleware]

export interface SessionHook {
  <Name extends keyof SessionHooks>(
    name: Name,
    callback: (event: SessionHooks[Name]) => Effect.Effect<void>,
  ): Effect.Effect<Registration, never, Scope.Scope>
  (name: "http", middleware: SessionHttpMiddleware): Effect.Effect<Registration, never, Scope.Scope>
}

export type SessionDomain = Pick<
  SessionApi<unknown>,
  "create" | "get" | "prompt" | "generate" | "command" | "synthetic" | "interrupt" | "rename" | "wait"
> & {
  readonly hook: SessionHook
}
