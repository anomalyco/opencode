// Subprocess integration test for `opencode run --workflow`. A real workflow run
// would need a discovered workflow file + the test LLM; the robust smoke here is
// that an UNKNOWN workflow name fails fast with a non-zero exit (validates the
// wiring — option, branch, start error, exit code — without a workflow fixture).
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"
import { WORKFLOW_PARKED_EXIT_CODE } from "../../../src/cli/cmd/run/workflow.shared"

describe("opencode run --workflow (subprocess)", () => {
  cliIt.concurrent(
    "run --workflow exits nonzero for an unknown workflow name",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn(["run", "--workflow", "does-not-exist", "--model", "test/test-model"], {
          timeoutMs: 20_000,
        })
        expect(result.exitCode).not.toBe(0)
        expect(result.durationMs).toBeLessThan(20_000) // no hang
      }),
    40_000,
  )

  // Finding 6: a workflow that calls ctx.question parks to `paused` (a NON-terminal
  // status) when no answer arrives. Headless mode has no interactive answerer, so
  // the poll loop must STOP on `paused` and exit with the distinct parked code
  // (never hang for the full question timeout). The fixture below uses a tiny
  // question timeout so it parks within a few hundred ms.
  cliIt.concurrent(
    "run --workflow parks on a question: exits with the parked code + prints guidance, no hang",
    ({ opencode, home }) =>
      Effect.gen(function* () {
        const dir = path.join(home, ".opencode", "workflows")
        yield* Effect.promise(() => mkdir(dir, { recursive: true }))
        // A discovered workflow file whose run() asks a question with a 50ms
        // timeout — it parks to `paused` almost immediately with a pending_question.
        yield* Effect.promise(() =>
          writeFile(
            path.join(dir, "asks-question.ts"),
            [
              "export default {",
              '  meta: { name: "asks-question", description: "parks on a question" },',
              "  async run(_args, ctx) {",
              '    const { answer } = await ctx.question({ question: "Pick a target", options: ["a", "b"], timeout: 50 })',
              "    return { answer }",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )

        const result = yield* opencode.spawn(["run", "--workflow", "asks-question", "--model", "test/test-model"], {
          timeoutMs: 20_000,
        })

        // Distinct parked exit code (NOT 0, NOT the generic failure 1).
        expect(result.exitCode).toBe(WORKFLOW_PARKED_EXIT_CODE)
        // It must not have spun for the question timeout / poll forever.
        expect(result.durationMs).toBeLessThan(20_000)
        // Guidance: the question text, the run id, and the resumable answer route.
        const out = result.stdout + result.stderr
        expect(out).toContain("Pick a target")
        expect(out).toContain("/workflow/run/")
        expect(out).toContain("/answer")
      }),
    40_000,
  )

  // JSON format variant: a parked run emits a `workflow_parked` event line and
  // still exits with the parked code.
  cliIt.concurrent(
    "run --workflow --format json emits a workflow_parked event when parking on a question",
    ({ opencode, home }) =>
      Effect.gen(function* () {
        const dir = path.join(home, ".opencode", "workflows")
        yield* Effect.promise(() => mkdir(dir, { recursive: true }))
        yield* Effect.promise(() =>
          writeFile(
            path.join(dir, "asks-json.ts"),
            [
              "export default {",
              '  meta: { name: "asks-json", description: "parks on a question (json)" },',
              "  async run(_args, ctx) {",
              '    await ctx.question({ question: "Describe it", timeout: 50 })',
              "    return { ok: true }",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )

        const result = yield* opencode.spawn(
          ["run", "--workflow", "asks-json", "--model", "test/test-model", "--format", "json"],
          { timeoutMs: 20_000 },
        )

        expect(result.exitCode).toBe(WORKFLOW_PARKED_EXIT_CODE)
        const events = opencode.parseJsonEvents(result.stdout)
        const parked = events.find((e) => e["type"] === "workflow_parked")
        expect(parked).toBeDefined()
        expect(parked?.["question"]).toBe("Describe it")
      }),
    40_000,
  )
})
