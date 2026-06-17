import type { CommandModule } from "yargs"
import { LoopCommand, LoopListCommand, LoopCancelCommand, LoopPauseCommand, LoopResumeCommand } from "../cli/cmd/loop"
import { AutoReplyToggleCommand } from "../cli/cmd/auto-reply"
import { PatternDetectionCommand } from "../cli/cmd/pattern-detection"
import { HookCommand } from "../cli/cmd/hook"

/**
 * Fork-only CLI commands, registered as a single unit from `src/index.ts`.
 *
 * Why this exists: every custom command we add to the yargs chain in
 * `index.ts` is an upstream merge conflict waiting to happen. By funnelling
 * them through one array that `index.ts` registers with a single
 * `.command(ForkCommands)` call, the only fork-owned line in upstream's
 * command block is that one registration — upstream can reshuffle its own
 * commands without ever touching ours.
 *
 * Add new fork commands HERE, not in index.ts.
 */
export const ForkCommands: CommandModule<any, any>[] = [
  LoopCommand,
  LoopListCommand,
  LoopCancelCommand,
  LoopPauseCommand,
  LoopResumeCommand,
  AutoReplyToggleCommand,
  PatternDetectionCommand,
  HookCommand,
]
