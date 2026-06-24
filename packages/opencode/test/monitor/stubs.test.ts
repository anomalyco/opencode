import { describe, expect, test } from "bun:test"
import { AppRuntime } from "@/effect/app-runtime"
import { KanbanBoard, buildKanban } from "@/monitor/kanban"
import { Health, buildHealth } from "@/monitor/health"
import { WorkflowsReport, buildWorkflows } from "@/monitor/workflows"

describe("monitor/kanban", () => {
  test("returns a board shape (no sessions: empty columns)", async () => {
    const board = await AppRuntime.runPromise(buildKanban({ projectId: "p1", view: "sessions" }))
    const parsed = KanbanBoard.parse(board)
    expect(parsed.view).toBe("sessions")
    expect(parsed.columns.working).toBeArray()
  })
})

describe("monitor/health", () => {
  test("returns a health shape with 4 components", async () => {
    const h = await AppRuntime.runPromise(buildHealth())
    const parsed = Health.parse(h)
    expect(parsed.window_sec).toBeGreaterThan(0)
    expect(parsed.components.success_rate).toBeGreaterThanOrEqual(0)
    expect(parsed.components.cache_hit_rate).toBeGreaterThanOrEqual(0)
  })
})

describe("monitor/workflows", () => {
  test("returns 11 datasets", async () => {
    const r = await AppRuntime.runPromise(buildWorkflows({ projectId: "p1", status: "all" }))
    const parsed = WorkflowsReport.parse(r)
    expect(Object.keys(parsed.datasets).length).toBe(11)
  })
})