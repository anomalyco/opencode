import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { eq, and, desc } from "drizzle-orm"
import { streamSSE } from "hono/streaming"
import { db, schema } from "../../db/client"
import { authMiddleware } from "../../auth/middleware"
import { promptQueue, promptQueueEvents } from "../../queue/client"

export function TaskRoutes() {
  return new Hono()
    .use(authMiddleware)

    // List tasks
    .get("/", async (c) => {
      const { userId } = c.get("user")
      const sessionId = c.req.query("sessionId")
      const status = c.req.query("status")
      const limit = parseInt(c.req.query("limit") ?? "20", 10)
      const offset = parseInt(c.req.query("offset") ?? "0", 10)

      let whereClause = eq(schema.tasks.userId, userId)

      if (sessionId) {
        whereClause = and(whereClause, eq(schema.tasks.sessionId, sessionId))!
      }

      if (status) {
        whereClause = and(whereClause, eq(schema.tasks.status, status as any))!
      }

      const tasks = await db.query.tasks.findMany({
        where: whereClause,
        orderBy: desc(schema.tasks.createdAt),
        limit,
        offset,
        columns: {
          id: true,
          sessionId: true,
          type: true,
          status: true,
          progress: true,
          error: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
        },
      })

      return c.json({ tasks })
    })

    // Get task by ID
    .get("/:id", async (c) => {
      const { userId } = c.get("user")
      const taskId = c.req.param("id")

      const task = await db.query.tasks.findFirst({
        where: and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)),
      })

      if (!task) {
        throw new HTTPException(404, { message: "Task not found" })
      }

      return c.json({ task })
    })

    // Cancel task
    .delete("/:id", async (c) => {
      const { userId } = c.get("user")
      const taskId = c.req.param("id")

      const task = await db.query.tasks.findFirst({
        where: and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)),
      })

      if (!task) {
        throw new HTTPException(404, { message: "Task not found" })
      }

      if (task.status !== "pending" && task.status !== "running") {
        throw new HTTPException(400, { message: "Task cannot be cancelled" })
      }

      // Try to remove from queue
      if (task.bullmqJobId) {
        try {
          const job = await promptQueue.getJob(task.bullmqJobId)
          if (job) {
            await job.remove()
          }
        } catch {
          // Job might already be processing
        }
      }

      // Update task status
      await db
        .update(schema.tasks)
        .set({
          status: "cancelled",
          completedAt: new Date(),
        })
        .where(eq(schema.tasks.id, taskId))

      return c.json({ success: true })
    })

    // SSE stream for task progress
    .get("/:id/stream", async (c) => {
      const { userId } = c.get("user")
      const taskId = c.req.param("id")

      const task = await db.query.tasks.findFirst({
        where: and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)),
      })

      if (!task) {
        throw new HTTPException(404, { message: "Task not found" })
      }

      return streamSSE(c, async (stream) => {
        // If task is already completed, send final status and close
        if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
          await stream.writeSSE({
            event: "status",
            data: JSON.stringify({
              status: task.status,
              output: task.output,
              error: task.error,
            }),
          })
          return
        }

        // Send initial status
        await stream.writeSSE({
          event: "status",
          data: JSON.stringify({
            status: task.status,
            progress: task.progress,
          }),
        })

        // Listen for job events
        const handleCompleted = async (args: { jobId: string; returnvalue: any }) => {
          if (args.jobId === taskId) {
            await stream.writeSSE({
              event: "completed",
              data: JSON.stringify(args.returnvalue),
            })
          }
        }

        const handleFailed = async (args: { jobId: string; failedReason: string }) => {
          if (args.jobId === taskId) {
            await stream.writeSSE({
              event: "failed",
              data: JSON.stringify({ error: args.failedReason }),
            })
          }
        }

        const handleProgress = async (args: { jobId: string; data: any }) => {
          if (args.jobId === taskId) {
            await stream.writeSSE({
              event: "progress",
              data: JSON.stringify(args.data),
            })
          }
        }

        promptQueueEvents.on("completed", handleCompleted)
        promptQueueEvents.on("failed", handleFailed)
        promptQueueEvents.on("progress", handleProgress)

        // Keep connection alive with heartbeat
        const heartbeatInterval = setInterval(async () => {
          try {
            await stream.writeSSE({ event: "heartbeat", data: "" })
          } catch {
            clearInterval(heartbeatInterval)
          }
        }, 30000)

        // Wait for stream to close
        await stream.sleep(Number.MAX_SAFE_INTEGER)

        // Cleanup
        clearInterval(heartbeatInterval)
        promptQueueEvents.off("completed", handleCompleted)
        promptQueueEvents.off("failed", handleFailed)
        promptQueueEvents.off("progress", handleProgress)
      })
    })
}
