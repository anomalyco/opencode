// `opencode agent list` used to pretty-print every agent's full resolved
// permission ruleset — thousands of lines on configured setups (#45496).
// The default output is now one summary line per agent; --verbose restores
// the full ruleset.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("opencode agent list", () => {
  cliIt.concurrent(
    "prints one summary line per agent without the resolved rules",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn(["agent", "list"])

        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("(primary)")
        expect(result.stdout).not.toContain("{")
      }),
    60_000,
  )

  cliIt.concurrent(
    "prints the full resolved permission rules with --verbose",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn(["agent", "list", "--verbose"])

        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("(primary)")
        expect(result.stdout).toContain("{")
      }),
    60_000,
  )
})
