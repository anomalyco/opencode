import { createSignal } from "solid-js"
import { client } from "../api/client"
import type {
  ForgeTask,
  TaskStatus,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  ForgeStats,
  ForgeEvent,
} from "../types/forge"

/**
 * FORGE Store
 * Manages all FORGE tasks, execution, and real-time updates
 */

// Tasks grouped by status (for Kanban columns)
export const [tasks, setTasks] = createSignal<ForgeTask[]>([])

// Selected task for detail view
export const [selectedTask, setSelectedTask] = createSignal<ForgeTask | null>(null)

// Loading states
export const [isLoadingTasks, setIsLoadingTasks] = createSignal(false)
export const [isCreatingTask, setIsCreatingTask] = createSignal(false)

// Filters
export const [taskFilter, setTaskFilter] = createSignal<TaskFilter>({})

// Statistics
export const [stats, setStats] = createSignal<ForgeStats>({
  totalTasks: 0,
  byStatus: {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    review: 0,
    testing: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
  },
  byPriority: {
    low: 0,
    medium: 0,
    high: 0,
    urgent: 0,
  },
  averageCompletionTime: 0,
  successRate: 0,
  tasksCompletedToday: 0,
  tasksInProgress: 0,
})

// Recent activities (for activity feed)
export const [recentActivities, setRecentActivities] = createSignal<ForgeEvent[]>([])

/**
 * Load all tasks
 */
export async function loadTasks() {
  setIsLoadingTasks(true)
  try {
    const data = await client.get("/forge/tasks")
    setTasks(data)
    updateStats(data)
  } catch (error) {
    console.error("Failed to load FORGE tasks:", error)
  } finally {
    setIsLoadingTasks(false)
  }
}

/**
 * Create a new task
 */
export async function createTask(input: CreateTaskInput): Promise<ForgeTask> {
  setIsCreatingTask(true)
  try {
    const task = await client.post("/forge/tasks", input)
    setTasks((prev) => [...prev, task])
    updateStats([...tasks(), task])
    return task
  } catch (error) {
    console.error("Failed to create task:", error)
    throw error
  } finally {
    setIsCreatingTask(false)
  }
}

/**
 * Update a task
 */
export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<ForgeTask> {
  try {
    const updated = await client.patch(`/forge/tasks/${taskId}`, input)
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)))

    // Update selected task if it's the one being updated
    if (selectedTask()?.id === taskId) {
      setSelectedTask(updated)
    }

    updateStats(tasks())
    return updated
  } catch (error) {
    console.error("Failed to update task:", error)
    throw error
  }
}

/**
 * Delete a task
 */
export async function deleteTask(taskId: string) {
  try {
    await client.delete(`/forge/tasks/${taskId}`)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))

    if (selectedTask()?.id === taskId) {
      setSelectedTask(null)
    }

    updateStats(tasks())
  } catch (error) {
    console.error("Failed to delete task:", error)
    throw error
  }
}

/**
 * Get task by ID
 */
export async function getTask(taskId: string): Promise<ForgeTask> {
  try {
    const task = await client.get(`/forge/tasks/${taskId}`)
    setSelectedTask(task)
    return task
  } catch (error) {
    console.error("Failed to get task:", error)
    throw error
  }
}

/**
 * Move task to different status (drag & drop)
 */
export async function moveTask(taskId: string, newStatus: TaskStatus) {
  return updateTask(taskId, { status: newStatus })
}

/**
 * Start task execution
 */
export async function startTask(taskId: string) {
  try {
    const task = await client.post(`/forge/tasks/${taskId}/start`)
    setTasks((prev) => prev.map((t) => (t.id === taskId ? task : t)))

    if (selectedTask()?.id === taskId) {
      setSelectedTask(task)
    }

    return task
  } catch (error) {
    console.error("Failed to start task:", error)
    throw error
  }
}

/**
 * Pause task execution
 */
export async function pauseTask(taskId: string) {
  try {
    const task = await client.post(`/forge/tasks/${taskId}/pause`)
    setTasks((prev) => prev.map((t) => (t.id === taskId ? task : t)))

    if (selectedTask()?.id === taskId) {
      setSelectedTask(task)
    }

    return task
  } catch (error) {
    console.error("Failed to pause task:", error)
    throw error
  }
}

/**
 * Cancel task execution
 */
export async function cancelTask(taskId: string) {
  try {
    const task = await client.post(`/forge/tasks/${taskId}/cancel`)
    setTasks((prev) => prev.map((t) => (t.id === taskId ? task : t)))

    if (selectedTask()?.id === taskId) {
      setSelectedTask(task)
    }

    return task
  } catch (error) {
    console.error("Failed to cancel task:", error)
    throw error
  }
}

/**
 * Get tasks by status (for Kanban columns)
 */
export function getTasksByStatus(status: TaskStatus): ForgeTask[] {
  return tasks().filter((t) => t.status === status)
}

/**
 * Get filtered tasks
 */
