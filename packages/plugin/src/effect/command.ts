import type { CommandApi } from "@opencode/client/effect/api"
import type { Command } from "@opencode/schema/command"
import type { PromptInput } from "@opencode/schema/prompt-input"
import type { Session } from "@opencode/schema/session"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface CommandInvocation {
  readonly sessionID: Session.ID
  /**
   * Identity for the input this command admits. Pass it as the prompt `id` and report it in a
   * `prompt` outcome so clients can follow the resulting work.
   */
  readonly messageID: SessionMessage.ID
  readonly prompt: PromptInput.Prompt
  readonly delivery: SessionInbox.Delivery
}

/** Resolve with `prompt` when the command admitted session input; `void` or `immediate` finish the command now. */
export type CommandOutcome = Command.Outcome

export interface CommandDefinition {
  readonly name: string
  readonly description?: string
  readonly execute: (input: CommandInvocation) => Effect.Effect<CommandOutcome | void, unknown>
}

export interface CommandEditor {
  add(definition: CommandDefinition): void
}

export interface CommandDomain extends Pick<CommandApi<unknown>, "list"> {
  readonly transform: Transform<CommandEditor>
  readonly reload: () => Effect.Effect<void>
}
