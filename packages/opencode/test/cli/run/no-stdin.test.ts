// `run` appends piped stdin to the prompt; --no-stdin skips the read so a
// held-open fd 0 (inherited socket or pipe) cannot hang it.
import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { cliIt } from "../../lib/cli-process"

const sentinel = "piped stdin sentinel"
const pipedData = Stream.make(new TextEncoder().encode(sentinel))

describe("opencode run stdin handling", () => {
  cliIt.concurrent(
    "appends piped stdin to the prompt by default",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("reply")
        const result = yield* opencode.run("prompt", { stdin: pipedData })
        opencode.expectExit(result, 0)
        const inputs = JSON.stringify(yield* llm.inputs)
        expect(inputs).toContain(`prompt\\n${sentinel}`)
      }),
    60_000,
  )

  cliIt.concurrent(
    "--no-stdin ignores piped stdin data",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("reply")
        const result = yield* opencode.run("prompt", {
          extraArgs: ["--no-stdin"],
          stdin: pipedData,
        })
        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("reply\n")
        const inputs = JSON.stringify(yield* llm.inputs)
        expect(inputs).toContain("prompt")
        expect(inputs).not.toContain(sentinel)
      }),
    60_000,
  )

  cliIt.concurrent(
    "--no-stdin does not block on a held-open stdin pipe",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("reply")
        // simulate an inherited fd that never sends data or EOF
        const result = yield* opencode.run("prompt", {
          extraArgs: ["--no-stdin"],
          stdin: Stream.never,
          timeoutMs: 20_000,
        })
        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("reply\n")
      }),
    60_000,
  )
})
