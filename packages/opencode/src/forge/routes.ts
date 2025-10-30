import { Hono } from "hono"
import { TaskManager, type CreateTaskInput, type UpdateTaskInput } from "./task-manager"
import { z } from "zod"

/**
 * FORGE API Routes
 * Provides REST API endpoints for FORGE task management
 */

export const forgeRoutes = new Hono()

// ========================================
// Task CRUD Operations
// ========================================

/**
 * GET /forge/tasks
 * List all tasks
 */
forgeRoutes.get("/tasks", async (c) => {
  try {
    const tasks = await TaskManager.list()
    return c.json(tasks)
  } catch (error: any) {
    console.error("[FORGE] Failed to list tasks:", error)
    return c.json({ error: error.message }, 500)
  }
})

/**
 * POST /forge/tasks
 * Create a new task
 */
forgeRoutes.post("/tasks", async (c) => {
  try {
    const body = await c.req.json()
    const input = body as CreateTaskInput
    const task = await TaskManager.create(input)
    return c.json(task, 201)
  } catch (error: any) {
    console.error("[FORGE] Failed to create task:", error)
    return c.json({ error: error.message }, 400)
  }
})

/**
 * GET /forge/tasks/:id
 * Get a specific task
 */
forgeRoutes.get("/tasks/:id", async (c) => {
  try {
    const taskId = c.req.param("id")
    const task = await TaskManager.get(taskId)
    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to get task:", error)
    return c.json({ error: error.message }, 404)
  }
})

/**
 * PATCH /forge/tasks/:id
 * Update a task
 */
forgeRoutes.patch("/tasks/:id", async (c) => {
  try {
    const taskId = c.req.param("id")
    const body = await c.req.json()
    const input = body as UpdateTaskInput
    const task = await TaskManager.update(taskId, input)
    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to update task:", error)
    return c.json({ error: error.message }, 400)
  }
})

/**
 * DELETE /forge/tasks/:id
 * Delete a task
 */
forgeRoutes.delete("/tasks/:id", async (c) => {
  try {
    const taskId = c.req.param("id")
    await TaskManager.remove(taskId)
    return c.json({ success: true })
  } catch (error: any) {
    console.error("[FORGE] Failed to delete task:", error)
    return c.json({ error: error.message }, 404)
  }
})

// ========================================
// Task Execution Operations
// ========================================

/**
 * POST /forge/tasks/:id/start
 * Start task execution
 */
forgeRoutes.post("/tasks/:id/start", async (c) => {
  try {
    const taskId = c.req.param("id")
    const task = await TaskManager.update(taskId, { status: "in_progress" })

    // Add activity
    await TaskManager.addActivity(taskId, {
      type: "started",
      actor: "user",
      message: "Task execution started",
    })

    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to start task:", error)
    return c.json({ error: error.message }, 400)
  }
})

/**
 * POST /forge/tasks/:id/pause
 * Pause task execution
 */
forgeRoutes.post("/tasks/:id/pause", async (c) => {
  try {
    const taskId = c.req.param("id")
    const task = await TaskManager.update(taskId, { status: "blocked" })

    await TaskManager.addActivity(taskId, {
      type: "blocked",
      actor: "user",
      message: "Task execution paused",
    })

    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to pause task:", error)
    return c.json({ error: error.message }, 400)
  }
})

/**
 * POST /forge/tasks/:id/cancel
 * Cancel task execution
 */
forgeRoutes.post("/tasks/:id/cancel", async (c) => {
  try {
    const taskId = c.req.param("id")
    const task = await TaskManager.update(taskId, { status: "cancelled" })

    await TaskManager.addActivity(taskId, {
      type: "cancelled",
      actor: "user",
      message: "Task execution cancelled",
    })

    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to cancel task:", error)
    return c.json({ error: error.message }, 400)
  }
})

/**
 * POST /forge/tasks/:id/complete
 * Mark task as completed
 */
forgeRoutes.post("/tasks/:id/complete", async (c) => {
  try {
    const taskId = c.req.param("id")
    const now = Date.now()

    const task = await TaskManager.get(taskId)
    const duration = task.startedAt ? now - task.startedAt : undefined

    const updated = await TaskManager.update(taskId, {
      status: "done",
    })

    // Update completed timestamp manually
    updated.completedAt = now
    await TaskManager.update(taskId, {})

    await TaskManager.addActivity(taskId, {
      type: "completed",
      actor: "agent",
      message: `Task completed${duration ? ` in ${Math.round(duration / 1000)}s` : ""}`,
      metadata: { duration },
    })

    return c.json(updated)
  } catch (error: any) {
    console.error("[FORGE] Failed to complete task:", error)
    return c.json({ error: error.message }, 400)
  }
})

