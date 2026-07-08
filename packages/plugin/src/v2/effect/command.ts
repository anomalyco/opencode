import type { CommandInfo } from "@opencode-ai/sdk/v2/types"
import type { CommandApi } from "@opencode-ai/client/effect/api"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface CommandDraft {
  list(): readonly CommandInfo[]
  get(name: string): CommandInfo | undefined
  update(name: string, update: (command: CommandInfo) => void): void
  remove(name: string): void
}

export interface CommandDomain extends CommandApi<unknown> {
  readonly transform: Transform<CommandDraft>
  readonly reload: () => Effect.Effect<void>
}
