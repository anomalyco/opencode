import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { ToolDependency } from "./tool-dependency"
import { ToolResultCache } from "./tool-result-cache"
import { ToolRegistry } from "@/tool/registry"
import { type Tool } from "ai"
import { BackgroundTaskHandler, type WorkQueueIntegrationConfig } from "./work-queue/integration"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  interface ToolExecutor {
    toolId: string
    toolName: string
    input: Record<string, any>
    partId: string
    callId: string
    abort: AbortSignal
  }

  interface ToolExecutionResult {
    ok: boolean
    durationMs: number
  }

  type ResourceLockMode = "shared" | "exclusive"

  function toolLockMode(toolName: string): ResourceLockMode {
    if (toolName === "read" || toolName === "grep") return "shared"
    return "exclusive"
  }

  function createResourceLockManager() {
    type QueueItem = {
      mode: ResourceLockMode
      resolve: (release: () => void) => void
    }
    type LockState = {
      readers: number
      writer: boolean
      queue: QueueItem[]
    }

    const locks = new Map<string, LockState>()

    const ensureState = (key: string): LockState => {
      let state = locks.get(key)
      if (!state) {
        state = { readers: 0, writer: false, queue: [] }
        locks.set(key, state)
      }
      return state
    }

    const drain = (key: string, state: LockState) => {
      if (state.writer) return
      if (state.readers > 0) return
      if (state.queue.length === 0) return

      const head = state.queue[0]
      if (!head) return

      if (head.mode === "exclusive") {
        const next = state.queue.shift()!
        state.writer = true
        next.resolve(() => {
          state.writer = false
          drain(key, state)
        })
        return
      }

      while (state.queue.length > 0 && state.queue[0]!.mode === "shared" && !state.writer) {
        const next = state.queue.shift()!
        state.readers++
        next.resolve(() => {
          state.readers = Math.max(0, state.readers - 1)
          if (state.readers === 0) {
            drain(key, state)
          }
        })
      }
    }

    const acquireKey = (key: string, mode: ResourceLockMode): Promise<() => void> => {
      const state = ensureState(key)

      const canAcquireNow = () => {
        if (mode === "shared") {
          if (state.writer) return false
          if (state.queue.length > 0) return false
          return true
        }
        if (state.writer) return false
        if (state.readers > 0) return false
        if (state.queue.length > 0) return false
        return true
      }

      if (canAcquireNow()) {
        if (mode === "shared") {
          state.readers++
          return Promise.resolve(() => {
            state.readers = Math.max(0, state.readers - 1)
            if (state.readers === 0) {
              drain(key, state)
            }
          })
        }
        state.writer = true
        return Promise.resolve(() => {
          state.writer = false
          drain(key, state)
        })
      }

      return new Promise<() => void>((resolve) => {
        state.queue.push({ mode, resolve })
        drain(key, state)
      })
    }

    const acquire = async (keys: Set<string>, mode: ResourceLockMode): Promise<() => void> => {
      const sorted = Array.from(keys).sort()
      const releases: Array<() => void> = []
      for (const key of sorted) {
        const release = await acquireKey(key, mode)
        releases.push(release)
      }
      return () => {
        for (let i = releases.length - 1; i >= 0; i--) {
          releases[i]!()
        }
      }
    }

    return { acquire }
  }

  async function executeTool(
    executor: ToolExecutor,
    tools: Record<string, Tool>,
    input: {
      sessionID: string
      assistantMessage: MessageV2.Assistant
      agent: Agent.Info
    },
  ): Promise<ToolExecutionResult> {
    const start = Date.now()
    const tool = tools[executor.toolName]
    if (!tool) {
      await Session.updatePart({
        id: executor.partId,
        messageID: input.assistantMessage.id,
        sessionID: input.sessionID,
        type: "tool",
        tool: executor.toolName,
        callID: executor.callId,
        state: {
          status: "error",
          input: executor.input,
          error: `Tool '${executor.toolName}' not found`,
          time: {
            start,
            end: Date.now(),
          },
        },
      })
      return { ok: false, durationMs: Date.now() - start }
    }

    try {
      const executeFn = tool.execute
      if (!executeFn) {
        throw new Error(`Tool '${executor.toolName}' has no execute function`)
      }
      const result = await executeFn(executor.input, {
        toolCallId: executor.callId,
        abortSignal: executor.abort,
        messages: [],
      })

      await Session.updatePart({
        id: executor.partId,
        messageID: input.assistantMessage.id,
        sessionID: input.sessionID,
        type: "tool",
        tool: executor.toolName,
        callID: executor.callId,
        state: {
          status: "completed",
          input: executor.input,
          output: result.output,
          title: result.title,
          metadata: result.metadata,
          attachments: result.attachments,
          time: {
            start,
            end: Date.now(),
          },
        },
      })

      ToolResultCache.set({
        sessionID: input.sessionID,
        callID: executor.callId,
        tool: executor.toolName,
        input: executor.input,
        output: result.output,
        title: result.title,
        metadata: result.metadata ?? {},
        attachments: result.attachments,
      })
      return { ok: true, durationMs: Date.now() - start }
    } catch (error) {
      await Session.updatePart({
        id: executor.partId,
        messageID: input.assistantMessage.id,
        sessionID: input.sessionID,
        type: "tool",
        tool: executor.toolName,
        callID: executor.callId,
        state: {
          status: "error",
          input: executor.input,
          error: error instanceof Error ? error.message : String(error),
          time: {
            start,
            end: Date.now(),
          },
        },
      })
      return { ok: false, durationMs: Date.now() - start }
    }
  }

  async function executeToolsParallel(
    executors: ToolExecutor[],
    tools: Record<string, Tool>,
    input: {
      sessionID: string
      assistantMessage: MessageV2.Assistant
      agent: Agent.Info
    },
    maxParallel?: number,
    shared?: {
      limiter: { run<T>(fn: () => Promise<T>): Promise<T> }
      resourceLockManager: { acquire(keys: Set<string>, mode: ResourceLockMode): Promise<() => void> }
      onToolExecuted?: (result: ToolExecutionResult, executor: ToolExecutor) => void
    },
  ): Promise<void> {
    if (executors.length === 0) return

    const toolCalls: MessageV2.ToolPart[] = executors.map((e) => ({
      id: e.partId,
      sessionID: input.sessionID,
      messageID: input.assistantMessage.id,
      type: "tool",
      callID: e.callId,
      tool: e.toolName,
      state: {
        status: "pending" as const,
        input: e.input,
        raw: "",
      },
    }))

    const dependencyResult = ToolDependency.analyze(toolCalls)

    log.debug("dependency analysis", {
      sessionID: input.sessionID,
      levels: dependencyResult.levels.length,
      totalCalls: toolCalls.length,
    })

    const limit = Math.max(1, maxParallel ?? 10)
    const limiter = shared?.limiter ?? (() => {
      let active = 0
      const queue: Array<() => void> = []
      async function run<T>(fn: () => Promise<T>): Promise<T> {
        while (active >= limit) {
          await new Promise<void>((resolve) => queue.push(resolve))
        }
        active++
        try {
          return await fn()
        } finally {
          active--
          const next = queue.shift()
          if (next) next()
        }
      }
      return { run }
    })()
    const resourceLockManager = shared?.resourceLockManager ?? createResourceLockManager()
    const getKeys = (executor: ToolExecutor) => {
      const call = toolCalls.find((c) => c.callID === executor.callId)
      if (!call) return new Set<string>([`tool:${executor.toolName}`])
      return ToolDependency.resourceKeys(call)
    }

    for (const level of dependencyResult.levels) {
      const parallelExecutors = level.calls.map((call) => {
        const executor = executors.find((e) => e.callId === call.id)!
        return limiter
          .run(async () => {
            const keys = getKeys(executor)
            const mode = toolLockMode(executor.toolName)
            const release = await resourceLockManager.acquire(keys, mode)
            try {
              const result = await executeTool(executor, tools, input)
              shared?.onToolExecuted?.(result, executor)
            } finally {
              release()
            }
          })
          .catch((error) => {
            log.error("tool execution failed", {
              sessionID: input.sessionID,
              tool: executor.toolName,
              callId: executor.callId,
              error,
            })
          })
      })

      await Promise.all(parallelExecutors)
    }
  }

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false
    let backgroundHandler: BackgroundTaskHandler | null = null

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process")
        needsCompaction = false
        const config = await Config.get()
        const shouldBreak = config.experimental?.continue_loop_on_deny !== true
        const parallelEnabled = config.experimental?.parallel_execution !== false
        const maxParallelTools = config.experimental?.max_parallel_tools ?? 10
        const agentInfo = await Agent.get(input.assistantMessage.agent)
        const exp = (config.experimental ?? {}) as { delta_throttle_ms?: number; deltaThrottleMs?: number }
        const deltaThrottleMsRef = { value: Math.max(0, (exp.delta_throttle_ms ?? exp.deltaThrottleMs ?? 80)) }
        const resourceLockManager = createResourceLockManager()
        const concurrencyRef = { value: Math.max(1, maxParallelTools) }
        let toolSampleCount = 0
        let toolErrorCount = 0
        let toolDurationSum = 0
        let toolAdjustAt = Date.now()
        const limiter = (() => {
          let active = 0
          const queue: Array<() => void> = []
          async function run<T>(fn: () => Promise<T>): Promise<T> {
            while (active >= concurrencyRef.value) {
              await new Promise<void>((resolve) => queue.push(resolve))
            }
            active++
            try {
              return await fn()
            } finally {
              active--
              const next = queue.shift()
              if (next) next()
            }
          }
          return { run }
        })()
        const onToolExecuted = (r: ToolExecutionResult) => {
          toolSampleCount++
          toolDurationSum += r.durationMs
          if (!r.ok) toolErrorCount++
          const now = Date.now()
          const shouldAdjust = toolSampleCount >= 12 || now - toolAdjustAt >= 10_000
          if (!shouldAdjust) return
          const avg = toolSampleCount > 0 ? toolDurationSum / toolSampleCount : 0
          const errRate = toolSampleCount > 0 ? toolErrorCount / toolSampleCount : 0
          const prev = concurrencyRef.value
          let next = prev
          if (errRate >= 0.25) next = Math.max(1, Math.floor(prev * 0.7))
          else if (avg >= 2_500) next = Math.max(1, prev - 1)
          else if (avg <= 600) next = Math.min(maxParallelTools, prev + 1)
          concurrencyRef.value = next
          toolSampleCount = 0
          toolErrorCount = 0
          toolDurationSum = 0
          toolAdjustAt = now
        }
        let pendingExecutors: ToolExecutor[] = []
        let parallelExecutedCount = 0
        let flushPromise: Promise<void> | null = null
        const scheduleFlush = () => {
          if (!parallelEnabled) return
          if (pendingExecutors.length === 0) return
          if (flushPromise) return
          const executors = pendingExecutors
          pendingExecutors = []
          const tools = streamInput.tools
          flushPromise = executeToolsParallel(
            executors,
            tools,
            {
              sessionID: input.sessionID,
              assistantMessage: input.assistantMessage,
              agent: agentInfo,
            },
            maxParallelTools,
            { resourceLockManager, limiter, onToolExecuted },
          ).finally(() => {
            flushPromise = null
          })
        }
        let textBuffer = ""
        let textTimer: any | null = null
        let textPartRef: MessageV2.TextPart | undefined
        let reasoningBuffers: Record<string, { part: MessageV2.ReasoningPart; buffer: string; timer: any | null }> = {}
        let deltaEvents = 0
        let deltaAdjustTimer: any | null = null
        deltaAdjustTimer = setInterval(() => {
          const perSecond = deltaEvents
          deltaEvents = 0
          if (exp.delta_throttle_ms !== undefined || exp.deltaThrottleMs !== undefined) return
          if (perSecond >= 180) deltaThrottleMsRef.value = 140
          else if (perSecond >= 90) deltaThrottleMsRef.value = 100
          else if (perSecond <= 25) deltaThrottleMsRef.value = 60
          else deltaThrottleMsRef.value = 80
        }, 1_000)
        const flushText = async () => {
          if (!textPartRef || !textBuffer) {
            textTimer = null
            return
          }
          const delta = textBuffer
          textBuffer = ""
          await Session.updatePart({ part: textPartRef, delta })
          textTimer = null
        }
        const pushTextDelta = (part: MessageV2.TextPart, delta: string) => {
          textPartRef = part
          textBuffer += delta
          deltaEvents++
          if (!textTimer) {
            textTimer = setTimeout(() => {
              flushText().catch(() => {})
            }, deltaThrottleMsRef.value)
          }
        }
        const flushReasoning = async (id: string) => {
          const entry = reasoningBuffers[id]
          if (!entry || !entry.buffer) {
            entry && (entry.timer = null)
            return
          }
          const delta = entry.buffer
          entry.buffer = ""
          await Session.updatePart({ part: entry.part, delta })
          entry.timer = null
        }
        const pushReasoningDelta = (id: string, part: MessageV2.ReasoningPart, delta: string) => {
          if (!reasoningBuffers[id]) {
            reasoningBuffers[id] = { part, buffer: "", timer: null }
          }
          reasoningBuffers[id].part = part
          reasoningBuffers[id].buffer += delta
          deltaEvents++
          if (!reasoningBuffers[id].timer) {
            reasoningBuffers[id].timer = setTimeout(() => {
              flushReasoning(id).catch(() => {})
            }, deltaThrottleMsRef.value)
          }
        }
        const stopTimers = () => {
          if (textTimer) {
            clearTimeout(textTimer)
            textTimer = null
          }
          for (const entry of Object.values(reasoningBuffers)) {
            if (entry.timer) {
              clearTimeout(entry.timer)
              entry.timer = null
            }
          }
          if (deltaAdjustTimer) {
            clearInterval(deltaAdjustTimer)
            deltaAdjustTimer = null
          }
        }
        while (true) {
          try {
            let currentText: MessageV2.TextPart | undefined
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
            const stream = await LLM.stream({ ...streamInput, config })

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  reasoningMap[value.id] = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    if (value.text) pushReasoningDelta(value.id, part, value.text)
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    const buffered = reasoningBuffers[value.id]
                    if (buffered?.timer) {
                      clearTimeout(buffered.timer)
                      buffered.timer = null
                    }
                    if (buffered) {
                      buffered.buffer = ""
                      buffered.part = part
                    }
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: parallelEnabled
                        ? {
                            status: "pending" as const,
                            input: value.input,
                            raw: "",
                          }
                        : {
                            status: "running" as const,
                            input: value.input,
                            time: { start: Date.now() },
                          },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                    if (parallelEnabled) {
                      pendingExecutors.push({
                        toolId: value.toolName,
                        toolName: value.toolName,
                        input: value.input,
                        partId: part.id,
                        callId: value.toolCallId,
                        abort: input.abort,
                      })
                      if (pendingExecutors.length >= Math.min(2, maxParallelTools)) {
                        scheduleFlush()
                      }
                    }

                    if (!parallelEnabled) {
                      const parts = await MessageV2.parts(input.assistantMessage.id)
                      const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                      if (
                        lastThree.length === DOOM_LOOP_THRESHOLD &&
                        lastThree.every(
                          (p) =>
                            p.type === "tool" &&
                            p.tool === value.toolName &&
                            p.state.status !== "pending" &&
                            JSON.stringify(p.state.input) === JSON.stringify(value.input),
                        )
                      ) {
                        await PermissionNext.ask({
                          permission: "doom_loop",
                          patterns: [value.toolName],
                          sessionID: input.assistantMessage.sessionID,
                          metadata: {
                            tool: value.toolName,
                            input: value.input,
                          },
                          always: [value.toolName],
                          ruleset: agentInfo.permission,
                        })
                      }
                    }
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    const attachments = value.output.attachments?.map(
                      (attachment: Omit<MessageV2.FilePart, "id" | "messageID" | "sessionID">) => ({
                        ...attachment,
                        id: Identifier.ascending("part"),
                        messageID: match.messageID,
                        sessionID: match.sessionID,
                      }),
                    )
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input ?? match.state.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments,
                      },
                    })

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input ?? match.state.input,
                        error: (value.error as any).toString(),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step":
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    reason: value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "patch",
                        hash: patch.hash,
                        files: patch.files,
                      })
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                    needsCompaction = true
                  }
                  if (flushPromise) await flushPromise
                  if (parallelEnabled && pendingExecutors.length > 0) {
                    scheduleFlush()
                    if (flushPromise) await flushPromise
                  }
                  break

                case "text-start":
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    if (value.text) pushTextDelta(currentText, value.text)
                  }
                  break

                case "text-end":
                  if (currentText) {
                    await flushText()
                    currentText.text = currentText.text.trimEnd()
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePart(currentText)
                  }
                  currentText = undefined
                  break

                case "finish":
                  await flushText()
                  for (const id of Object.keys(reasoningBuffers)) {
                    await flushReasoning(id)
                  }
                  if (flushPromise) await flushPromise
                  if (parallelEnabled && pendingExecutors.length > 0) {
                    scheduleFlush()
                    if (flushPromise) await flushPromise
                  }
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }
            await flushText()
            for (const id of Object.keys(reasoningBuffers)) {
              await flushReasoning(id)
            }
            if (flushPromise) await flushPromise
            if (parallelEnabled && pendingExecutors.length > 0) {
              scheduleFlush()
              if (flushPromise) await flushPromise
            }
            stopTimers()
          } catch (e: any) {
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              attempt++
              const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt,
                message: retry,
                next: Date.now() + delay,
              })
              await SessionRetry.sleep(delay, input.abort).catch(() => {})
              stopTimers()
              continue
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
            SessionStatus.set(input.sessionID, { type: "idle" })
          }
          stopTimers()
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
      async enableBackgroundTasks(config?: WorkQueueIntegrationConfig) {
        if (backgroundHandler) {
          await backgroundHandler.stop()
        }
        backgroundHandler = new BackgroundTaskHandler(input.sessionID, config)
        await backgroundHandler.initialize()
        backgroundHandler.setContext(await Agent.get(input.assistantMessage.agent), input.model)
        return backgroundHandler
      },
      async disableBackgroundTasks() {
        if (backgroundHandler) {
          await backgroundHandler.stop()
          backgroundHandler = null
        }
      },
      getWorkQueue() {
        return backgroundHandler
      },
    }
    return result
  }
}
