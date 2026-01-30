import { config } from "./config"
import { createApp } from "./server/app"
import { createPromptWorker } from "./queue/workers/prompt"
import { createCleanupWorker, startCleanupScheduler } from "./queue/workers/cleanup"

console.log("Starting OpenCode Web API Gateway...")

// Create Hono app
const app = createApp()

// Start BullMQ workers
const promptWorker = createPromptWorker()
const cleanupWorker = createCleanupWorker()

// Start cleanup scheduler
const stopCleanupScheduler = startCleanupScheduler()

// Worker event handlers
promptWorker.on("completed", (job) => {
  console.log(`Prompt job ${job.id} completed`)
})

promptWorker.on("failed", (job, err) => {
  console.error(`Prompt job ${job?.id} failed:`, err.message)
})

cleanupWorker.on("completed", (job) => {
  console.log(`Cleanup job ${job.id} completed`)
})

cleanupWorker.on("failed", (job, err) => {
  console.error(`Cleanup job ${job?.id} failed:`, err.message)
})

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down...")

  stopCleanupScheduler()

  await Promise.all([promptWorker.close(), cleanupWorker.close()])

  console.log("Workers closed")
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

// Start server
const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  fetch: app.fetch,
})

console.log(`OpenCode Web API Gateway listening on http://${server.hostname}:${server.port}`)
console.log(`Environment: ${process.env.NODE_ENV ?? "development"}`)
