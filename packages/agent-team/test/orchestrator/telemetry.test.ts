import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Telemetry } from "../../src/orchestrator/telemetry.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("Telemetry", () => {
  let dir: string
  let telemetry: Telemetry

  beforeEach(async () => {
    dir = await tmpdir()
    telemetry = new Telemetry(dir)
    await telemetry.init()
  })

  afterEach(async () => {
    await cleanup(dir)
  })

  test("record writes event", async () => {
    await telemetry.record({ agent: "a1", event_type: "task.start" })
    const stats = await telemetry.getStats("a1")
    expect(stats.total_tasks).toBe(1)
  })

  test("event format has required fields", async () => {
    await telemetry.record({ agent: "a1", event_type: "task.complete", duration_ms: 500, success: true })
    const stats = await telemetry.getStats("a1")
    expect(stats.completed_tasks).toBe(1)
  })

  test("getStats aggregates correctly", async () => {
    await telemetry.record({ agent: "a1", event_type: "task.start" })
    await telemetry.record({ agent: "a1", event_type: "task.complete", duration_ms: 100 })
    await telemetry.record({ agent: "a1", event_type: "task.complete", duration_ms: 200 })
    await telemetry.record({ agent: "a1", event_type: "message.sent" })
    const stats = await telemetry.getStats("a1")
    expect(stats.total_tasks).toBe(3)
    expect(stats.completed_tasks).toBe(2)
    expect(stats.total_messages).toBe(1)
    expect(stats.avg_task_duration_ms).toBe(150)
  })

  test("getDashboard returns all agents", async () => {
    await telemetry.record({ agent: "a1", event_type: "task.start" })
    await telemetry.record({ agent: "a2", event_type: "task.start" })
    const dash = await telemetry.getDashboard()
    expect(Object.keys(dash).length).toBe(2)
  })

  test("filters agents in stats", async () => {
    await telemetry.record({ agent: "a1", event_type: "task.start" })
    await telemetry.record({ agent: "a2", event_type: "task.start" })
    const stats = await telemetry.getStats("a1")
    expect(stats.total_tasks).toBe(1)
  })
})