export function getFilteredTasks(): ForgeTask[] {
  const filter = taskFilter()
  let filtered = tasks()

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
    filtered = filtered.filter((t) => statuses.includes(t.status))
  }

  if (filter.priority) {
    const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority]
    filtered = filtered.filter((t) => priorities.includes(t.priority))
  }

  if (filter.type) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type]
    filtered = filtered.filter((t) => types.includes(t.type))
  }

  if (filter.assignee) {
    filtered = filtered.filter((t) => t.assignee === filter.assignee)
  }

  if (filter.labels && filter.labels.length > 0) {
    filtered = filtered.filter((t) =>
      filter.labels!.some((label) => t.labels.includes(label))
    )
  }

  if (filter.search) {
    const search = filter.search.toLowerCase()
    filtered = filtered.filter(
      (t) =>
        t.title.toLowerCase().includes(search) ||
        t.description.toLowerCase().includes(search)
    )
  }

  return filtered
}

/**
 * Update statistics
 */
function updateStats(taskList: ForgeTask[]) {
  const now = Date.now()
  const oneDayAgo = now - 24 * 60 * 60 * 1000

  const byStatus: Record<TaskStatus, number> = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    review: 0,
    testing: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
  }

  const byPriority: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
    urgent: 0,
  }

  let totalCompletionTime = 0
  let completedCount = 0
  let tasksCompletedToday = 0

  for (const task of taskList) {
    byStatus[task.status]++
    byPriority[task.priority]++

    if (task.status === "done" && task.completedAt && task.startedAt) {
      const duration = task.completedAt - task.startedAt
      totalCompletionTime += duration
      completedCount++

      if (task.completedAt >= oneDayAgo) {
        tasksCompletedToday++
      }
    }
  }

  const averageCompletionTime = completedCount > 0 ? totalCompletionTime / completedCount : 0
  const successRate = taskList.length > 0 ? (byStatus.done / taskList.length) * 100 : 0

  setStats({
    totalTasks: taskList.length,
    byStatus,
    byPriority: byPriority as any,
    averageCompletionTime,
    successRate,
    tasksCompletedToday,
    tasksInProgress: byStatus.in_progress,
  })
}

/**
 * Handle WebSocket events
 */
export function handleForgeEvent(event: ForgeEvent) {
  // Add to recent activities
  setRecentActivities((prev) => [event, ...prev.slice(0, 49)]) // Keep last 50

  switch (event.type) {
    case "forge.task.created":
      setTasks((prev) => [...prev, event.data.task])
      break

    case "forge.task.updated":
      setTasks((prev) => prev.map((t) => (t.id === event.taskId ? event.data.task : t)))
      if (selectedTask()?.id === event.taskId) {
        setSelectedTask(event.data.task)
      }
      break

    case "forge.task.deleted":
      setTasks((prev) => prev.filter((t) => t.id !== event.taskId))
      if (selectedTask()?.id === event.taskId) {
        setSelectedTask(null)
      }
      break

    case "forge.task.status_changed":
      setTasks((prev) =>
        prev.map((t) =>
          t.id === event.taskId ? { ...t, status: event.data.newStatus } : t
        )
      )
      break

    case "forge.task.progress":
      setTasks((prev) =>
        prev.map((t) =>
          t.id === event.taskId ? { ...t, progress: event.data.progress } : t
        )
      )
      if (selectedTask()?.id === event.taskId) {
        setSelectedTask((prev) => (prev ? { ...prev, progress: event.data.progress } : null))
      }
      break

    case "forge.task.step_started":
    case "forge.task.step_completed":
    case "forge.task.step_failed":
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === event.taskId) {
            const updatedSteps = t.steps.map((s) =>
              s.id === event.data.step.id ? event.data.step : s
            )
            return { ...t, steps: updatedSteps }
          }
          return t
        })
      )
      if (selectedTask()?.id === event.taskId) {
        setSelectedTask((prev) => {
          if (!prev) return null
          const updatedSteps = prev.steps.map((s) =>
            s.id === event.data.step.id ? event.data.step : s
          )
          return { ...prev, steps: updatedSteps }
        })
      }
      break

    case "forge.task.commit":
      setTasks((prev) =>
        prev.map((t) =>
          t.id === event.taskId ? { ...t, commits: [...t.commits, event.data.commit] } : t
        )
      )
      break

    case "forge.task.activity":
      setTasks((prev) =>
        prev.map((t) =>
          t.id === event.taskId
            ? { ...t, activities: [...t.activities, event.data.activity] }
            : t
        )
      )
      break
  }

  // Update stats after any change
  updateStats(tasks())
}

/**
 * Initialize FORGE store
 */
export function initializeForge() {
  loadTasks()

  // Subscribe to FORGE events via WebSocket
  client.on("forge.*", (event: any) => {
    if (event.type.startsWith("forge.")) {
      handleForgeEvent(event as ForgeEvent)
    }
  })
}
