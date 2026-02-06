/**
 * Work Queue 集成到主 Agent 循环的示例
 *
 * 这个文件展示了如何将 work-queue 集成到现有的 agent 处理流程中
 */

import { WorkQueueSessionProcessor, createAndStart, type TaskResult } from "./processor"
import { ToolRegistry } from "@/tool/registry"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import type { TaskSummary } from "./types"
import type { ModelMessage } from "ai"
import type { Agent as AgentType } from "@/agent/agent"
import type { Provider as ProviderType } from "@/provider/provider"

const log = Log.create({ service: "work-queue.integration" })

/**
 * 集成配置
 */
export interface WorkQueueIntegrationConfig {
  /** 最大并发任务数 */
  maxConcurrency?: number
  /** LLM 超时时间 */
  llmTimeout?: number
  /** 工具超时时间 */
  toolTimeout?: number
  /** 是否启用后台任务 */
  enabled?: boolean
}

/**
 * 集成到 SessionProcessor 的后台任务处理器
 */
export class BackgroundTaskHandler {
  private processor: WorkQueueSessionProcessor | null = null
  private sessionID: string
  private config: WorkQueueIntegrationConfig
  private tools: Record<string, any> = {}
  private currentAgent: AgentType.Info | null = null
  private currentModel: ProviderType.Model | null = null

  constructor(sessionID: string, config?: WorkQueueIntegrationConfig) {
    this.sessionID = sessionID
    this.config = {
      maxConcurrency: 2,
      llmTimeout: 120_000,
      toolTimeout: 60_000,
      enabled: true,
      ...config,
    }
  }

  /**
   * 初始化处理器
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) return

    this.processor = await createAndStart(this.sessionID, {
      maxConcurrency: this.config.maxConcurrency,
      llmTimeout: this.config.llmTimeout,
      toolTimeout: this.config.toolTimeout,
    })

    // 加载工具
    this.tools = await ToolRegistry.tools(
      this.currentModel
        ? { providerID: this.currentModel.providerID, modelID: this.currentModel.id }
        : { providerID: "", modelID: "" },
      this.currentAgent ?? undefined,
    )

    // 监听任务完成事件
    const board = this.processor.getBoard()
    board.on("task:completed", async (event) => {
      if (event.taskID) {
        await this.onTaskCompleted(event.taskID)
      }
    })

    log.info("BackgroundTaskHandler initialized", { sessionID: this.sessionID })
  }

  /**
   * 设置当前 agent 和 model（用于执行任务）
   */
  setContext(agent: AgentType.Info, model: ProviderType.Model): void {
    this.currentAgent = agent
    this.currentModel = model
  }

  /**
   * 提交 LLM 任务（不阻塞主循环）
   */
  async submitLLM(goal: string, priority?: number): Promise<TaskResult> {
    if (!this.processor) {
      throw new Error("BackgroundTaskHandler not initialized")
    }

    return this.processor.submitLLMTask(goal, priority)
  }

  /**
   * 提交工具任务（并行执行）
   */
  async submitTool(toolName: string, input: Record<string, any>, priority?: number): Promise<TaskResult> {
    if (!this.processor) {
      throw new Error("BackgroundTaskHandler not initialized")
    }

    return this.processor.submitToolTask(toolName, input, priority)
  }

  /**
   * 提交子任务
   */
  async submitSubtask(agent: string, prompt: string, priority?: number): Promise<TaskResult> {
    if (!this.processor) {
      throw new Error("BackgroundTaskHandler not initialized")
    }

    return this.processor.submitSubtask(agent, prompt, priority)
  }

  /**
   * 提交后台分析任务（低优先级）
   */
  async submitAnalysis(goal: string): Promise<TaskResult> {
    return this.submitLLM(goal, 10)
  }

  /**
   * 提交紧急任务（高优先级）
   */
  async submitUrgent(goal: string): Promise<TaskResult> {
    return this.submitLLM(goal, 100)
  }

  /**
   * 任务完成回调
   */
  private async onTaskCompleted(taskID: string): Promise<void> {
    const board = this.processor!.getBoard()
    const task = board.get(taskID)

    if (!task) return

    log.info("Background task completed", {
      taskID,
      type: task.type,
      goal: task.goal,
    })
  }

  /**
   * 获取统计信息
   */
  getStats(): ReturnType<WorkQueueSessionProcessor["getStats"]> {
    return this.processor?.getStats() ?? { pending: 0, running: 0, completed: 0, error: 0, blocked: 0, total: 0 }
  }

  /**
   * 是否运行中
   */
  isActive(): boolean {
    return this.processor?.isActive() ?? false
  }

  /**
   * 停止处理器
   */
  async stop(): Promise<void> {
    if (this.processor) {
      await this.processor.stop()
      this.processor = null
      log.info("BackgroundTaskHandler stopped", { sessionID: this.sessionID })
    }
  }
}

/**
 * 在现有代码中使用后台任务的示例
 *
 * 在 SessionProcessor 中添加：
 *
 * ```typescript
 * import { BackgroundTaskHandler } from "./work-queue/integration"
 *
 * export namespace SessionProcessor {
 *   const backgroundHandler = new BackgroundTaskHandler(sessionID)
 *
 *   export async function process(...) {
 *     // 初始化
 *     await backgroundHandler.initialize()
 *     backgroundHandler.setContext(agent, model)
 *
 *     // 在主循环中可以并行提交后台任务
 *     backgroundHandler.submitAnalysis("分析项目结构")
 *
 *     // 或者提交紧急任务
 *     backgroundHandler.submitUrgent("立即生成代码")
 *
 *     // 检查后台任务状态
 *     console.log(backgroundHandler.getStats())
 *   }
 *
 *   // 记得在结束时停止
 *   async function cleanup() {
 *     await backgroundHandler.stop()
 *   }
 * }
 * ```
 */

/**
 * 独立的并发任务执行器（简化版）
 */
export class ConcurrentTaskRunner {
  private tasks: Map<string, Promise<any>> = new Map()
  private maxConcurrency: number
  private running: number = 0
  private waiting: (() => void)[] = []

  constructor(options?: { maxConcurrency?: number }) {
    this.maxConcurrency = options?.maxConcurrency ?? 4
  }

  async run<T>(taskID: string, fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve)
      })
    }

    this.running++
    const promise = fn().finally(() => {
      this.running--
      this.tasks.delete(taskID)
      if (this.waiting.length > 0) {
        const next = this.waiting.shift()
        next?.()
      }
    })

    this.tasks.set(taskID, promise)
    return promise
  }

  async waitAll(): Promise<void> {
    await Promise.all(this.tasks.values())
  }

  cancelAll(): void {
    for (const [, promise] of this.tasks) {
      // 标记为取消
    }
    this.tasks.clear()
  }
}
