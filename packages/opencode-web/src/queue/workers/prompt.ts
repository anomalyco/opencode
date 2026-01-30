import { Worker, Job } from "bullmq"
import { eq, and } from "drizzle-orm"
import { redis, type PromptJobData, QUEUE_NAMES } from "../client"
import { db, schema } from "../../db/client"
import { ContainerManager } from "../../container/manager"

export function createPromptWorker() {
  return new Worker<PromptJobData>(
    QUEUE_NAMES.PROMPT,
    async (job: Job<PromptJobData>) => {
      const { taskId, sessionId, userId, input } = job.data

      console.log(`Processing prompt job ${job.id} for session ${sessionId}`)

      try {
        // Update task status to running
        await db
          .update(schema.tasks)
          .set({
            status: "running",
            startedAt: new Date(),
          })
          .where(eq(schema.tasks.id, taskId))

        // Get session with project info
        const session = await db.query.sessions.findFirst({
          where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)),
          with: {
            project: true,
          },
        })

        if (!session) {
          throw new Error("Session not found")
        }

        // @ts-ignore - with relation typing
        const workspaceVolume = session.project?.workspaceVolume
        if (!workspaceVolume) {
          throw new Error("Project has no workspace volume")
        }

        // Ensure container is running
        await job.updateProgress({ stage: "starting_container" })
        const container = await ContainerManager.ensureRunning(sessionId, workspaceVolume)

        // Update session with container info
        await db
          .update(schema.sessions)
          .set({
            containerId: container.id,
            containerIp: container.ip,
            containerAuthToken: container.authToken,
            containerStatus: "running",
          })
          .where(eq(schema.sessions.id, sessionId))

        // Send prompt to container
        await job.updateProgress({ stage: "sending_prompt" })

        const response = await ContainerManager.fetch(sessionId, "/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectID: session.projectId,
            // Create session in opencode if not exists
            ...(session.opencodeSessionId
              ? { sessionID: session.opencodeSessionId }
              : { create: true }),
          }),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Failed to create opencode session: ${error}`)
        }

        const opencodeSession = await response.json()

        // Update with opencode session ID if new
        if (!session.opencodeSessionId && opencodeSession.id) {
          await db
            .update(schema.sessions)
            .set({ opencodeSessionId: opencodeSession.id })
            .where(eq(schema.sessions.id, sessionId))
        }

        // Send the actual message
        await job.updateProgress({ stage: "processing" })

        const messageResponse = await ContainerManager.fetch(
          sessionId,
          `/session/${opencodeSession.id}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              parts: input.parts.map((p) => ({
                type: p.type === "text" ? "text" : p.type,
                [p.type === "text" ? "text" : "content"]: p.content,
              })),
              agent: input.agent,
              model: input.model,
            }),
          }
        )

        if (!messageResponse.ok) {
          const error = await messageResponse.text()
          throw new Error(`Failed to send message: ${error}`)
        }

        const result = await messageResponse.json()

        // Store message in database
        await db.insert(schema.messages).values({
          sessionId,
          opencodeMessageId: result.id,
          role: "user",
          content: input.parts.map((p) => p.content).join("\n"),
          parts: input.parts,
        })

        // Update task as completed
        await db
          .update(schema.tasks)
          .set({
            status: "completed",
            output: result,
            completedAt: new Date(),
          })
          .where(eq(schema.tasks.id, taskId))

        // Update session
        await db
          .update(schema.sessions)
          .set({
            updatedAt: new Date(),
            lastModel: input.model ? { modelID: input.model } : undefined,
          })
          .where(eq(schema.sessions.id, sessionId))

        return result
      } catch (error) {
        console.error(`Prompt job ${job.id} failed:`, error)

        // Update task as failed
        await db
          .update(schema.tasks)
          .set({
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date(),
          })
          .where(eq(schema.tasks.id, taskId))

        throw error
      }
    },
    {
      connection: redis,
      concurrency: 10,
      limiter: {
        max: 100,
        duration: 60000, // 100 jobs per minute
      },
    }
  )
}
