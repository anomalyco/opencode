import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("opencode sessions", () => {
  cliIt.concurrent(
    "prints help",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn(["sessions", "--help"])
        opencode.expectExit(result, 0)
        // `--help` output is written to stderr (see `show` in src/index.ts)
        expect(result.stderr).toContain("browse sessions across all projects")
      }),
  )
})
