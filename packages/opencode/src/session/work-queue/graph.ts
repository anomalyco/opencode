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

export class TaskGraph {
  private nodes: Map<string, TaskNode> = new Map()
  private allTasks: MessageV2.SubtaskPart[] = []

  constructor(tasks: MessageV2.SubtaskPart[]) {
    this.allTasks = tasks
    this.buildGraph()
  }

  private getTaskId(task: MessageV2.SubtaskPart): string {
    return `${task.agent}:${task.prompt.substring(0, 50)}`
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
}

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
      })
    }
  }

  async function tryStartTask(nodeId: string): Promise<void> {
    const node = nodes.get(nodeId)
    if (!node || node.isRunning || node.isCompleted) return

    const deps = Array.from(node.dependencies)
    const canStart = deps.every((depId) => {
      const depNode = nodes.get(depId)
      return depNode?.isCompleted
    })

    if (!canStart) return

    if (runningCount >= limit) return

    node.isRunning = true
    running.add(nodeId)
    runningCount++

    const depPromises = deps.map((depId) => nodes.get(depId)?.promise).filter(Boolean) as Promise<void>[]

    const executePromise = (async () => {
      try {
        if (depPromises.length > 0) {
          await Promise.all(depPromises)
        }
        await executeSubtask(node.task).catch((error) => {
          log.error("Subtask execution failed", {
            agent: node.task.agent,
            description: node.task.description,
            error,
          })
        })
      } finally {
        node.isCompleted = true
        running.delete(nodeId)
        runningCount--
        node.resolve()
      }
    })()

    node.promise = executePromise
  }

  async function tryStartAll(): Promise<void> {
    for (const [nodeId] of nodes) {
      await tryStartTask(nodeId)
    }
  }

  const interval = setInterval(tryStartAll, 10)

  const allPromises = Array.from(nodes.values()).map((n) => n.promise)

  await Promise.all(allPromises)

  clearInterval(interval)
}
