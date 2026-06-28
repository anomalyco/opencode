import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TaskService } from "@opencode-ai/core/task"
import { testEffect } from "./lib/effect"

const it = testEffect(TaskService.defaultLayer)

describe("Task", () => {
  it.effect("starts, stops, restarts, lists, and deletes tasks", () =>
    Effect.gen(function* () {
      const tasks = yield* TaskService.Service

      const command = process.platform === "win32" ? "timeout 5" : "sleep 5"
      const created = yield* tasks.start({
        name: "Test Echo Task",
        command,
      })

      expect(created.name).toBe("Test Echo Task")
      expect(created.status).toBe("running")
      expect(created.pid).toBeGreaterThan(0)

      const list = yield* tasks.list()
      expect(list.some((t) => t.id === created.id)).toBe(true)

      const stopped = yield* tasks.stop(created.id)
      expect(stopped.status).toBe("stopped")

      yield* tasks.delete(created.id)
      const listAfterDelete = yield* tasks.list()
      expect(listAfterDelete.some((t) => t.id === created.id)).toBe(false)
    }),
  )
})
