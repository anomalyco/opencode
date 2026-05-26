import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("opencode ping", () => {
  cliIt.concurrent(
    "calls the configured model once and prints the response",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("pong", { usage: { input: 4, output: 1 } })

        const result = yield* opencode.ping()

        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("pong test/test-model")
        expect(result.stdout).toContain("pong")
        expect(result.stdout).toContain('"inputTokens":4')
        expect(yield* llm.calls).toBe(1)
      }),
    60_000,
  )

  cliIt.concurrent(
    "uses the default ping message",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("pong")

        const result = yield* opencode.ping()
        const [input] = yield* llm.inputs

        opencode.expectExit(result, 0)
        expect(JSON.stringify(input)).toContain("Reply with exactly: pong")
      }),
    60_000,
  )

  cliIt.concurrent(
    "exits nonzero when the agent is unknown",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.ping({ agent: "missing", timeoutMs: 15_000 })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain("Agent not found: missing")
      }),
    30_000,
  )
})
