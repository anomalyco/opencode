import type { TaskSummary, ExecutorContext, TaskExecutor } from "./types"
import { TaskSummaryBoard } from "./index"
import { Log } from "@/util/log"
import { DEFAULT_TIMEOUT } from "./config"
import { streamText, type Tool } from "ai"

const log = Log.create({ service: "work-queue.executor" })

export { DEFAULT_TIMEOUT, type ExecutorContext, type TaskExecutor }

export abstract class BaseExecutor implements TaskExecutor {
  protected timeout: number

  constructor(timeout?: number) {
    this.timeout = timeout ?? DEFAULT_TIMEOUT.LLM
  }

  getTimeout(): number {
    return this.timeout
  }

  abstract execute(ctx: ExecutorContext): Promise<any>
  abstract isInterruptible(): boolean
  abstract saveCheckpoint(ctx: ExecutorContext): any

  protected async withTimeout<T>(promise: Promise<T>, timeout: number, errorMessage: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${errorMessage} (timeout: ${timeout}ms)`)), timeout),
      ),
    ])
  }

  protected updateHeartbeat(ctx: ExecutorContext): void {
    ctx.onHeartbeat?.()
    const task = ctx.board.get(ctx.taskID)
    if (task) {
      ctx.board.updateProgress(ctx.taskID, task.progress, "heartbeat")
    }
  }
}

export class LLMExecutor extends BaseExecutor {
  constructor() {
    super(DEFAULT_TIMEOUT.LLM)
  }

  async execute(ctx: ExecutorContext): Promise<any> {
    log.info("LLMExecutor starting", { taskID: ctx.taskID })
    ctx.onProgress?.(10, "Initializing LLM...")

    try {
      ctx.onProgress?.(20, "Streaming LLM response...")

      const heartbeatInterval = setInterval(() => {
        this.updateHeartbeat(ctx)
      }, DEFAULT_TIMEOUT.HEARTBEAT)

      try {
        const result = await this.withTimeout(this.executeLLM(ctx), this.timeout, "LLM execution timeout")
        ctx.onProgress?.(90, "Processing LLM result...")
        ctx.onProgress?.(100, "LLM completed")

        log.info("LLMExecutor completed", { taskID: ctx.taskID })
        return result
      } finally {
        clearInterval(heartbeatInterval)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log.error("LLMExecutor error", { taskID: ctx.taskID, error: errorMsg })
      ctx.onError?.(errorMsg)
      throw error
    }
  }

  private async executeLLM(ctx: ExecutorContext): Promise<any> {
    const userMessage = ctx.messages.findLast((m) => m.role === "user")
    if (!userMessage || userMessage.role !== "user") {
      return { type: "llm", output: "No user message found", messageID: undefined }
    }

    const result = await streamText({
      model: ctx.model as any,
      system: ctx.agent.prompt ?? "",
      messages: ctx.messages,
      tools: ctx.tools as Record<string, Tool>,
      abortSignal: ctx.abortSignal,
    })

    const messages: any[] = []
    for await (const chunk of result.fullStream) {
      messages.push(chunk)
    }

    return {
      type: "llm",
      output: result.text,
      messageID: undefined,
      streamMessages: messages,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
    }
  }

  isInterruptible(): boolean {
    return true
  }

  saveCheckpoint(ctx: ExecutorContext): any {
    const task = ctx.board.get(ctx.taskID)
    return {
      taskID: ctx.taskID,
      type: "llm",
      progress: task?.progress ?? 0,
      timestamp: Date.now(),
    }
  }
}

export class ToolExecutor extends BaseExecutor {
  private toolName: string
  private toolInput: Record<string, any>

  constructor(toolName: string, toolInput: Record<string, any>, timeout?: number) {
    super(timeout ?? DEFAULT_TIMEOUT.TOOL)
    this.toolName = toolName
    this.toolInput = toolInput
  }

  async execute(ctx: ExecutorContext): Promise<any> {
    log.info("ToolExecutor starting", { taskID: ctx.taskID, tool: this.toolName })
    ctx.onProgress?.(10, `Starting ${this.toolName}...`)

    const heartbeatInterval = setInterval(() => {
      this.updateHeartbeat(ctx)
    }, DEFAULT_TIMEOUT.HEARTBEAT)

    try {
      ctx.onProgress?.(30, `Executing ${this.toolName}...`)

      const result = await this.withTimeout(
        this.executeTool(ctx),
        this.timeout,
        `Tool '${this.toolName}' execution timeout`,
      )

      ctx.onProgress?.(80, `Processing ${this.toolName} result...`)
      ctx.onProgress?.(100, `${this.toolName} completed`)

      log.info("ToolExecutor completed", { taskID: ctx.taskID, tool: this.toolName })
      return result
    } finally {
      clearInterval(heartbeatInterval)
    }
  }

  protected async executeTool(ctx: ExecutorContext): Promise<any> {
    const toolDef = ctx.tools[this.toolName]
    if (!toolDef) {
      return {
        type: "tool",
        tool: this.toolName,
        output: `Tool '${this.toolName}' not found`,
        error: "Tool not found",
      }
    }

    if (!toolDef.execute) {
      throw new Error(`Tool '${this.toolName}' has no execute function`)
    }

    try {
      const result = await toolDef.execute(this.toolInput, {
        ...ctx,
        run: {
          messages: ctx.messages,
          agent: ctx.agent,
          directory: "",
          step: { id: "1", iteration: 1 },
        },
      } as any)

      return {
        type: "tool",
        tool: this.toolName,
        output: result.output,
        metadata: result.metadata,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return {
        type: "tool",
        tool: this.toolName,
        output: "",
        error: errorMsg,
      }
    }
  }

  isInterruptible(): boolean {
    const nonInterruptible = ["bash", "write", "edit", "apply_patch"]
    return !nonInterruptible.includes(this.toolName)
  }

  saveCheckpoint(ctx: ExecutorContext): any {
    const task = ctx.board.get(ctx.taskID)
    return {
      taskID: ctx.taskID,
      type: "tool",
      toolName: this.toolName,
      input: this.toolInput,
      progress: task?.progress ?? 0,
      timestamp: Date.now(),
    }
  }
}

export class SubtaskExecutor extends BaseExecutor {
  private subtaskInfo: {
    agent: string
    prompt: string
    command?: string
  }

  constructor(subtask: { agent: string; prompt: string; command?: string }) {
    super(DEFAULT_TIMEOUT.SUBTASK)
    this.subtaskInfo = subtask
  }

  async execute(ctx: ExecutorContext): Promise<any> {
    log.info("SubtaskExecutor starting", {
      taskID: ctx.taskID,
      agent: this.subtaskInfo.agent,
    })
    ctx.onProgress?.(5, `Starting subtask: ${this.subtaskInfo.agent}`)

    const heartbeatInterval = setInterval(() => {
      this.updateHeartbeat(ctx)
    }, DEFAULT_TIMEOUT.HEARTBEAT)

    try {
      ctx.onProgress?.(10, `Running subtask: ${this.subtaskInfo.agent}`)

      const result = await this.withTimeout(
        this.executeSubtask(ctx),
        this.timeout,
        `Subtask '${this.subtaskInfo.agent}' execution timeout`,
      )

      ctx.onProgress?.(90, `Waiting for subtask completion...`)
      ctx.onProgress?.(100, `Subtask ${this.subtaskInfo.agent} completed`)

      log.info("SubtaskExecutor completed", { taskID: ctx.taskID, agent: this.subtaskInfo.agent })
      return result
    } finally {
      clearInterval(heartbeatInterval)
    }
  }

  protected async executeSubtask(ctx: ExecutorContext): Promise<any> {
    return {
      type: "subtask",
      agent: this.subtaskInfo.agent,
      output: "Subtask result placeholder",
    }
  }

  isInterruptible(): boolean {
    return true
  }

  saveCheckpoint(ctx: ExecutorContext): any {
    const task = ctx.board.get(ctx.taskID)
    return {
      taskID: ctx.taskID,
      type: "subtask",
      subtask: this.subtaskInfo,
      progress: task?.progress ?? 0,
      timestamp: Date.now(),
    }
  }
}

export class InputExecutor extends BaseExecutor {
  private inputContent: { content: string }

  constructor(input: { content: string }) {
    super(0)
    this.inputContent = input
  }

  async execute(ctx: ExecutorContext): Promise<any> {
    log.info("InputExecutor processing", { taskID: ctx.taskID })
    ctx.onProgress?.(100, "Input processed")
    return {
      type: "input",
      output: this.inputContent.content,
    }
  }

  isInterruptible(): boolean {
    return false
  }

  saveCheckpoint(ctx: ExecutorContext): any {
    return {
      taskID: ctx.taskID,
      type: "input",
      input: this.inputContent,
      progress: 100,
      timestamp: Date.now(),
    }
  }
}

export class CompactExecutor extends BaseExecutor {
  private compactInfo: {
    sessionID: string
    auto?: boolean
  }

  constructor(compact: { sessionID: string; auto?: boolean }) {
    super(DEFAULT_TIMEOUT.TOOL)
    this.compactInfo = compact
  }

  async execute(ctx: ExecutorContext): Promise<any> {
    log.info("CompactExecutor starting", { taskID: ctx.taskID, sessionID: this.compactInfo.sessionID })
    ctx.onProgress?.(10, "Starting compaction...")

    const heartbeatInterval = setInterval(() => {
      this.updateHeartbeat(ctx)
    }, DEFAULT_TIMEOUT.HEARTBEAT)

    try {
      ctx.onProgress?.(50, "Compacting session...")

      const result = await this.withTimeout(this.executeCompact(ctx), this.timeout, "Session compaction timeout")

      ctx.onProgress?.(100, "Session compacted")
      log.info("CompactExecutor completed", { taskID: ctx.taskID })

      return result
    } finally {
      clearInterval(heartbeatInterval)
    }
  }

  protected async executeCompact(ctx: ExecutorContext): Promise<any> {
    return {
      type: "compact",
      sessionID: this.compactInfo.sessionID,
      result: "Compaction result placeholder",
    }
  }

  isInterruptible(): boolean {
    return false
  }

  saveCheckpoint(ctx: ExecutorContext): any {
    const task = ctx.board.get(ctx.taskID)
    return {
      taskID: ctx.taskID,
      type: "compact",
      compact: this.compactInfo,
      progress: task?.progress ?? 0,
      timestamp: Date.now(),
    }
  }
}

export function createExecutor(task: TaskSummary): TaskExecutor {
  switch (task.type) {
    case "llm":
      return new LLMExecutor()
    case "tool": {
      const match = task.goal.match(/^(\w+)\s+(.+)$/)
      const toolName = match ? match[1] : task.goal
      const toolInput = match ? JSON.parse(match[2]) : {}
      return new ToolExecutor(toolName, toolInput)
    }
    case "subtask":
      return new SubtaskExecutor({
        agent: task.goal,
        prompt: task.summary,
        command: undefined,
      })
    case "input":
      return new InputExecutor({ content: task.goal })
    case "compact":
      return new CompactExecutor({ sessionID: task.id })
    default:
      throw new Error(`Unknown task type: ${task.type}`)
  }
}
