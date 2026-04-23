/**
 * Executor Test Fixture - Docker Compose Edition
 * 
 * Connects to the executor service running in Docker Compose.
 * This is NOT a testcontainer - it assumes the infrastructure is already running.
 * 
 * PREREQUISITE: docker compose -f docker-compose.e2e.yml up -d executor
 */

import { Log } from "../../src/util/log"
import { Executor } from "../../src/executor/sdk"

const log = Log.create({ service: "executor-fixture" })

const EXECUTOR_URL = process.env.VERITLY_EXECUTOR_URL ?? "http://localhost:8080"

export interface ExecutorTestContext {
  sdk: ReturnType<typeof Executor.create>
  url: string
}

/**
 * Check if executor is available
 * Fails fast if executor is not running
 */
export async function checkExecutor(): Promise<void> {
  log.info("Checking executor availability...", { url: EXECUTOR_URL })
  
  try {
    const res = await fetch(`${EXECUTOR_URL}/health`)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    log.info("✓ Executor is available")
  } catch (error) {
    log.error("✗ Executor is not available", { url: EXECUTOR_URL, error })
    throw new Error(
      `Executor not available at ${EXECUTOR_URL}. ` +
      "Run: docker compose -f docker-compose.e2e.yml up -d executor"
    )
  }
}

/**
 * Get executor SDK client
 * Use this in tests - it assumes executor is already running
 */
export function getExecutor(): ExecutorTestContext {
  return {
    sdk: Executor.create({ baseUrl: EXECUTOR_URL }),
    url: EXECUTOR_URL,
  }
}

/**
 * Test helper that verifies executor is available
 * 
 * Usage:
 * ```typescript
 * test("runs command in executor", async () => {
 *   await withExecutor(async (executor) => {
 *     const result = await executor.sdk.exec("session-1", "echo hello")
 *     expect(result.output).toContain("hello")
 *   })
 * })
 * ```
 */
export async function withExecutor<T>(
  fn: (ctx: ExecutorTestContext) => Promise<T>,
): Promise<T> {
  await checkExecutor()
  const ctx = getExecutor()
  return await fn(ctx)
}
