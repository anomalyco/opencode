import { test, expect } from "bun:test"
import { BackgroundWorkers } from "../../src/worker/background-workers"
import { WorkerConfig } from "../../src/config/worker-config"

test("background workers config schema", () => {
  const validationConfig = WorkerConfig.BackgroundValidation.parse({
    enabled: true,
    commands: ["bun run lint", "bun run typecheck"],
  })

  expect(validationConfig.enabled).toBe(true)
  expect(validationConfig.commands).toEqual(["bun run lint", "bun run typecheck"])
  expect(validationConfig.debounceMs).toBe(2000) // default
})

test("prefetch worker config schema", () => {
  const prefetchConfig = WorkerConfig.PrefetchWorker.parse({
    enabled: true,
    maxCacheSize: 100 * 1024 * 1024,
  })

  expect(prefetchConfig.enabled).toBe(true)
  expect(prefetchConfig.maxCacheSize).toBe(100 * 1024 * 1024)
  expect(prefetchConfig.maxConcurrent).toBe(3) // default
  expect(prefetchConfig.strategies).toEqual(["import", "related"]) // default
})

test("background workers initialization with config", async () => {
  const config = {
    validation: { enabled: false },
    prefetch: { enabled: false },
  }

  // Should not throw
  await BackgroundWorkers.init(config)

  const workerConfig = BackgroundWorkers.getConfig()
  expect(workerConfig?.validation.enabled).toBe(false)
  expect(workerConfig?.prefetch.enabled).toBe(false)

  await BackgroundWorkers.shutdown()
})

test("background workers state management", async () => {
  // With workers disabled, state should return null
  await BackgroundWorkers.init({
    validation: { enabled: false },
    prefetch: { enabled: false },
  })

  const validationState = await BackgroundWorkers.getValidationState()
  const prefetchState = await BackgroundWorkers.getPrefetchState()

  expect(validationState).toBeNull()
  expect(prefetchState).toBeNull()

  await BackgroundWorkers.shutdown()
})

test("background workers config update", async () => {
  await BackgroundWorkers.init({
    validation: { enabled: false },
    prefetch: { enabled: false },
  })

  BackgroundWorkers.updateConfig({
    validation: { commands: ["custom-lint"] },
  })

  const config = BackgroundWorkers.getConfig()
  expect(config?.validation.commands).toContain("custom-lint")

  await BackgroundWorkers.shutdown()
})
