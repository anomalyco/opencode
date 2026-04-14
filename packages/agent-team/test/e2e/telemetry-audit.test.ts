import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("E2E: telemetry and audit", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir)
    await orch.start()
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("record telemetry event and get stats", async () => {
    await orch.telemetry.record({
      agent: "coder",
      event_type: "task.start",
      metadata: { task_id: "t1" },
    })
    await orch.telemetry.record({
      agent: "coder",
      event_type: "task.complete",
      duration_ms: 5000,
      success: true,
    })
    const stats = await orch.telemetry.getStats("coder")
    expect(stats.total_tasks).toBe(2)
    expect(stats.completed_tasks).toBe(1)
    expect(stats.avg_task_duration_ms).toBe(5000)
  })

  test("getDashboard aggregates all agents", async () => {
    await orch.spawn({ agent_id: "reviewer", role: "reviewer", capabilities: {} })
    await orch.telemetry.record({ agent: "coder", event_type: "task.complete", duration_ms: 3000, success: true })
    await orch.telemetry.record({ agent: "reviewer", event_type: "task.start" })
    await orch.telemetry.record({ agent: "reviewer", event_type: "message.sent" })
    const dashboard = await orch.telemetry.getDashboard()
    expect(dashboard.coder.total_tasks).toBe(1)
    expect(dashboard.reviewer.total_tasks).toBe(1)
    expect(dashboard.reviewer.total_messages).toBe(1)
  })

  test("getStats filters by time range", async () => {
    const now = Date.now()
    await orch.telemetry.record({ agent: "coder", event_type: "task.complete", duration_ms: 1000 })
    const stats = await orch.telemetry.getStats("coder", { since: now - 1000 })
    expect(stats.total_tasks).toBe(1)
    const empty = await orch.telemetry.getStats("coder", { since: now + 10000 })
    expect(empty.total_tasks).toBe(0)
  })

  test("stats return zeros for agent with no events", async () => {
    const stats = await orch.telemetry.getStats("nonexistent")
    expect(stats.total_tasks).toBe(0)
    expect(stats.completed_tasks).toBe(0)
    expect(stats.avg_task_duration_ms).toBe(0)
  })

  test("audit records spawn event", async () => {
    const audit = await orch.audit.read({ agent: "coder" })
    expect(audit.length).toBeGreaterThanOrEqual(1)
    expect(audit.some((e) => e.action === "agent.spawn")).toBe(true)
  })

  test("audit records task lifecycle events", async () => {
    await orch.audit.append({ agent: "coder", action: "task.assigned", target: "t1" })
    await orch.audit.append({ agent: "coder", action: "task.completed", target: "t1" })
    const audit = await orch.audit.read({ agent: "coder" })
    const taskEvents = audit.filter((e) => e.action.startsWith("task."))
    expect(taskEvents.length).toBeGreaterThanOrEqual(2)
  })

  test("audit filters by action", async () => {
    await orch.audit.append({ agent: "coder", action: "message.sent" })
    await orch.audit.append({ agent: "coder", action: "message.delivered" })
    const sent = await orch.audit.read({ action: "message.sent" })
    expect(sent.every((e) => e.action === "message.sent")).toBe(true)
  })

  test("audit persists across restart", async () => {
    await orch.audit.append({ agent: "coder", action: "custom.event", details: { key: "value" } })
    const orch2 = new Orchestrator(dir)
    await orch2.start()
    const audit = await orch2.audit.read({ action: "custom.event" })
    expect(audit.length).toBeGreaterThanOrEqual(1)
    expect(audit[0].details).toEqual({ key: "value" })
    orch2.stop()
  })

  test("audit event has required fields", async () => {
    await orch.audit.append({ agent: "coder", action: "test.action", target: "t1" })
    const [event] = await orch.audit.read({ action: "test.action" })
    expect(event.ts).toBeDefined()
    expect(typeof event.ts).toBe("number")
    expect(event.agent).toBe("coder")
    expect(event.action).toBe("test.action")
    expect(event.target).toBe("t1")
  })

  test("telemetry records message events", async () => {
    await orch.telemetry.record({ agent: "coder", event_type: "message.sent" })
    await orch.telemetry.record({ agent: "coder", event_type: "message.received" })
    await orch.telemetry.record({ agent: "coder", event_type: "message.sent" })
    const stats = await orch.telemetry.getStats("coder")
    expect(stats.total_messages).toBe(3)
  })

  test("telemetry tracks task failures", async () => {
    await orch.telemetry.record({ agent: "coder", event_type: "task.start" })
    await orch.telemetry.record({ agent: "coder", event_type: "task.fail", duration_ms: 2000, success: false })
    const stats = await orch.telemetry.getStats("coder")
    expect(stats.failed_tasks).toBe(1)
    expect(stats.completed_tasks).toBe(0)
  })
})
