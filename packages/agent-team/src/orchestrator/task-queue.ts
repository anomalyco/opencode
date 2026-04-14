import type { AgentID, TaskPayload, TaskResultPayload } from "../protocol/messages.js"
import { Registry } from "./registry.js"
import { BudgetManager } from "./budget.js"

type TaskState = {
  task: TaskPayload
  status: "pending" | "assigned" | "completed" | "cancelled"
  assigned_to?: AgentID
  parent_task_id?: string
  created_at: number
  completed_at?: number
}

export class TaskQueue {
  private tasks = new Map<string, TaskState>()
  private registry: Registry
  private budget: BudgetManager
  private maxConcurrent: number
  private maxDepth: number
  private taskTimeoutSeconds: number

  constructor(
    registry: Registry,
    budget: BudgetManager,
    config: { maxConcurrent?: number; maxDepth?: number; taskTimeoutSeconds?: number },
  ) {
    this.registry = registry
    this.budget = budget
    this.maxConcurrent = config.maxConcurrent ?? 5
    this.maxDepth = config.maxDepth ?? 3
    this.taskTimeoutSeconds = config.taskTimeoutSeconds ?? 1800
  }

  enqueue(task: TaskPayload): { ok: true; task_id: string } | { ok: false; error: string } {
    const activeCount = [...this.tasks.values()].filter((t) => t.status === "assigned").length
    if (activeCount >= this.maxConcurrent) return { ok: false, error: "Max concurrent tasks reached" }
    const maxCost = task.budget?.max_cost
    if (maxCost) {
      if (!this.budget.checkBudget("team", maxCost)) {
        return { ok: false, error: "Team budget exceeded" }
      }
      const idleAgents = this.registry.findIdle()
      const allOverBudget = idleAgents.length > 0 && idleAgents.every((a) => !this.budget.checkBudget(a.id, maxCost))
      if (allOverBudget) {
        return { ok: false, error: "All idle agents over per-agent daily budget" }
      }
    }
    const depth = task.parent_task_id ? this.getDelegationDepth(task.parent_task_id) + 1 : 0
    if (depth > this.maxDepth) return { ok: false, error: "Max delegation depth exceeded" }
    this.tasks.set(task.task_id, {
      task,
      status: "pending",
      parent_task_id: task.parent_task_id,
      created_at: Date.now(),
    })
    this.assignNext()
    return { ok: true, task_id: task.task_id }
  }

  assignNext(): TaskState | undefined {
    const pending = [...this.tasks.values()]
      .filter((t) => t.status === "pending")
      .sort((a, b) => this.priorityRank(a.task.priority) - this.priorityRank(b.task.priority))
    for (const task of pending) {
      const agents = this.registry.findIdle()
      const capable = agents.filter((a) => {
        if (!task.task.required_capabilities?.length) return true
        return task.task.required_capabilities.every((c) => a.capabilities.tools.includes(c))
      })
      if (capable.length === 0) continue
      const agent = capable[0]
      task.status = "assigned"
      task.assigned_to = agent.id
      this.registry.updateStatus(agent.id, "busy", task.task.task_id)
      return task
    }
    return undefined
  }

  complete(taskId: string, result: TaskResultPayload): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = "completed"
    task.completed_at = Date.now()
    if (task.assigned_to) {
      this.registry.updateStatus(task.assigned_to, "idle")
    }
    if (result.tokens_used && task.assigned_to) {
      this.budget.trackUsage(task.assigned_to, result.tokens_used.input + result.tokens_used.output, result.cost ?? 0)
    }
    this.assignNext()
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = "cancelled"
    task.completed_at = Date.now()
    if (task.assigned_to) {
      this.registry.updateStatus(task.assigned_to, "idle")
    }
    this.assignNext()
  }

  getTaskStatus(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId)
  }

  listPending(): TaskState[] {
    return [...this.tasks.values()].filter((t) => t.status === "pending")
  }

  listActive(): TaskState[] {
    return [...this.tasks.values()].filter((t) => t.status === "assigned")
  }

  private getDelegationDepth(parentTaskId: string): number {
    let depth = 0
    let current = this.tasks.get(parentTaskId)
    while (current?.parent_task_id) {
      depth++
      current = this.tasks.get(current.parent_task_id)
    }
    return depth
  }

  private priorityRank(p: string): number {
    switch (p) {
      case "critical":
        return 0
      case "high":
        return 1
      case "normal":
        return 2
      case "low":
        return 3
      default:
        return 2
    }
  }
}
