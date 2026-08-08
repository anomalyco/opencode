import { describe, expect, test } from "bun:test"
import { ToolActivity } from "@/session/tool-activity"

// Regression: a turn died with "Provider stream stalled: no events for 300s"
// while the provider was demonstrably healthy (z4 served 72 completions,
// slowest 81s). The silence was our own tool: the ai-sdk awaits execute()
// before emitting tool-result, so the LLM event stream produces nothing for
// the whole call. A FOREGROUND subagent is allowed 600s
// (SUBAGENT_TASK_TIMEOUT_MS) against a 300s watchdog, so any subagent running
// 5-10 minutes killed its parent every time and the subagent's own backstop
// was unreachable.
describe("tool activity registry", () => {
  test("a session with no tool running is not active", () => {
    expect(ToolActivity.active("ses_quiet")).toBe(false)
  })

  test("tracks a tool across begin/end", () => {
    ToolActivity.begin("ses_a")
    expect(ToolActivity.active("ses_a")).toBe(true)
    ToolActivity.end("ses_a")
    expect(ToolActivity.active("ses_a")).toBe(false)
  })

  // Parallel tool calls in one turn overlap, so a boolean would let the first
  // one to finish clear the flag while others are still running.
  test("stays active until the last of several overlapping tools ends", () => {
    ToolActivity.begin("ses_b")
    ToolActivity.begin("ses_b")
    ToolActivity.begin("ses_b")
    ToolActivity.end("ses_b")
    expect(ToolActivity.active("ses_b")).toBe(true)
    ToolActivity.end("ses_b")
    expect(ToolActivity.active("ses_b")).toBe(true)
    ToolActivity.end("ses_b")
    expect(ToolActivity.active("ses_b")).toBe(false)
  })

  // Keyed per session: a long-running tool must not keep an unrelated
  // session's genuinely dead stream alive.
  test("activity does not leak across sessions", () => {
    ToolActivity.begin("ses_busy")
    expect(ToolActivity.active("ses_busy")).toBe(true)
    expect(ToolActivity.active("ses_other")).toBe(false)
    ToolActivity.end("ses_busy")
  })

  // An unbalanced end (double-release, or an end for a session that never
  // began) must not drive the count negative — that would make a later real
  // begin() read as inactive and re-arm the bug.
  test("an unbalanced end cannot drive the count below zero", () => {
    ToolActivity.end("ses_c")
    ToolActivity.end("ses_c")
    ToolActivity.begin("ses_c")
    expect(ToolActivity.active("ses_c")).toBe(true)
    ToolActivity.end("ses_c")
    expect(ToolActivity.active("ses_c")).toBe(false)
  })
})
