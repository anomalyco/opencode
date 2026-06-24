import { describe, expect, test } from "bun:test"
import { Mood, deriveMood, nextQuip } from "@/monitor/tabby"

const now = 1_700_000_000_000

describe("monitor/tabby", () => {
  test("disconnected overrides everything", () => {
    const mood = deriveMood(
      { active_sessions: 5, errored_sessions: 0, last_event_at: now, last_error_at: null, connected: false },
      now,
    )
    expect(mood).toBe("disconnected")
  })

  test("worried when there are errored sessions", () => {
    const mood = deriveMood(
      { active_sessions: 1, errored_sessions: 1, last_event_at: now, last_error_at: null, connected: true },
      now,
    )
    expect(mood).toBe("worried")
  })

  test("happy within 30s of an event", () => {
    const mood = deriveMood(
      { active_sessions: 1, errored_sessions: 0, last_event_at: now - 5_000, last_error_at: null, connected: true },
      now,
    )
    expect(mood).toBe("happy")
  })

  test("watching when active but no recent event", () => {
    const mood = deriveMood(
      { active_sessions: 2, errored_sessions: 0, last_event_at: now - 60_000, last_error_at: null, connected: true },
      now,
    )
    expect(mood).toBe("watching")
  })

  test("sleeping when idle for >5min", () => {
    const mood = deriveMood(
      { active_sessions: 0, errored_sessions: 0, last_event_at: now - 6 * 60_000, last_error_at: null, connected: true },
      now,
    )
    expect(mood).toBe("sleeping")
  })

  test("idle when quiet", () => {
    const mood = deriveMood(
      { active_sessions: 0, errored_sessions: 0, last_event_at: now - 60_000, last_error_at: null, connected: true },
      now,
    )
    expect(mood).toBe("idle")
  })

  test("nextQuip returns localised string", () => {
    expect(nextQuip("happy", "en")).toBe("Nice — that just wrapped cleanly!")
    expect(nextQuip("happy", "zh")).toBe("刚刚跑完一个干净的回合。")
    expect(nextQuip("happy", "vi")).toBe("Vừa xong một lượt sạch đẹp!")
  })

  test("Mood zod enum has 8 states", () => {
    expect(Mood.options.length).toBe(8)
  })
})
