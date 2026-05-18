// Phase 1: smoke test for the run-process integration harness. Validates the
// harness wires up correctly. Add the full regression suite in a follow-up.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { runIt } from "../../lib/run-process"

describe("opencode run (subprocess harness — phase 1)", () => {
  // Smoke test. If this passes, the harness can talk to the fake LLM and the
  // run command exits cleanly. Builds confidence for adding regression tests.
  runIt.live(
    "happy path: run finishes, exits 0, output reaches stdout",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("hello from the test llm")
        const result = yield* opencode.run("say hi")
        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("hello from the test llm")
      }),
    60_000,
  )
})
