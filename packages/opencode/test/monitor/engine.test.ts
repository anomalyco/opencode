import { describe, expect, test } from "bun:test"
import {
  evaluate,
  cooldownKey,
  inCooldown,
  AlertRule,
  type RuleEvent,
  type AlertRule as AlertRuleType,
} from "@/monitor/alerts"

function rule(input: Partial<AlertRuleType> = {}): AlertRuleType {
  return AlertRule.parse({
    id: "r1",
    project_id: "p1",
    name: "test",
    type: "event-pattern",
    condition: { type: "event-pattern", event_type: "session.created", min_count: 1, window_sec: 60 },
    cooldown_sec: 0,
    enabled: true,
    time_created: 0,
    time_updated: 0,
    ...input,
  })
}

describe("monitor/alerts evaluate", () => {
  test("disabled rule never fires", () => {
    const r = rule({ enabled: false })
    const out = evaluate(r, { now: 1, event: { type: "session.created", at: 1 } })
    expect(out).toBeNull()
  })

  test("event-pattern: matches by event type", () => {
    const r = rule({
      condition: { type: "event-pattern", event_type: "session.created", min_count: 1, window_sec: 60 },
    })
    const evt: RuleEvent = { type: "session.created", at: 1000, payload: { sessionID: "ses1" } }
    const out = evaluate(r, { now: 1000, event: evt })
    expect(out).toEqual({
      event_type: "session.created",
      session_id: "ses1",
      payload: { sessionID: "ses1" },
    })
  })

  test("event-pattern: mismatched event type does not fire", () => {
    const r = rule({
      condition: { type: "event-pattern", event_type: "session.created", min_count: 1, window_sec: 60 },
    })
    const out = evaluate(r, { now: 1, event: { type: "session.deleted", at: 1 } })
    expect(out).toBeNull()
  })

  test("event-pattern: tool name mismatch", () => {
    const r = rule({
      condition: { type: "event-pattern", tool_name: "read", min_count: 1, window_sec: 60 },
    })
    const out = evaluate(r, { now: 1, event: { type: "tool.invoked", at: 1, payload: { tool: "write" } } })
    expect(out).toBeNull()
  })

  test("event-pattern: min_count gating", () => {
    const r = rule({
      condition: { type: "event-pattern", event_type: "x", min_count: 5, window_sec: 60 },
    })
    const out = evaluate(r, {
      now: 100,
      event: { type: "x", at: 100 },
      sessionEventCount: () => 3,
    })
    expect(out).toBeNull()
    const out2 = evaluate(r, {
      now: 100,
      event: { type: "x", at: 100 },
      sessionEventCount: () => 6,
    })
    expect(out2).not.toBeNull()
  })

  test("inactivity: fires when idle past threshold", () => {
    const r = rule({
      type: "inactivity",
      condition: { type: "inactivity", threshold_sec: 60 },
    })
    const out = evaluate(r, { now: 120_000, event: { type: "session.idle", at: 1 } })
    expect(out).toEqual({ idle_ms: 119_999, threshold_sec: 60 })
  })

  test("inactivity: does not fire before threshold", () => {
    const r = rule({
      type: "inactivity",
      condition: { type: "inactivity", threshold_sec: 60 },
    })
    const out = evaluate(r, { now: 30_000, event: { type: "session.idle", at: 1 } })
    expect(out).toBeNull()
  })

  test("stuck-agent: fires when status matches + past threshold", () => {
    const r = rule({
      type: "stuck-agent",
      condition: { type: "stuck-agent", states: ["working"], threshold_sec: 60 },
    })
    const evt: RuleEvent = { type: "session.status", at: 0, payload: { status: "working" } }
    const out = evaluate(r, { now: 120_000, event: evt })
    expect(out).toMatchObject({ status: "working", elapsed_ms: 120_000 })
  })

  test("stuck-agent: ignored when status not in states list", () => {
    const r = rule({
      type: "stuck-agent",
      condition: { type: "stuck-agent", states: ["working"], threshold_sec: 60 },
    })
    const evt: RuleEvent = { type: "session.status", at: 0, payload: { status: "waiting" } }
    expect(evaluate(r, { now: 120_000, event: evt })).toBeNull()
  })

  test("token-threshold: fires when limit exceeded", () => {
    const r = rule({
      type: "token-threshold",
      condition: { type: "token-threshold", field: "total", limit: 100_000 },
    })
    const out = evaluate(r, {
      now: 1,
      tokens: { input: 50_000, output: 30_000, "cache.read": 20_000, "cache.write": 5_000, total: 105_000 },
    })
    expect(out).toEqual({ field: "total", value: 105_000, limit: 100_000 })
  })

  test("token-threshold: under limit does not fire", () => {
    const r = rule({
      type: "token-threshold",
      condition: { type: "token-threshold", field: "total", limit: 100_000 },
    })
    const out = evaluate(r, {
      now: 1,
      tokens: { input: 1000, output: 500, "cache.read": 0, "cache.write": 0, total: 1500 },
    })
    expect(out).toBeNull()
  })
})

describe("monitor/alerts cooldown", () => {
  test("cooldownKey format", () => {
    expect(cooldownKey("r1", "ses1")).toBe("r1|ses1")
    expect(cooldownKey("r1", null)).toBe("r1|_")
  })

  test("inCooldown returns true within window", () => {
    expect(inCooldown(100, 100 + 60 * 1000 - 1, 60)).toBe(true)
  })

  test("inCooldown returns false past window", () => {
    expect(inCooldown(100, 100 + 60 * 1000, 60)).toBe(false)
  })

  test("inCooldown with cooldown_sec=0 always false", () => {
    expect(inCooldown(100, 101, 0)).toBe(false)
  })
})