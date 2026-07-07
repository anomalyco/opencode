import type { CommandApi } from "@opencode-ai/client/promise/api"
import type { CommandDraft } from "../effect/command.js"
import type { Hooks, Transform } from "./registration.js"

export type { CommandDraft }

export interface CommandHooks {}

export interface CommandDomain extends CommandApi {
  readonly hook: Hooks<CommandHooks>
  readonly transform: Transform<CommandDraft>
  readonly reload: () => Promise<void>
}
