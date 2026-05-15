import type { Argv } from "yargs"
import { withNetworkOptions } from "@/cli/network-options"

// Single source of truth for the default ($0) command's yargs spec.
//
// This module is imported eagerly from `src/index.ts` so the top-level
// `--help` listing can render the default command's options synchronously
// without dynamic-importing `./thread.ts` (and its Effect/SDK/TUI graph).
// The real `TuiThreadCommand` in `./thread.ts` spreads `TuiThreadSpec` so
// the option contract has exactly one definition.
export const TuiThreadSpec = {
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs: Argv) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
} as const
