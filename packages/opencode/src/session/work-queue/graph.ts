import { MessageV2 } from "../message-v2"
import { Log } from "@/util/log"

const log = Log.create({ service: "work-queue.graph" })

export interface TaskNode {
  id: string
  task: MessageV2.SubtaskPart
  dependencies: Set<string>
  dependents: Set<string>
  level: number
}

export interface TaskLevel {
  level: number
  nodes: TaskNode[]
}

export interface TaskGraphResult {
  levels: TaskLevel[]
  totalNodes: number
  maxLevel: number
}

/**
 * 任务图
 * 
 * 职责：
 * 1. 构建任务依赖图
 * 2. 计算任务层级（分层执行）
 * 
 * 线程模型：
 * @VertxThreadSafety
 */
export class TaskGraph {
  private nodes: Map<string, TaskNode> = new Map()
  private allTasks: MessageV2.SubtaskPart[] = []

  /**
   * 构造函数
   * @param tasks 任务列表
   */
  constructor(tasks: MessageV2.SubtaskPart[]) {
    this.allTasks = tasks
    this.buildGraph()
  }

  /**
   * 获取任务ID
   * @param task 任务部分
   * @returns 唯一ID
   */
  private getTaskId(task: MessageV2.SubtaskPart): string {
    // 使用 agent, description 和 prompt 的组合来确保唯一性 (Bug 9)
    const content = `${task.agent}:${task.description || ""}:${task.prompt}`
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      hash = (hash << 5) - hash + content.charCodeAt(i)
      hash |= 0 // Convert to 32bit integer
    }
    return `${task.agent}:${hash.toString(36)}:${task.prompt.substring(0, 30)}`
  }

  private buildGraph(): void {
    const taskIndex = new Map<string, MessageV2.SubtaskPart>()

    for (const task of this.allTasks) {
      const id = this.getTaskId(task)
      taskIndex.set(id, task)
      this.nodes.set(id, {
        id,
        task,
        dependencies: new Set(),
        dependents: new Set(),
        level: -1,
      })
    }

    for (const task of this.allTasks) {
      const node = this.nodes.get(this.getTaskId(task))!
      this.analyzeDependencies(node, taskIndex)
    }

    this.calculateLevels()
  }

  private analyzeDependencies(node: TaskNode, taskIndex: Map<string, MessageV2.SubtaskPart>): void {
    const prompt = node.task.prompt.toLowerCase()

    for (const [otherId, otherTask] of taskIndex) {
      if (otherId === node.id) continue

      const otherPrompt = otherTask.prompt.toLowerCase()

      const triggerWords = ["after", "once", "when", "following", "based on", "using results from"]
      const triggerPattern = new RegExp(triggerWords.map((w) => `${w}\\s+${otherTask.agent}`).join("|"), "i")

      const dependsOn = prompt.match(triggerPattern)
      const otherDependsOn = otherPrompt.match(
        new RegExp(triggerWords.map((w) => `${w}\\s+${node.task.agent}`).join("|"), "i"),
      )

      if (dependsOn) {
        node.dependencies.add(otherId)
        const otherNode = this.nodes.get(otherId)
        if (otherNode) {
          otherNode.dependents.add(node.id)
        }
      }

      if (otherDependsOn) {
        const otherNode = this.nodes.get(otherId)
        if (otherNode) {
          otherNode.dependencies.add(node.id)
          node.dependents.add(otherId)
        }
      }

      if (prompt.includes(otherTask.prompt.substring(0, 30).toLowerCase())) {
        node.dependencies.add(otherId)
        const otherNode = this.nodes.get(otherId)
        if (otherNode) {
          otherNode.dependents.add(node.id)
        }
      }
    }
  }

  private calculateLevels(): void {
    const visited = new Set<string>()
    const tempStack = new Set<string>()

    const dfs = (nodeId: string, _currentLevel: number): number => {
      if (tempStack.has(nodeId)) {
        log.warn("Cycle detected in task graph", { nodeId })
        return _currentLevel
      }

      if (visited.has(nodeId)) {
        return this.nodes.get(nodeId)!.level
      }

      tempStack.add(nodeId)

      const node = this.nodes.get(nodeId)!
      let maxDepLevel = _currentLevel

      for (const depId of node.dependencies) {
        const depLevel = dfs(depId, _currentLevel)
        maxDepLevel = Math.max(maxDepLevel, depLevel + 1)
      }

      node.level = maxDepLevel
      visited.add(nodeId)
      tempStack.delete(nodeId)

      return node.level
    }

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, 0)
      }
    }
  }

  buildLevels(): TaskGraphResult {
    const levelMap = new Map<number, TaskNode[]>()

    for (const node of this.nodes.values()) {
      const level = node.level
      if (!levelMap.has(level)) {
        levelMap.set(level, [])
      }
      levelMap.get(level)!.push(node)
    }

    const levels: TaskLevel[] = []
    let maxLevel = 0

    for (const [level, nodes] of levelMap) {
      maxLevel = Math.max(maxLevel, level)
      levels.push({ level, nodes })
    }

    levels.sort((a, b) => a.level - b.level)

    log.info("Task graph built", {
      totalNodes: this.nodes.size,
      maxLevel,
      levelsCount: levels.length,
    })

    return { levels, totalNodes: this.nodes.size, maxLevel }
  }

  getNode(id: string): TaskNode | undefined {
    return this.nodes.get(id)
  }

  getAllNodes(): TaskNode[] {
    return Array.from(this.nodes.values())
  }

  getTasksForLevel(level: number): MessageV2.SubtaskPart[] {
    const tasks: MessageV2.SubtaskPart[] = []

    for (const node of this.nodes.values()) {
      if (node.level === level) {
        tasks.push(node.task)
      }
    }

    return tasks
  }

  getIndependentTasks(): MessageV2.SubtaskPart[] {
    const tasks: MessageV2.SubtaskPart[] = []

    for (const node of this.nodes.values()) {
      if (node.dependencies.size === 0) {
        tasks.push(node.task)
      }
    }

    return tasks
  }

  hasDependencies(task: MessageV2.SubtaskPart): boolean {
    const id = this.getTaskId(task)
    const node = this.nodes.get(id)
    return node ? node.dependencies.size > 0 : false
  }

  static fromMessages(messages: MessageV2.WithParts[]): MessageV2.SubtaskPart[] {
    const tasks: MessageV2.SubtaskPart[] = []

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const subtaskParts = msg.parts.filter((part): part is MessageV2.SubtaskPart => part.type === "subtask")

      for (const task of subtaskParts) {
        if (!tasks.some((t) => t.agent === task.agent && t.prompt === task.prompt)) {
          tasks.push(task)
        }
      }
    }

    return tasks
  }
}

