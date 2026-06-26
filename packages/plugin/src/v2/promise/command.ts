import type { CommandDraft } from "../effect/command.js"
import type { Hooks } from "./registration.js"

export type { CommandDraft }

export type CommandHooks = Hooks<{
  transform: CommandDraft
}>
