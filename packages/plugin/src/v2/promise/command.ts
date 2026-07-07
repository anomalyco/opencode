import type { CommandApi } from "@opencode-ai/client/promise/api"
import type { CommandDraft } from "../effect/command.js"
import type { Transform } from "./registration.js"

export type { CommandDraft }

export interface CommandDomain extends CommandApi {
  readonly transform: Transform<CommandDraft>
  readonly reload: () => Promise<void>
}
