import type { SessionApi } from "@opencode-ai/client/promise/api"
import type { Message, SystemPart } from "@opencode-ai/ai"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Model } from "@opencode-ai/schema/model"
import type { Session } from "@opencode-ai/schema/session"
import type { JsonSchema } from "effect"
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
  next: (request: Request) => Promise<Response>,
) => Promise<Response> | Response

export interface SessionHooks {
  readonly context: SessionContext
}

export type SessionHookRegistration =
  | {
      [Name in keyof SessionHooks]: [name: Name, callback: (event: SessionHooks[Name]) => Promise<void> | void]
    }[keyof SessionHooks]
  | [name: "http", middleware: SessionHttpMiddleware]

export interface SessionHook {
  <Name extends keyof SessionHooks>(
    name: Name,
    callback: (event: SessionHooks[Name]) => Promise<void> | void,
  ): Promise<Registration>
  (name: "http", middleware: SessionHttpMiddleware): Promise<Registration>
}

export type SessionDomain = Pick<
  SessionApi,
  "create" | "get" | "prompt" | "generate" | "command" | "synthetic" | "interrupt"
> & {
  readonly hook: SessionHook
}
