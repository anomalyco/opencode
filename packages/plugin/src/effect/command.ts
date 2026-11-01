import type { CommandApi } from "@opencode/client/effect/api"
import type { Agent } from "@opencode/schema/agent"
import type { PromptInput } from "@opencode/schema/prompt-input"
import type { Session } from "@opencode/schema/session"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface CommandInvocation {
  readonly sessionID: Session.ID
  readonly messageID?: SessionMessage.ID
  readonly prompt: PromptInput.Prompt
  readonly delivery: SessionInbox.Delivery
  readonly unattended?: boolean
  readonly inline?: boolean
  readonly note?: string
}

export interface CommandDefinition {
  readonly name: string
  readonly description?: string
  readonly agent?: Agent.ID
  readonly subagent?: boolean
  readonly template?: string
  readonly execute: (input: CommandInvocation) => Effect.Effect<void, unknown>
}

export interface CommandEditor {
  add(definition: CommandDefinition): void
}

export interface CommandDomain extends Pick<CommandApi<unknown>, "list"> {
  readonly transform: Transform<CommandEditor>
  readonly reload: () => Effect.Effect<void>
}
