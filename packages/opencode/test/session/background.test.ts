import { describe, expect, test } from "bun:test"
import { BackgroundTask } from "../../src/session/background"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("session.background", () => {
  test("register stores task and list returns it", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        BackgroundTask.register({
          id: "test-1",
          childSessionID: "child-1",
          parentSessionID: "parent-1",
          parentAgent: "build",
          description: "Test task",
          agent: "general",
          status: "running",
          startedAt: Date.now(),
        })
        const tasks = BackgroundTask.list("parent-1")
        expect(tasks).toHaveLength(1)
        expect(tasks[0].id).toBe("test-1")
        expect(tasks[0].status).toBe("running")
        expect(tasks[0].childSessionID).toBe("child-1")
        expect(tasks[0].agent).toBe("general")
      },
    })
  })

  test("get returns single task by id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        BackgroundTask.register({
          id: "test-get",
          childSessionID: "child-get",
          parentSessionID: "parent-get",
          parentAgent: "build",
          description: "Get test",
          agent: "general",
          status: "running",
          startedAt: Date.now(),
        })
        const task = BackgroundTask.get("test-get")
        expect(task).toBeDefined()
        expect(task!.description).toBe("Get test")

        const missing = BackgroundTask.get("nonexistent")
        expect(missing).toBeUndefined()
      },
    })
  })

  test("list filters by parentSessionID", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        BackgroundTask.register({
          id: "parent-a-1",
          childSessionID: "child-a-1",
          parentSessionID: "parent-a",
          parentAgent: "build",
          description: "Task A1",
          agent: "general",
          status: "running",
          startedAt: Date.now(),
        })
        BackgroundTask.register({
          id: "parent-b-1",
          childSessionID: "child-b-1",
          parentSessionID: "parent-b",
          parentAgent: "build",
          description: "Task B1",
          agent: "general",
          status: "running",
          startedAt: Date.now(),
        })
        BackgroundTask.register({
          id: "parent-a-2",
          childSessionID: "child-a-2",
          parentSessionID: "parent-a",
          parentAgent: "build",
          description: "Task A2",
          agent: "research",
          status: "running",
          startedAt: Date.now(),
        })

        const tasksA = BackgroundTask.list("parent-a")
        expect(tasksA).toHaveLength(2)

        const tasksB = BackgroundTask.list("parent-b")
        expect(tasksB).toHaveLength(1)

        const tasksC = BackgroundTask.list("parent-c")
        expect(tasksC).toHaveLength(0)
      },
    })
  })

  test("compactionContext returns undefined when no tasks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ctx = BackgroundTask.compactionContext("no-tasks-parent")
        expect(ctx).toBeUndefined()
      },
    })
  })

  test("compactionContext includes running tasks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        BackgroundTask.register({
          id: "compact-1",
          childSessionID: "child-compact-1",
          parentSessionID: "parent-compact",
          parentAgent: "build",
          description: "Research OAuth2",
          agent: "kortix-research",
          status: "running",
          startedAt: Date.now(),
        })

        const ctx = BackgroundTask.compactionContext("parent-compact")
        expect(ctx).toBeDefined()
        expect(ctx).toContain("<background_tasks>")
        expect(ctx).toContain("</background_tasks>")
        expect(ctx).toContain("Research OAuth2")
        expect(ctx).toContain("kortix-research")
        expect(ctx).toContain("Running Background Tasks")
        expect(ctx).toContain("Do NOT poll")
      },
    })
  })

  test("compactionContext includes completed tasks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info: BackgroundTask.Info = {
          id: "compact-done",
          childSessionID: "child-compact-done",
          parentSessionID: "parent-compact-done",
          parentAgent: "build",
          description: "Build landing page",
          agent: "kortix-web-dev",
          status: "complete",
          startedAt: Date.now() - 60000,
          completedAt: Date.now(),
          result: "Landing page built successfully at /src/pages/landing.tsx",
        }
        // Directly register a completed task (simulating post-completion state)
        BackgroundTask.register(info)

        const ctx = BackgroundTask.compactionContext("parent-compact-done")
        expect(ctx).toBeDefined()
        expect(ctx).toContain("Completed Background Tasks")
        expect(ctx).toContain("Build landing page")
        expect(ctx).toContain("COMPLETE")
      },
    })
  })
})
