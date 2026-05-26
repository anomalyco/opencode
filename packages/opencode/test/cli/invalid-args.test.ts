import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("opencode CLI invalid arguments", () => {
  cliIt.live(
    "prints the parser error before top-level help for unknown arguments",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn(["--unkown-flag"])

        opencode.expectExit(result, 1, "opencode --unkown-flag")
        expect(result.stdout).toBe("")
        expect(result.stderr).toContain("Unknown arguments: unkown-flag")
        expect(result.stderr).toContain("Commands:")
      }),
    60_000,
  )
})
