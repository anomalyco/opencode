import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { HTTPException } from "hono/http-exception"
import { eq, and, desc, isNull } from "drizzle-orm"
import { streamSSE } from "hono/streaming"
import { db, schema } from "../../db/client"
import { authMiddleware } from "../../auth/middleware"
import { ContainerManager } from "../../container/manager"
import { promptQueue, type PromptJobData } from "../../queue/client"

const createSessionSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().max(500).optional(),
})

const promptSchema = z.object({
  parts: z.array(
    z.object({
      type: z.enum(["text", "file", "image"]),
      content: z.string(),
    })
  ),
  agent: z.string().optional(),
  model: z.string().optional(),
})

const permissionResponseSchema = z.object({
  reply: z.enum(["once", "always", "reject"]),
  pattern: z.string().optional(),
})

export function SessionRoutes() {
  return new Hono()
    .use(authMiddleware)

    // List sessions
    .get("/", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.query("projectId")

      const whereClause = projectId
        ? and(
            eq(schema.sessions.userId, userId),
            eq(schema.sessions.projectId, projectId),
            isNull(schema.sessions.archivedAt)
          )
        : and(eq(schema.sessions.userId, userId), isNull(schema.sessions.archivedAt))

      const sessions = await db.query.sessions.findMany({
        where: whereClause,
        orderBy: desc(schema.sessions.updatedAt),
        columns: {
          id: true,
          projectId: true,
          title: true,
          containerStatus: true,
          lastModel: true,
          summary: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      return c.json({ sessions })
    })

    // Create session
    .post("/", zValidator("json", createSessionSchema), async (c) => {
      const { userId } = c.get("user")
      const data = c.req.valid("json")

      // Verify project exists and belongs to user
      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, data.projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      const [session] = await db
        .insert(schema.sessions)
        .values({
          userId,
          projectId: data.projectId,
          title: data.title,
          containerStatus: "stopped",
        })
        .returning()

      return c.json({ session }, 201)
    })

    // Get session by ID
    .get("/:id", async (c) => {
      const { userId } = c.get("user")
      const sessionId = c.req.param("id")

      const session = await db.query.sessions.findFirst({
        where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)),
      })

      if (!session) {
        throw new HTTPException(404, { message: "Session not found" })
      }

      // Get container status
      const container = ContainerManager.get(sessionId)

      return c.json({
        session: {
          ...session,
          containerStatus: container?.status ?? session.containerStatus,
        },
      })
    })

    // Delete/archive session
    .delete("/:id", async (c) => {
      const { userId } = c.get("user")
      const sessionId = c.req.param("id")

      const session = await db.query.sessions.findFirst({
        where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)),
      })

      if (!session) {
        throw new HTTPException(404, { message: "Session not found" })
      }

      // Stop container if running
      await ContainerManager.stop(sessionId)

      // Archive session instead of deleting
      await db
        .update(schema.sessions)
        .set({
          archivedAt: new Date(),
          containerStatus: "stopped",
        })
        .where(eq(schema.sessions.id, sessionId))

      return c.json({ success: true })
    })

    // Start container for session
    .post("/:id/start", async (c) => {
      const { userId } = c.get("user")
      const sessionId = c.req.param("id")

      const session = await db.query.sessions.findFirst({
        where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)),
        with: {
          project: true,
        },
      })

      if (!session) {
        throw new HTTPException(404, { message: "Session not found" })
      }

      // @ts-ignore - with relation typing
      if (!session.project?.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      // Start container
      // @ts-ignore - with relation typing
      const container = await ContainerManager.ensureRunning(sessionId, session.project.workspaceVolume)

      // Update session with container info
      await db
        .update(schema.sessions)
        .set({
          containerId: container.id,
          containerIp: container.ip,
          containerAuthToken: container.authToken,
          containerStatus: "running",
          updatedAt: new Date(),
        })
        .where(eq(schema.sessions.id, sessionId))

      return c.json({
        success: true,
        container: {
          status: container.status,
        },
      })
    })

    // Stop container for session
    .post("/:id/stop", async (c) => {
      const { userId } = c.get("user")
      const sessionId = c.req.param("id")

      const session = await db.query.sessions.findFirst({
        where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)),
      })

      if (!session) {
        throw new HTTPException(404, { message: "Session not found" })
      }

      await ContainerManager.stop(sessionId)

      await db
        .update(schema.sessions)
        .set({
          containerStatus: "stopped",
          updatedAt: new Date(),
        })
        .where(eq(schema.sessions.id, sessionId))

      return c.json({ success: true })
    })

    // Send prompt (async via queue)
    .post("/:id/prompt", zValidator("json", promptSchema), async (c) => {
      const { userId } = c.get("user")
      const sessionId = c.req.param("id")
      const input = c.req.valid("json")

      const session = await db.query.sessions.findFirst({
        where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)),
        with: {
          project: true,
        },
      })

      if (!session) {
        throw new HTTPException(404, { message: "Session not found" })
      }

      // Create task record
      const [task] = await db
        .insert(schema.tasks)
        .values({
          userId,
          sessionId,
          type: "prompt",
          status: "pending",
          input,
        })
        .returning()

      // Add to queue
      const job = await promptQueue.add(
        "prompt",
        {
          taskId: task.id,
          sessionId,
          userId,
          input,
        } as PromptJobData,
        {
          jobId: task.id,
        }
      )

      // Update task with job ID
      await db
        .update(schema.tasks)
        .set({ bullmqJobId: job.id })
        .where(eq(schema.tasks.id, task.id))

      return c.json({ taskId: task.id }, 202)
    })

    // SSE event stream (proxy from container)
    .get("/:id/events", async (c) => {
      const { userId } = c.get("user")
      const sessionId = c.req.param("id")

      const session = await db.query.sessions.findFirst({
        where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)),
      })

      if (!session) {
        throw new HTTPException(404, { message: "Session not found" })
      }

      const container = ContainerManager.get(sessionId)
      if (!container || container.status !== "running") {
        throw new HTTPException(400, { message: "Container is not running" })
      }

      return streamSSE(c, async (stream) => {
        try {
          // Connect to container's event stream
          const response = await ContainerManager.fetch(sessionId, "/event")

          if (!response.ok) {
            await stream.writeSSE({ event: "error", data: "Failed to connect to container" })
            return
          }

          const reader = response.body?.getReader()
          if (!reader) {
            await stream.writeSSE({ event: "error", data: "No response body" })
            return
          }

          const decoder = new TextDecoder()

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const text = decoder.decode(value, { stream: true })

            // Forward raw SSE data
            // The container sends properly formatted SSE events
            await stream.write(text)
          }
        } catch (error) {
          console.error("SSE stream error:", error)
          await stream.writeSSE({
            event: "error",
            data: error instanceof Error ? error.message : "Unknown error",
          })
        }
      })
    })

    // Get messages for session
    .get("/:id/messages", async (c) => {
      const { userId } = c.get("user")
      const sessionId = c.req.param("id")

      const session = await db.query.sessions.findFirst({
        where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)),
      })

      if (!session) {
        throw new HTTPException(404, { message: "Session not found" })
      }

      const messages = await db.query.messages.findMany({
        where: eq(schema.messages.sessionId, sessionId),
        orderBy: schema.messages.createdAt,
      })

      return c.json({ messages })
    })

    // Respond to permission request
    .post(
      "/:id/permissions/:permissionId",
      zValidator("json", permissionResponseSchema),
      async (c) => {
        const { userId } = c.get("user")
        const sessionId = c.req.param("id")
        const permissionId = c.req.param("permissionId")
        const data = c.req.valid("json")

        const session = await db.query.sessions.findFirst({
          where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)),
        })

        if (!session) {
          throw new HTTPException(404, { message: "Session not found" })
        }

        const container = ContainerManager.get(sessionId)
        if (!container || container.status !== "running") {
          throw new HTTPException(400, { message: "Container is not running" })
        }

        // Forward permission response to container
        const response = await ContainerManager.fetch(sessionId, `/permission/${permissionId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new HTTPException(response.status as any, { message: error })
        }

        return c.json({ success: true })
      }
    )
}
