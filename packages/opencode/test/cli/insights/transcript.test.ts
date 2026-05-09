import { describe, expect, test } from "bun:test"
import { formatTranscript, chunkTranscript, TRANSCRIPT_INLINE_LIMIT } from "@/insights/transcript"

const meta = {
  session_id: "deadbeef0000",
  project_id: "p",
  project_path: "/tmp/p",
  start_time: 0,
  end_time: 60_000,
  duration_minutes: 1,
} as any

describe("formatTranscript", () => {
  test("truncates long user/assistant text", () => {
    const long = "x".repeat(2000)
    const t = formatTranscript(meta, [
      { info: { role: "user", time: { created: 0 } }, parts: [{ type: "text", text: long }] } as any,
      { info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: long }] } as any,
    ])
    // The user line is truncated to USER_MAX = 500 chars after the prefix
    expect(t.split("\n").find((ln) => ln.startsWith("[User]: "))?.length).toBe("[User]: ".length + 500)
    expect(t).toContain("[Assistant]: ")
  })

  test("emits [Tool: name] markers", () => {
    const t = formatTranscript(meta, [
      { info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "tool", tool: "edit", state: {} }] } as any,
    ])
    expect(t).toContain("[Tool: edit]")
  })
})

describe("chunkTranscript", () => {
  test("under limit → single chunk", () => {
    expect(chunkTranscript("hello").length).toBe(1)
  })
  test("over limit → multiple chunks", () => {
    const big = "x".repeat(TRANSCRIPT_INLINE_LIMIT + 50_000)
    expect(chunkTranscript(big).length).toBeGreaterThan(1)
  })
})
