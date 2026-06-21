import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as ScheduleService, layer as ScheduleLayer } from "../src/schedule/service"
import { Database } from "../src/database/database"
import { it } from "./lib/effect"

function layer() {
  return ScheduleLayer.pipe(
    Layer.provide(Database.layerFromPath(":memory:").pipe(Layer.fresh)),
  )
}

describe("ScheduleService", () => {
  it.live("creates, lists, and deactivates background tasks", () =>
    Effect.gen(function* () {
      const scheduler = yield* ScheduleService
      
      // Create tasks
      const task1 = yield* scheduler.create("*/5 * * * *", "echo 'hello zero'")
      expect(task1.cron).toBe("*/5 * * * *")
      expect(task1.command).toBe("echo 'hello zero'")
      expect(task1.active).toBe(1)
      
      const task2 = yield* scheduler.create("10m", "echo 'hello daemon'")
      expect(task2.cron).toBe("10m")
      
      // List tasks
      const list = yield* scheduler.list()
      expect(list.length).toBe(2)
      
      // Deactivate a task
      yield* scheduler.deactivate(task1.id)
      const listAfterDeactivate = yield* scheduler.list()
      const task1Refreshed = listAfterDeactivate.find(t => t.id === task1.id)
      expect(task1Refreshed?.active).toBe(0)
    }).pipe(Effect.provide(layer())),
  )
})
