// Regression test for #29390: yargs usage errors must surface the error
// message, not just reprint help text. Before the fix, `opencode --badflag`
// produced output identical to `opencode --help`, leaving the user with no
// indication that their argument was wrong.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("opencode CLI usage errors", () => {
  cliIt.live("an unknown flag reports the error, not just help", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["--this-flag-does-not-exist"])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("Unknown argument")
    }),
  )
})
