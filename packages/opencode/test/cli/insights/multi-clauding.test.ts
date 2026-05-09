import { describe, expect, test } from "bun:test"
import { detectMultiClauding } from "@/insights/multi-clauding"

describe("detectMultiClauding", () => {
  test("no overlap → zeroes", () => {
    const r = detectMultiClauding([
      { session_id: "a", user_message_timestamps_ms: [1_000, 2_000] },
      { session_id: "b", user_message_timestamps_ms: [10 * 60 * 60_000] },
    ])
    expect(r).toEqual({ overlap_events: 0, sessions_involved: 0, user_messages_during: 0 })
  })

  test("a-b-a within 30 min window → one overlap event, both involved", () => {
    const r = detectMultiClauding([
      { session_id: "a", user_message_timestamps_ms: [0, 20 * 60_000] },
      { session_id: "b", user_message_timestamps_ms: [10 * 60_000] },
    ])
    expect(r.overlap_events).toBe(1)
    expect(r.sessions_involved).toBe(2)
    expect(r.user_messages_during).toBeGreaterThanOrEqual(2)
  })

  test("a-a outside window → no overlap", () => {
    const r = detectMultiClauding([
      { session_id: "a", user_message_timestamps_ms: [0, 60 * 60_000] },
      { session_id: "b", user_message_timestamps_ms: [30 * 60_000 + 1] },
    ])
    expect(r.overlap_events).toBe(0)
  })

  test("exact-boundary 30 min → still considered in window", () => {
    // The window comparison is `> OVERLAP_WINDOW_MS` (strict), so equal is in.
    const r = detectMultiClauding([
      { session_id: "a", user_message_timestamps_ms: [0, 30 * 60_000] },
      { session_id: "b", user_message_timestamps_ms: [15 * 60_000] },
    ])
    expect(r.overlap_events).toBe(1)
  })

  test("a-b-a counts all three messages, not just first interleaving", () => {
    // Previously the inner loop `break`d after the first foreign message,
    // under-counting `user_messages_during`. Now: prev (a@0), between (b@10),
    // curr (a@20) → 3 distinct message indices recorded.
    const r = detectMultiClauding([
      { session_id: "a", user_message_timestamps_ms: [0, 20 * 60_000] },
      { session_id: "b", user_message_timestamps_ms: [10 * 60_000] },
    ])
    expect(r.user_messages_during).toBe(3)
  })

  test("three-way concurrent (a-b-c-a) → three pairs, three sessions, four messages", () => {
    const r = detectMultiClauding([
      { session_id: "a", user_message_timestamps_ms: [0, 20 * 60_000] },
      { session_id: "b", user_message_timestamps_ms: [5 * 60_000] },
      { session_id: "c", user_message_timestamps_ms: [10 * 60_000] },
    ])
    // pairs: {a,b}, {a,c} (b-c interleaving doesn't fire because there's no
    // prev-of-b/c at this window — only 'a' has a prev to compare against)
    expect(r.overlap_events).toBe(2)
    expect(r.sessions_involved).toBe(3)
    expect(r.user_messages_during).toBe(4)
  })

  test("same-millisecond messages from same session don't collide", () => {
    // Two user messages at identical timestamps used to share a Set key like
    // `${ts}:${sessionId}` and silently merge to one entry. Indices fix this.
    const r = detectMultiClauding([
      { session_id: "a", user_message_timestamps_ms: [0, 0, 20 * 60_000] },
      { session_id: "b", user_message_timestamps_ms: [10 * 60_000] },
    ])
    expect(r.user_messages_during).toBeGreaterThanOrEqual(3)
  })

  test("empty input → all zeros", () => {
    expect(detectMultiClauding([])).toEqual({
      overlap_events: 0,
      sessions_involved: 0,
      user_messages_during: 0,
    })
  })
})
