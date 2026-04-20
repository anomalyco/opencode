/**
 * Testcontainer fixture for executor API tests
 * 
 * This provides a way to spin up the executor service in a container
 * for tests that need actual filesystem operations.
 * 
 * TODO: This is a scaffold - needs to be completed when executor
 * Docker image is available.
 */

import { GenericContainer, StartedTestContainer, Wait } from "testcontainers"
import { Log } from "../../src/util/log"

const log = Log.create({ service: "testcontainer" })

export interface ExecutorContext {
  container: StartedTestContainer
  host: string
  port: number
  url: string
}

/**
 * Start an executor container for tests that need filesystem operations.
 * 
 * NOTE: Currently returns null as the executor Docker image is not yet built.
 * When the executor is containerized, this will:
 * 1. Build/pull the executor image
 * 2. Start a container
 * 3. Return the connection details
 */
export async function startExecutor(): Promise<ExecutorContext | null> {
  // TODO: Enable when executor Docker image is available
  log.info("Executor container not yet available - skipping")
  return null

  /* When ready, uncomment this:
  const container = await new GenericContainer("veritly-executor:latest")
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forHttp("/health", 8080))
    .withLogConsumer(stream => {
      stream.on("data", line => log.debug("executor", { line: line.toString() }))
    })
    .start()

  const host = container.getHost()
  const port = container.getMappedPort(8080)

  return {
    container,
    host,
    port,
    url: `http://${host}:${port}`,
  }
  */
}

/**
 * Stop the executor container
 */
export async function stopExecutor(ctx: ExecutorContext): Promise<void> {
  if (ctx?.container) {
    await ctx.container.stop()
    log.info("Executor container stopped")
  }
}

/**
 * Test helper that skips if executor is not available
 */
export function requireExecutor(fn: (ctx: ExecutorContext) => Promise<void>) {
  return async () => {
    const ctx = await startExecutor()
    if (!ctx) {
      log.warn("Skipping test - executor not available")
      return
    }

    try {
      await fn(ctx)
    } finally {
      await stopExecutor(ctx)
    }
  }
}
