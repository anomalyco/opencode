import type { SessionApi } from "@opencode-ai/client/promise/api"
import type { Message, SystemPart } from "@opencode-ai/ai"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Model } from "@opencode-ai/schema/model"
import type { Session } from "@opencode-ai/schema/session"
import type { JsonSchema } from "effect"
import type { Hooks } from "./registration.js"

export interface SessionContext {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  system: Array<SystemPart>
  messages: Array<Message>
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>
}

export interface SessionHooks {
  readonly context: SessionContext
}

export type SessionDomain = Pick<SessionApi, "create" | "get" | "prompt" | "command" | "synthetic" | "interrupt"> & {
  readonly hook: Hooks<SessionHooks>
}
