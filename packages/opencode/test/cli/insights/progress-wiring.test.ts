import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { Effect } from "effect"
import { extractFacet, saveCachedFacet } from "@/insights/facets"
import type { SessionFacets } from "@/insights/schema"
import { sessionMeta } from "./_fixtures"

const sample: SessionFacets = {
  session_id: "wiringtest01",
  underlying_goal: "wiring",
  goal_categories: { feature_implementation: 1 },
  outcome: "fully_achieved",
  user_satisfaction_counts: { satisfied: 1 },
  claude_helpfulness: "very_helpful",
  session_type: "single_task",
  friction_counts: {},
  friction_detail: "",
  primary_success: "correct_code_edits",
  brief_summary: "Sample brief.",
}

const meta = sessionMeta({ session_id: sample.session_id })

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "opencode-insights-progress-"))
  process.env["OPENCODE_INSIGHTS_DIR"] = tmp
})

afterEach(() => {
  delete process.env["OPENCODE_INSIGHTS_DIR"]
  rmSync(tmp, { recursive: true, force: true })
})

describe("extractFacet onProgress wiring", () => {
  test("invokes onProgress exactly once when facet is served from cache", async () => {
    await saveCachedFacet(sample, meta.end_time)
    const calls: number[] = []
    const onProgress = () => calls.push(Date.now())
    // Model arg is irrelevant — cached path never calls the LLM. Pass {} cast.
    const result = await Effect.runPromise(
      extractFacet({
        meta,
        messages: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: {} as any,
        onProgress,
      }),
    )
    expect(result?.session_id).toBe(sample.session_id)
    expect(calls.length).toBe(1)
  })

  test("does NOT invoke onUsage on cache hit (only fresh LLM calls emit usage)", async () => {
    await saveCachedFacet(sample, meta.end_time)
    const usageEvents: unknown[] = []
    const result = await Effect.runPromise(
      extractFacet({
        meta,
        messages: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: {} as any,
        onProgress: () => {},
        onUsage: (e) => usageEvents.push(e),
      }),
    )
    expect(result?.session_id).toBe(sample.session_id)
    expect(usageEvents.length).toBe(0)
  })

  // The fresh-LLM path of `extractFacet` calls `generateObject` from the `ai`
  // SDK (and may run additional `generateObject` calls for chunk summaries).
  // Exercising it from a unit test requires a fake `LanguageModel` that
  // satisfies the AI SDK's `LanguageModelV*` interface — non-trivial enough
  // that we leave it as documented gaps rather than a flaky / over-mocked
  // stub. The contract being asserted (per the inline doc on
  // `ExtractFacetInput.onProgress`) is:
  //   "Called exactly once per `extractFacet` invocation, after the facet
  //    is resolved (whether from cache or from a fresh LLM call)."

  test.todo("extractFacet on a successful fresh LLM call ticks onProgress exactly once", () => {})
  test.todo("extractFacet on LLM failure still ticks onProgress exactly once and returns null", () => {})
  test.todo("extractFacet emits onUsage once per LLM round-trip (1 facet + N chunk summaries)", () => {})
})

describe("generateSections onProgress wiring", () => {
  // `generateSections` (src/insights/sections.ts) runs `generateObject` 7
  // times via `Effect.forEach({ concurrency: 4 })`, calling `onProgress`
  // inside `Effect.tap` after each section resolves. Same fake-LanguageModel
  // blocker as the extractFacet tests above.

  test.todo("generateSections ticks onProgress exactly 7 times (once per section)", () => {})
  test.todo("generateSections emits 7 onUsage events with kind === 'section'", () => {})
})

describe("Insights.run RunResult shape", () => {
  // End-to-end shape test for `Insights.run` (src/cli/cmd/insights.ts).
  // Requires stubbing the LLM at module level (mock.module on `ai`) plus
  // seeding a fake transcript on disk. Documented as a gap pending
  // fake-LanguageModel infrastructure shared with the cases above.

  test.todo("Insights.run RunResult shape: report path, sessions, cost, usage events", () => {})
})
