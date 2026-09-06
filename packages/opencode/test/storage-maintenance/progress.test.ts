import { afterEach, describe, expect, test } from "bun:test"
import { StorageMaintenanceProgress } from "@/storage-maintenance/progress"

let token = ""

afterEach(() => {
  if (token) StorageMaintenanceProgress.finish(token)
  token = ""
})

describe("StorageMaintenanceProgress", () => {
  test("reports operation phases and resets when the active operation finishes", () => {
    token = StorageMaintenanceProgress.begin("analyze", "analyze")
    StorageMaintenanceProgress.update(token, { phase: "index", completed: 25, total: 100, workers: 1 })

    expect(StorageMaintenanceProgress.current()).toMatchObject({
      operation: "analyze",
      phase: "index",
      completed: 25,
      total: 100,
      workers: 1,
    })

    StorageMaintenanceProgress.finish(token)
    token = ""
    expect(StorageMaintenanceProgress.current()).toMatchObject({ operation: null, phase: "idle", workers: 0 })
  })

  test("ignores stale updates and completion tokens", () => {
    const stale = StorageMaintenanceProgress.begin("backup", "backup")
    token = StorageMaintenanceProgress.begin("vacuum", "vacuum")

    StorageMaintenanceProgress.update(stale, { phase: "backup", completed: 1, total: 1, workers: 1 })
    StorageMaintenanceProgress.finish(stale)

    expect(StorageMaintenanceProgress.current()).toMatchObject({ operation: "vacuum", phase: "vacuum" })
  })
})
