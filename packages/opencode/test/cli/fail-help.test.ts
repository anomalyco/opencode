import { describe, expect } from "bun:test"
import { Effect } from "effect"
import stripAnsi from "strip-ansi"
import { cliIt } from "../lib/cli-process"
import { stripCrlf } from "../lib/snapshot"

describe("opencode CLI failure help", () => {
  cliIt.live("prints the yargs failure message before help text", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["--unkown-flag"])
      const stderr = stripCrlf(stripAnsi(result.stderr))

      opencode.expectExit(result, 1)
      expect(stderr).toContain("Error: Unknown arguments: unkown-flag")
      expect(stderr.indexOf("Unknown arguments: unkown-flag")).toBeLessThan(stderr.indexOf("Commands:"))
    }),
  )
})
