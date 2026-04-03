/**
 * HTTP Channel
 *
 * Exposes OpenAgent as a REST API using Hono (same framework as OpenCode server).
 * External systems, CI pipelines, and dashboards submit tasks via this API.
 *
 * Routes:
 *   POST /tasks              - Submit a new task
 *   GET  /tasks              - List all tasks
 *   GET  /tasks/:id          - Get task status and result
 *   DELETE /tasks/:id        - Cancel a pending task
 *   GET  /tasks/:id/stream   - SSE stream for real-time task progress
 *   GET  /pool/stats         - Session pool statistics
 *   GET  /queue/stats        - Task queue statistics
 *   GET  /health             - Health check
 */

import { Hono } from "hono"
import { z } from "zod"
import type { Task, TaskProgressUpdate } from "../task/task.ts"
import { CreateTaskInput } from "../task/task.ts"

type AgentContext = {
  submitTask: (input: { title: string; description: string; priority?: string; onProgress?: Task["onProgress"] }) => Promise<{ taskId: string; result: Promise<string> }>
  getTask: (id: string) => Task | undefined
  listTasks: () => Task[]
  cancelTask: (id: string) => boolean
  poolStats: () => Record<string, unknown>
  queueStats: () => Record<string, unknown>
}

/**
 * Creates the Hono HTTP application for OpenAgent.
 * The agent context is injected from the main OpenAgent instance.
 */
export function createHttpApp(ctx: AgentContext): Hono {
  const app = new Hono()

  // ── Health ────────────────────────────────────────────────────────────────

  app.get("/health", (c) => c.json({ status: "ok", service: "openagent" }))

  // ── Pool & Queue Stats ─────────────────────────────────────────────────────

  app.get("/pool/stats", (c) => c.json(ctx.poolStats()))
  app.get("/queue/stats", (c) => c.json(ctx.queueStats()))

  // ── Tasks ─────────────────────────────────────────────────────────────────

  app.get("/tasks", (c) => {
    const tasks = ctx.listTasks().map(serializeTask)
    return c.json(tasks)
  })

  app.get("/tasks/:id", (c) => {
    const task = ctx.getTask(c.req.param("id"))
    if (!task) return c.json({ error: "Task not found" }, 404)
    return c.json(serializeTask(task))
  })

  app.delete("/tasks/:id", (c) => {
    const cancelled = ctx.cancelTask(c.req.param("id"))
    if (!cancelled) return c.json({ error: "Task not found or already running" }, 404)
    return c.json({ cancelled: true })
  })

  // Submit a new task (fire-and-poll)
  app.post("/tasks", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = CreateTaskInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "Validation error", details: parsed.error.flatten() }, 422)
    }

    const { taskId, result } = await ctx.submitTask(parsed.data)

    // Don't await the result — let it run async. Client polls /tasks/:id
    result.catch(() => {})

    return c.json({ taskId, status: "pending" }, 202)
  })

  // Submit a task and wait for result (synchronous, for simple integrations)
  app.post("/tasks/sync", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    const parsed = CreateTaskInput.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "Validation error", details: parsed.error.flatten() }, 422)
    }

    try {
      const { taskId, result } = await ctx.submitTask(parsed.data)
      const text = await result
      const task = ctx.getTask(taskId)
      return c.json({ taskId, status: "completed", result: text, task: task ? serializeTask(task) : undefined })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // SSE stream for real-time task progress
  app.get("/tasks/:id/stream", async (c) => {
    const task = ctx.getTask(c.req.param("id"))
    if (!task) return c.json({ error: "Task not found" }, 404)

    // If already done, return immediately
    if (task.status === "completed" || task.status === "failed") {
      return c.json(serializeTask(task))
    }

    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()

          const send = (data: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          }

          // Attach progress listener to task
          const originalProgress = task.onProgress
          task.onProgress = async (update) => {
            if (originalProgress) await originalProgress(update)
            send(update)
            if (update.type === "completed" || update.type === "failed") {
              controller.close()
            }
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    )
  })

  return app
}

function serializeTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    source: task.source,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString(),
    completedAt: task.completedAt?.toISOString(),
    subtasks: task.subtasks.map((s) => ({
      id: s.id,
      description: s.description,
      agentRole: s.agentRole,
      status: s.status,
      result: s.result ? s.result.slice(0, 500) + (s.result.length > 500 ? "…" : "") : undefined,
      error: s.error,
      sessionId: s.sessionId,
    })),
  }
}
