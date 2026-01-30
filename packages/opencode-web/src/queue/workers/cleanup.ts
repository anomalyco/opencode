import { Worker } from "bullmq"
import { eq } from "drizzle-orm"
import { redis, type CleanupJobData, QUEUE_NAMES, cleanupQueue } from "../client"
import { db, schema } from "../../db/client"
import { ContainerManager } from "../../container/manager"

export function createCleanupWorker() {
  return new Worker<CleanupJobData>(
    QUEUE_NAMES.CLEANUP,
    async (job) => {
      const { sessionId, containerId, reason } = job.data

      console.log(`Cleaning up container ${containerId} for session ${sessionId} (reason: ${reason})`)

      try {
        // Stop and remove container
        await ContainerManager.stop(sessionId)

        // Update session status in database
        await db
          .update(schema.sessions)
          .set({
            containerStatus: "stopped",
            updatedAt: new Date(),
          })
          .where(eq(schema.sessions.id, sessionId))

        console.log(`Successfully cleaned up container for session ${sessionId}`)
      } catch (error) {
        console.error(`Failed to cleanup container for session ${sessionId}:`, error)
        throw error
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  )
}

/**
 * Schedule cleanup jobs for idle containers
 * This should be called periodically (e.g., every 5 minutes)
 */
export async function scheduleIdleContainerCleanup() {
  const idleContainers = ContainerManager.getIdleContainers()

  for (const { sessionId, info } of idleContainers) {
    // Check if cleanup job already exists
    const existingJob = await cleanupQueue.getJob(`cleanup-${sessionId}`)
    if (existingJob) {
      continue
    }

    await cleanupQueue.add(
      "cleanup",
      {
        sessionId,
        containerId: info.id,
        reason: "idle",
      },
      {
        jobId: `cleanup-${sessionId}`,
      }
    )

    console.log(`Scheduled cleanup for idle container ${sessionId}`)
  }
}

/**
 * Start periodic cleanup scheduler
 */
export function startCleanupScheduler(intervalMs: number = 5 * 60 * 1000) {
  const interval = setInterval(async () => {
    try {
      await scheduleIdleContainerCleanup()
    } catch (error) {
      console.error("Failed to schedule cleanup:", error)
    }
  }, intervalMs)

  // Run immediately
  scheduleIdleContainerCleanup().catch(console.error)

  return () => clearInterval(interval)
}
