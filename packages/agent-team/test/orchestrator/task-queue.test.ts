import { describe, test, expect } from "bun:test"
import { Registry } from "../../src/orchestrator/registry.js"
import { BudgetManager } from "../../src/orchestrator/budget.js"
import { TaskQueue } from "../../src/orchestrator/task-queue.js"

const defaultCaps = {
  tools: ["read", "edit"],
  read: true,
  write_own_workspace: true,
  share_to_team: false,
  delegate: true,
  spawn_subagents: false,
  max_delegation_depth: 2,
  disk_quota_mb: 500,
  protected_paths: [],
}

function makeTask(id: string, priority: "critical" | "high" | "normal" | "low" = "normal", caps?: string[]) {
  return {
    task_id: id,
    title: `Task ${id}`,
    description: `Description for ${id}`,
    priority,
    required_capabilities: caps,
  }
}

describe("TaskQueue", () => {
  test("enqueue returns task_id", () => {
    const r = new Registry()
    const b = new BudgetManager()
    const tq = new TaskQueue(r, b, {})
    const result = tq.enqueue(makeTask("t1"))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.task_id).toBe("t1")
  })

  test("enqueue rejects when max concurrent reached", () => {
    const r = new Registry()
    const b = new BudgetManager()
    const tq = new TaskQueue(r, b, { maxConcurrent: 1 })
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    tq.enqueue(makeTask("t1"))
    tq.assignNext()
    const result = tq.enqueue(makeTask("t2"))
    expect(result.ok).toBe(false)
  })

  test("assignNext finds capable idle agent", () => {
    const r = new Registry()
    const b = new BudgetManager()
    const tq = new TaskQueue(r, b, {})
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    const result = tq.enqueue(makeTask("t1"))
    expect(result.ok).toBe(true)
    const status = tq.getTaskStatus("t1")
    expect(status?.status).toBe("assigned")
    expect(status?.assigned_to).toBe("a1")
  })

  test("assignNext prefers higher priority", () => {
    const r = new Registry()
    const b = new BudgetManager()
    const tq = new TaskQueue(r, b, { maxConcurrent: 2 })
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    r.register({ id: "a2", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a2" })
    tq.enqueue(makeTask("t1", "low"))
    tq.enqueue(makeTask("t2", "critical"))
    const t1 = tq.getTaskStatus("t1")
    const t2 = tq.getTaskStatus("t2")
    expect(t1?.status).toBe("assigned")
    expect(t2?.status).toBe("assigned")
    expect(t2?.task.priority).toBe("critical")
  })

  test("complete triggers assignNext", () => {
    const r = new Registry()
    const b = new BudgetManager()
    const tq = new TaskQueue(r, b, { maxConcurrent: 2 })
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    tq.enqueue(makeTask("t1"))
    const status1 = tq.getTaskStatus("t1")
    expect(status1?.status).toBe("assigned")
    tq.enqueue(makeTask("t2"))
    expect(tq.getTaskStatus("t2")?.status).toBe("pending")
    tq.complete("t1", { task_id: "t1", status: "completed", summary: "done" })
    const status2 = tq.getTaskStatus("t2")
    expect(status2?.status).toBe("assigned")
  })

  test("cancel marks task cancelled", () => {
    const r = new Registry()
    const b = new BudgetManager()
    const tq = new TaskQueue(r, b, {})
    tq.enqueue(makeTask("t1"))
    tq.cancel("t1")
    expect(tq.getTaskStatus("t1")?.status).toBe("cancelled")
  })

  test("listPending returns unassigned tasks", () => {
    const r = new Registry()
    const b = new BudgetManager()
    const tq = new TaskQueue(r, b, {})
    tq.enqueue(makeTask("t1"))
    tq.enqueue(makeTask("t2"))
    expect(tq.listPending().length).toBe(2)
  })

  test("listActive returns assigned tasks", () => {
    const r = new Registry()
    const b = new BudgetManager()
    const tq = new TaskQueue(r, b, {})
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    tq.enqueue(makeTask("t1"))
    tq.assignNext()
    expect(tq.listActive().length).toBe(1)
  })
})
