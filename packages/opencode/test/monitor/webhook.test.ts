import { describe, expect, test } from "bun:test"
import { Condition, EventPatternCondition } from "@/monitor/alerts"
import { getProvider, listProviders } from "@/monitor/webhook"

describe("monitor/alerts Condition schema", () => {
  test("event-pattern parses", () => {
    const parsed = EventPatternCondition.parse({
      type: "event-pattern",
      event_type: "session.updated",
      min_count: 3,
      window_sec: 120,
    })
    expect(parsed.type).toBe("event-pattern")
    expect(parsed.min_count).toBe(3)
  })

  test("Condition discriminated union rejects unknown type", () => {
    expect(() => Condition.parse({ type: "nope" } as never)).toThrow()
  })
})

describe("monitor/webhook registry", () => {
  test("lists 15 providers (14 first-class + generic)", () => {
    expect(listProviders().length).toBe(15)
  })

  test("slack provider formats a slack block payload", () => {
    const slack = getProvider("slack")
    const out = slack.format({
      id: "evt1",
      rule: { id: "r1", name: "many errors" },
      fired_at: 1,
      project_id: "p1",
      session_id: "s1",
      payload: { k: "v" },
    })
    expect(out.body).toMatchObject({ text: expect.stringContaining("many errors") })
  })

  test("generic provider resolves URL from input", () => {
    const generic = getProvider("generic")
    expect(generic.resolveURL({ credentials: {}, explicitURL: "https://example.com/hook" })).toBe(
      "https://example.com/hook",
    )
  })
})