async function isSettled(p: Promise<any>): Promise<boolean> {
  const result = await Promise.race([
    p.then(() => true),
    p.catch(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 0)),
  ])
  return result
}

interface SchedulerNode {
  id: string
  task: MessageV2.SubtaskPart
  dependencies: Set<string>
  dependents: Set<string>
  promise: Promise<void>
  resolve: () => void
  reject: (error: any) => void
  isRunning: boolean
  isCompleted: boolean
  isFailed: boolean // 新增: 标记任务是否失败 (Bug 7)
}

  /**
   * 执行任务层级
   * @param levels 任务层级列表
   * @param executeSubtask 执行子任务的回调
   * @param maxParallel 最大并行数
   */
export async function executeTaskLevels(
  levels: TaskLevel[],
  executeSubtask: (task: MessageV2.SubtaskPart) => Promise<void>,
  maxParallel?: number,
): Promise<void> {
  const limit = maxParallel ?? 5
  const nodes = new Map<string, SchedulerNode>()
  const running = new Set<string>()
  let runningCount = 0

  for (const level of levels) {
    for (const node of level.nodes) {
      nodes.set(node.id, {
        id: node.id,
        task: node.task,
        dependencies: node.dependencies,
        dependents: node.dependents,
        promise: new Promise((resolve, reject) => {
          nodes.get(node.id)!.resolve = resolve
          nodes.get(node.id)!.reject = reject
        }),
        resolve: () => {},
        reject: () => {},
        isRunning: false,
        isCompleted: false,
        isFailed: false,
      })
    }
  }

  // 修改: 去掉 async, 确保在循环检查时不产生 yield (Bug 4)
  function tryStartTask(nodeId: string): void {
    const node = nodes.get(nodeId)
    if (!node || node.isRunning || node.isCompleted || node.isFailed) return

    const deps = Array.from(node.dependencies)
    const canStart = deps.every((depId) => {
      const depNode = nodes.get(depId)
      return depNode?.isCompleted // 只有成功完成的任务才算依赖达成
    })

    if (!canStart) {
      // 检查是否有依赖失败了
      const hasFailedDep = deps.some((depId) => nodes.get(depId)?.isFailed)
      if (hasFailedDep) {
        node.isFailed = true
        node.reject(new Error(`Dependency failed for task: ${node.id}`))
      }
      return
    }

    if (runningCount >= limit) return

    node.isRunning = true
    running.add(nodeId)
    runningCount++

    // 真正的异步执行逻辑
    void (async () => {
      try {
        await executeSubtask(node.task)
        node.isCompleted = true
        node.resolve()
      } catch (error) {
        log.error("Subtask execution failed", {
          agent: node.task.agent,
          description: node.task.description,
          error,
        })
        node.isFailed = true
        node.reject(error)
      } finally {
        node.isRunning = false
        running.delete(nodeId)
        runningCount--
      }
    })()
  }

  function tryStartAll(): void {
    for (const [nodeId] of nodes) {
      tryStartTask(nodeId)
    }
  }

  const interval = setInterval(tryStartAll, 10)

  const allPromises = Array.from(nodes.values()).map((n) => n.promise)

  await Promise.all(allPromises)

  clearInterval(interval)
}
