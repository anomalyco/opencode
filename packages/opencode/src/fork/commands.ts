import type { CommandModule } from "yargs"
// Only the parent LoopCommand is registered: it nests list/cancel/pause/resume
// in its own builder (see cli/cmd/loop.ts for why they cannot be top-level).
import { LoopCommand } from "../cli/cmd/loop"
// Was written, exported, and never registered — so `opencode beads` did not
// exist despite 194 lines of working code over the live BeadsSync service.
// The opposite failure from `hook`, which was registered and did nothing.
import { BeadsCommand } from "../cli/cmd/beads"
// Effective-ruleset inspector + usage-scanning setup wizard, the local
// equivalent of `claude auto-mode config` / `/auto-mode-setup`.
import { PermissionCommand } from "../cli/cmd/permission"

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
  BeadsCommand,
  PermissionCommand,
]
