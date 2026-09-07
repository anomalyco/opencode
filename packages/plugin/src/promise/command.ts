import type { CommandApi } from "@opencode-ai/client/promise/api"
import type { ConfigCommand } from "@opencode-ai/schema/config/command"
import type { PromptInput } from "@opencode-ai/schema/prompt-input"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import type { Transform } from "./registration.js"

export interface CommandInvocation {
  readonly sessionID: Session.ID
  readonly prompt: PromptInput.Prompt
  readonly delivery: SessionInbox.Delivery
}

export interface CommandCallbackDefinition {
  readonly name: string
  readonly description?: string
  readonly execute: (input: CommandInvocation) => Promise<void>
}

export interface CommandTemplateDefinition {
  readonly name: string
  readonly description?: string
  readonly template: string
  readonly agent?: string
  readonly model?: ConfigCommand.Info["model"]
  readonly subagent?: boolean
}

export type CommandDefinition = CommandCallbackDefinition | CommandTemplateDefinition

export interface CommandEditor {
  add(definition: CommandDefinition): void
}

export interface CommandDomain extends Pick<CommandApi, "list"> {
  readonly transform: Transform<CommandEditor>
  readonly reload: () => Promise<void>
}
