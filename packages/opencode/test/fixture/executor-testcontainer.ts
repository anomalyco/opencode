/**
 * Executor Testcontainer Fixture
 * 
 * Provides isolated executor instances for tests using testcontainers.
 * This builds from the actual Dockerfile.executor to ensure tests run
 * against the real executor image with Python and Univer SDK.
 */

import { GenericContainer, GenericContainerBuilder, StartedTestContainer, Wait } from "testcontainers"
import { Log } from "../../src/util/log"
import { Executor } from "../../src/executor/sdk"
import path from "path"

const log = Log.create({ service: "executor-testcontainer" })

export interface ExecutorTestContext {
  container: StartedTestContainer
  sdk: ReturnType<typeof Executor.create>
  url: string
  host: string
  port: number
}

// Track active containers for cleanup
const activeContainers: StartedTestContainer[] = []

/**
 * Start an executor container for testing
 * 
 * Builds from the actual Dockerfile.executor to ensure tests run against
 * the real executor image with Python and Univer SDK pre-installed.
 */
export async function startExecutorContainer(): Promise<ExecutorTestContext> {
  log.info("Building and starting executor container from Dockerfile.executor...")

  // Get repo root: from packages/opencode/test/fixture -> repo root is 4 levels up
  const repoRoot = path.resolve(__dirname, "../../../..")
  
  log.debug("Building from", { repoRoot })

  // Build from the actual Dockerfile.executor
  // This creates a real executor image with Python and Univer SDK
  const builder = new GenericContainerBuilder(repoRoot, "docker/Dockerfile.executor")
  const imageName = await builder.build()
  
  log.info("Docker image built", { image: String(imageName) })
  
  const container = await new GenericContainer(String(imageName))
    .withExposedPorts(7777)
    .withEnvironment({
      PORT: "7777",
      VM_DATA_DIR: "/tmp/veritly-vms",
    })
    .withPrivilegedMode() // Required for Firecracker (even if not used in container mode)
    .withWaitStrategy(Wait.forHttp("/health", 7777))
    .withStartupTimeout(30000) // 30s for container startup
    .start()

  activeContainers.push(container)

  const host = container.getHost()
  const port = container.getMappedPort(7777)
  const url = `http://${host}:${port}`

  log.info("Executor container started", { host, port, url })

  const sdk = Executor.create({ baseUrl: url })

  return {
    container,
    sdk,
    url,
    host,
    port,
  }
}

/**
 * Stop an executor container
 */
export async function stopExecutorContainer(ctx: ExecutorTestContext): Promise<void> {
  if (ctx?.container) {
    log.info("Stopping executor container...")
    await ctx.container.stop()
    const index = activeContainers.indexOf(ctx.container)
    if (index > -1) {
      activeContainers.splice(index, 1)
    }
    log.info("Executor container stopped")
  }
}

/**
 * Cleanup all active containers (call in global teardown)
 */
export async function cleanupAllContainers(): Promise<void> {
  log.info(`Cleaning up ${activeContainers.length} active containers...`)
  for (const container of [...activeContainers]) {
    try {
      await container.stop()
    } catch (error) {
      log.error("Failed to stop container", { error })
    }
  }
  activeContainers.length = 0
}

/**
 * Test helper that provides an executor container to tests
 * Automatically handles setup and teardown
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
  const ctx = await startExecutorContainer()
  try {
    return await fn(ctx)
  } finally {
    await stopExecutorContainer(ctx)
  }
}
