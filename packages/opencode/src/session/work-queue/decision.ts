import type { TaskSummary } from "./types"
import type { TaskSummaryBoard } from "./board"
import { EVENTS } from "./events"

export type AgentAction =
  | { type: "start_next"; taskID: string }
  | { type: "continue"; taskID: string }
  | { type: "pause"; taskID: string; checkpoint?: any }
  | { type: "resume"; taskID: string }
  | { type: "cancel"; taskID: string }
  | { type: "retry"; taskID: string }
  | { type: "handle_error"; taskIDs: string[] }
  | { type: "unblock"; taskIDs: string[] }
  | { type: "interrupt"; reason: string }
  | { type: "wait" }
  | { type: "idle" }

export interface RelevanceResult {
  isRelated: boolean
  relationType: "same" | "parent" | "child" | "context" | "unrelated"
  confidence: number
  suggestion: "continue" | "interrupt" | "parallel"
  reason: string
}

/**
 * 代理决策中心
 * 
 * 职责：
 * 1. 根据任务板状态决定下一步动作
 * 2. 处理任务完成、错误和用户输入
 * 
 * 线程模型：
 * @VertxThreadSafety 默认在单线程事件循环中运行
 */
export class AgentDecisionCenter {
  /**
   * 决定下一个动作
   * @param board 任务汇总板
   * @returns 返回建议的动作
   */
  decideNext(board: TaskSummaryBoard): AgentAction {
    const current = board.getCurrentTask()

    if (current) {
      if (current.status === "error") {
        return this.handleTaskError(board, [current])
      }
      return { type: "continue", taskID: current.id }
    }

    const pending = board.getByStatus("pending")
    const blocked = board.getByStatus("blocked")

    if (pending.length > 0) {
      const nextTask = [...pending].sort((a, b) => b.priority - a.priority)[0]
      return { type: "start_next", taskID: nextTask.id }
    }

    const unblocked = blocked.filter((t) => t.blockedBy.length === 0)
    if (unblocked.length > 0) {
      const nextTask = [...unblocked].sort((a, b) => b.priority - a.priority)[0]
      return { type: "unblock", taskIDs: [nextTask.id] }
    }

    const errors = board.getByStatus("error")
    if (errors.length > 0) {
      return this.handleTaskError(board, errors)
    }

    if (board.isEmpty()) {
      return { type: "idle" }
    }

    return { type: "wait" }
  }

  handleTaskComplete(board: TaskSummaryBoard, taskID: string): AgentAction {
    const dependents = board.getDependentsNotDone(taskID)

    if (dependents.length > 0) {
      const unblocked = dependents.filter((t) => t.blockedBy.every((dep) => board.allDone([dep])))
      if (unblocked.length > 0) {
        return { type: "unblock", taskIDs: unblocked.map((t) => t.id) }
      }
    }

    return this.decideNext(board)
  }

  handleTaskError(board: TaskSummaryBoard, errorTasks: TaskSummary[]): AgentAction {
    return { type: "handle_error", taskIDs: errorTasks.map((t) => t.id) }
  }

  handleUserInput(board: TaskSummaryBoard, input: { goal: string }): AgentAction {
    const current = board.getCurrentTask()

    if (!current) {
      const newTask = board.create({
        type: "input",
        goal: input.goal,
        summary: "User input",
        priority: 100,
        progress: 0,
        blockedBy: [],
        blocks: [],
      })
      return { type: "start_next", taskID: newTask.id }
    }

    const relevance = this.judgeRelevance(input.goal, current)

    if (!relevance.isRelated) {
      const newTask = board.create({
        type: "input",
        goal: input.goal,
        summary: "User input (parallel)",
        priority: 50,
        progress: 0,
        blockedBy: [],
        blocks: [],
      })
      return { type: "start_next", taskID: newTask.id }
    }

    if (relevance.suggestion === "interrupt") {
      const checkpoint = this.saveCheckpoint(current)
      board.pause(current.id, checkpoint)
      const newTask = board.create({
        type: "input",
        goal: input.goal,
        summary: `User input (interrupted: ${relevance.reason})`,
        priority: 100,
        progress: 0,
        blockedBy: [],
        blocks: [current.id],
      })
      board.block(current.id, [newTask.id])
      return { type: "start_next", taskID: newTask.id }
    }

    const newTask = board.create({
      type: "input",
      goal: input.goal,
      summary: `User input (queued: ${relevance.reason})`,
      priority: 50,
      progress: 0,
      blockedBy: [],
      blocks: [],
    })
    return { type: "continue", taskID: current.id }
  }

  handleBlock(board: TaskSummaryBoard, blockedTask: TaskSummary): AgentAction {
    return this.decideNext(board)
  }

  judgeRelevance(userGoal: string, currentTask: TaskSummary | null): RelevanceResult {
    if (!currentTask) {
      return {
        isRelated: false,
        relationType: "unrelated",
        confidence: 0,
        suggestion: "parallel",
        reason: "No current task",
      }
    }

    const userKeywords = this.extractKeywords(userGoal)
    const taskKeywords = this.extractKeywords(currentTask.goal)

    const overlap = userKeywords.filter((k) => taskKeywords.includes(k))
    const overlapRatio = overlap.length / Math.max(userKeywords.length, taskKeywords.length)

    if (overlapRatio > 0.5) {
      return {
        isRelated: true,
        relationType: "same",
        confidence: overlapRatio,
        suggestion: overlapRatio > 0.8 ? "interrupt" : "parallel",
        reason: `High keyword overlap: ${overlap.join(", ")}`,
      }
    }

    if (overlapRatio > 0.2) {
      return {
        isRelated: true,
        relationType: "context",
        confidence: overlapRatio,
        suggestion: "parallel",
        reason: `Partial overlap: ${overlap.join(", ")}`,
      }
    }

    const isReadOnly = currentTask.type === "tool" && this.isReadOnlyTool(currentTask.goal)

    if (isReadOnly) {
      return {
        isRelated: false,
        relationType: "unrelated",
        confidence: 1,
        suggestion: "parallel",
        reason: "Current task is read-only",
      }
    }

    return {
      isRelated: false,
      relationType: "unrelated",
      confidence: 0.9,
      suggestion: "parallel",
      reason: "No relevant overlap found",
    }
  }

  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .filter((w) => !this.isStopWord(w))
  }

  private isStopWord(word: string): boolean {
    const stopWords = ["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"]
    return stopWords.includes(word)
  }

  private isReadOnlyTool(goal: string): boolean {
    const readOnlyPatterns = [/read/, /grep/, /glob/, /list/, /search/, /fetch/, /view/, /show/]
    return readOnlyPatterns.some((p) => p.test(goal.toLowerCase()))
  }

  private saveCheckpoint(task: TaskSummary): any {
    return {
      taskID: task.id,
      goal: task.goal,
      progress: task.progress,
      summary: task.summary,
      timestamp: Date.now(),
    }
  }
}
