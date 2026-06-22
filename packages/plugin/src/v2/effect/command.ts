import type { CommandV2Info } from "@opencode-ai/sdk/v2/types"
import type { Effect } from "effect"
import type { Transformable } from "./registration.js"

export interface CommandDraft {
  list(): readonly CommandV2Info[]
  get(name: string): CommandV2Info | undefined
  update(name: string, update: (command: CommandV2Info) => void): void
  remove(name: string): void
}

export interface Command extends Transformable<CommandDraft> {
  get(name: string): Effect.Effect<CommandV2Info | undefined>
  list(): Effect.Effect<CommandV2Info[]>
}