// ========================================
// Task Steps Operations
// ========================================

/**
 * POST /forge/tasks/:id/steps
 * Add a step to task
 */
forgeRoutes.post("/tasks/:id/steps", async (c) => {
  try {
    const taskId = c.req.param("id")
    const body = await c.req.json()
    const { description } = body

    if (!description) {
      return c.json({ error: "Description is required" }, 400)
    }

    const task = await TaskManager.addStep(taskId, description)
    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to add step:", error)
    return c.json({ error: error.message }, 400)
  }
})

/**
 * PATCH /forge/tasks/:id/steps/:stepId
 * Update a step
 */
forgeRoutes.patch("/tasks/:id/steps/:stepId", async (c) => {
  try {
    const taskId = c.req.param("id")
    const stepId = c.req.param("stepId")
    const body = await c.req.json()

    const task = await TaskManager.updateStep(taskId, stepId, body)
    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to update step:", error)
    return c.json({ error: error.message }, 400)
  }
})

// ========================================
// Task Activity Operations
// ========================================

/**
 * POST /forge/tasks/:id/activity
 * Add activity to task
 */
forgeRoutes.post("/tasks/:id/activity", async (c) => {
  try {
    const taskId = c.req.param("id")
    const body = await c.req.json()

    const task = await TaskManager.addActivity(taskId, body)
    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to add activity:", error)
    return c.json({ error: error.message }, 400)
  }
})

/**
 * POST /forge/tasks/:id/commit
 * Add commit to task
 */
forgeRoutes.post("/tasks/:id/commit", async (c) => {
  try {
    const taskId = c.req.param("id")
    const body = await c.req.json()

    const task = await TaskManager.addCommit(taskId, body)
    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to add commit:", error)
    return c.json({ error: error.message }, 400)
  }
})

// ========================================
// Task Progress Operations
// ========================================

/**
 * POST /forge/tasks/:id/progress
 * Update task progress
 */
forgeRoutes.post("/tasks/:id/progress", async (c) => {
  try {
    const taskId = c.req.param("id")
    const body = await c.req.json()
    const { progress } = body

    if (typeof progress !== "number" || progress < 0 || progress > 100) {
      return c.json({ error: "Progress must be a number between 0 and 100" }, 400)
    }

    const task = await TaskManager.updateProgress(taskId, progress)
    return c.json(task)
  } catch (error: any) {
    console.error("[FORGE] Failed to update progress:", error)
    return c.json({ error: error.message }, 400)
  }
})

// ========================================
// Statistics
// ========================================

/**
 * GET /forge/stats
 * Get FORGE statistics
 */
forgeRoutes.get("/stats", async (c) => {
  try {
    const tasks = await TaskManager.list()

    const stats = {
      totalTasks: tasks.length,
      byStatus: {
        backlog: tasks.filter((t) => t.status === "backlog").length,
        todo: tasks.filter((t) => t.status === "todo").length,
        in_progress: tasks.filter((t) => t.status === "in_progress").length,
        review: tasks.filter((t) => t.status === "review").length,
        testing: tasks.filter((t) => t.status === "testing").length,
        blocked: tasks.filter((t) => t.status === "blocked").length,
        done: tasks.filter((t) => t.status === "done").length,
        cancelled: tasks.filter((t) => t.status === "cancelled").length,
      },
      byPriority: {
        low: tasks.filter((t) => t.priority === "low").length,
        medium: tasks.filter((t) => t.priority === "medium").length,
        high: tasks.filter((t) => t.priority === "high").length,
        urgent: tasks.filter((t) => t.priority === "urgent").length,
      },
      tasksInProgress: tasks.filter((t) => t.status === "in_progress").length,
      tasksCompletedToday: tasks.filter((t) => {
        if (!t.completedAt) return false
        const today = new Date().setHours(0, 0, 0, 0)
        return t.completedAt >= today
      }).length,
      averageCompletionTime: (() => {
        const completedTasks = tasks.filter((t) => t.completedAt && t.startedAt)
        if (completedTasks.length === 0) return 0
        const totalTime = completedTasks.reduce(
          (sum, t) => sum + (t.completedAt! - t.startedAt!),
          0,
        )
        return Math.round(totalTime / completedTasks.length)
      })(),
      successRate: (() => {
        const completed = tasks.filter((t) => t.status === "done").length
        const total = tasks.filter((t) => t.status === "done" || t.status === "cancelled").length
        if (total === 0) return 100
        return Math.round((completed / total) * 100)
      })(),
    }

    return c.json(stats)
  } catch (error: any) {
    console.error("[FORGE] Failed to get stats:", error)
    return c.json({ error: error.message }, 500)
  }
})
