// Subprocess tests for how `opencode run` splits `-f/--file` values from the
// positional message. Yargs array options are greedy by default, so a leading
// `-f` used to swallow the prompt words into the file list (#40304) and the
// run died on "File not found: <first prompt word>". The option takes one path
// per occurrence now, so flag-first order reaches the model.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"

describe("opencode run file arguments", () => {
  cliIt.concurrent(
    "keeps the positional prompt when -f comes first",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("flag order ok")

        const result = yield* opencode.run("check the hosts file", {
          extraArgs: ["-f", "/etc/hosts"],
        })

        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("flag order ok\n")
      }),
    60_000,
  )
})
