// Phase 1: smoke test for the run-process integration harness. Validates the
// harness wires up correctly. Add the full regression suite in a follow-up.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { expectExit, withRunFixture } from "../../lib/run-process"
import { it } from "../../lib/effect"

describe("opencode run (subprocess harness — phase 1)", () => {
  // Smoke test. If this passes, the harness can talk to the fake LLM and the
  // run command exits cleanly. Builds confidence for adding regression tests.
  it.live(
    "happy path: run finishes, exits 0, output reaches stdout",
    () =>
      withRunFixture(({ llm, modelID, runOpencode }) =>
        Effect.gen(function* () {
          yield* llm.text("hello from the test llm")

          const result = yield* runOpencode(
            ["run", "--model", modelID, "say hi"],
            { timeoutMs: 30_000 },
          )

          expectExit(result, 0, "happy path")
          expect(result.stdout).toContain("hello from the test llm")
        }),
      ),
    60_000,
  )
})
