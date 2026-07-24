import type { CommandV2Info } from "@opencode-ai/sdk/v2/types"
import type { Hooks } from "./registration.js"

export interface CommandDraft {
  list(): readonly CommandV2Info[]
  get(name: string): CommandV2Info | undefined
  update(name: string, update: (command: CommandV2Info) => void): void
  remove(name: string): void
}

export type CommandHooks = Hooks<{
  transform: CommandDraft
}>
