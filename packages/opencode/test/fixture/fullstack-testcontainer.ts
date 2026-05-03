/**
 * Full Stack Testcontainer Fixture
 *
 * Spawns:
 * 1. Postgres container with migrations applied
 * 2. OpenCode server container (built from Dockerfile)
 *
 * Provides an OpenCodeClient SDK connected to the running stack.
 *
 * Usage:
 * ```typescript
 * test("full flow", async () => {
 *   await withFullStack(async ({ client, baseUrl }) => {
 *     const project = await client.createProject({ name: "Test Project" })
 *     const session = await client.createSession({ projectId: project.id })
 *     // ... etc
 *   })
 * })
 * ```
 */

import { GenericContainer, Network, Wait, type StartedNetwork, type StartedTestContainer } from "testcontainers"
import { Log } from "../../src/util/log"
import { OpenCode } from "../../src/client/sdk"
import path from "path"

const log = Log.create({ service: "fullstack-testcontainer" })

export interface FullStackContext {
  postgres: StartedTestContainer
  server: StartedTestContainer
  network: StartedNetwork
  client: ReturnType<typeof OpenCode.create>
  baseUrl: string
  dbUrl: string
}

// Track active containers for cleanup
const activeContainers: StartedTestContainer[] = []

/**
 * Start the full stack (Postgres + OpenCode server) for integration tests
 */
export async function startFullStack(): Promise<FullStackContext> {
  log.info("Starting full stack (Postgres + OpenCode server)...")

  // Create a network for containers to communicate
  const network = await new Network().start()

  // ========== Postgres Container ==========
  log.info("Starting Postgres container...")

  const postgres = await new GenericContainer("postgres:15-alpine")
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_USER: "veritly",
      POSTGRES_PASSWORD: "veritly",
      POSTGRES_DB: "veritly",
    })
    .withNetwork(network)
    .withNetworkAliases("postgres")
    .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections"))
    .start()

  activeContainers.push(postgres)

  const postgresHost = postgres.getHost()
  const postgresPort = postgres.getMappedPort(5432)
  const dbUrl = `postgresql://veritly:veritly@${postgresHost}:${postgresPort}/veritly`

  log.info("Postgres ready", { host: postgresHost, port: postgresPort })

  // ========== OpenCode Server Container ==========
  log.info("Building OpenCode server image...")

  // Get repo root: from packages/opencode/test/fixture -> repo root is 4 levels up
  const repoRoot = path.resolve(__dirname, "../../../..")

  // Build server from Dockerfile (or use a simpler approach with bun directly)
  // For now, we'll use a node/bun base image with the code mounted
  const server = await new GenericContainer("oven/bun:1.1")
    .withExposedPorts(4096)
    .withEnvironment({
      DATABASE_URL: dbUrl,
      PORT: "4096",
      NODE_ENV: "test",
      // No WorkOS in container; open API (no OPENCODE_SERVER_PASSWORD) + PG tenant id
      OPENCODE_WORKOS_ENABLED: "false",
      OPENCODE_E2E_USER_ID: "testcontainer-user",
      OPENCODE_SERVER_PASSWORD: "",
    })
    .withNetwork(network)
    .withBindMounts([
      {
        source: repoRoot,
        target: "/app",
        mode: "ro",
      },
    ])
    .withWorkingDir("/app/packages/opencode")
    .withCommand([
      "sh",
      "-c",
      // Initialize DB, run migrations, then start server
      // All in one command so we don't need a separate start.ts
      `echo "Initializing database..." && 
       bun -e '
         const { Database } = await import("./src/storage/db.pg");
         await Database.initialize();
         const { runPostgresMigrations } = await import("./src/storage/migrate-pg");
         await runPostgresMigrations();
         console.log("Migrations complete");
       ' &&
       echo "Starting server..." && 
       bun -e '
         const { Server } = await import("./src/server/server");
         const { Database } = await import("./src/storage/db.pg");
         Server.listen({ port: 4096, hostname: "0.0.0.0" });
         console.log("Server listening on :4096");
       '`,
    ])
    .withWaitStrategy(Wait.forHttp("/readyz", 4096))
    .withStartupTimeout(60000)
    .start()

  activeContainers.push(server)

  const serverHost = server.getHost()
  const serverPort = server.getMappedPort(4096)
  const baseUrl = `http://${serverHost}:${serverPort}`

  log.info("OpenCode server ready", { host: serverHost, port: serverPort, baseUrl })

  // Create client
  const client = OpenCode.create({
    baseUrl,
    tenantUserId: "test_user_integration",
  })

  return {
    postgres,
    server,
    network,
    client,
    baseUrl,
    dbUrl,
  }
}

/**
 * Stop the full stack
 */
export async function stopFullStack(ctx: FullStackContext): Promise<void> {
  log.info("Stopping full stack...")

  if (ctx.server) {
    await ctx.server.stop()
    const idx1 = activeContainers.indexOf(ctx.server)
    if (idx1 > -1) activeContainers.splice(idx1, 1)
  }

  if (ctx.postgres) {
    await ctx.postgres.stop()
    const idx2 = activeContainers.indexOf(ctx.postgres)
    if (idx2 > -1) activeContainers.splice(idx2, 1)
  }

  if (ctx.network) {
    await ctx.network.stop()
  }

  log.info("Full stack stopped")
}

/**
 * Cleanup all active containers
 */
export async function cleanupFullStack(): Promise<void> {
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
 * Test helper that provides full stack context
 */
export async function withFullStack<T>(fn: (ctx: FullStackContext) => Promise<T>): Promise<T> {
  const ctx = await startFullStack()
  try {
    return await fn(ctx)
  } finally {
    await stopFullStack(ctx)
  }
}
