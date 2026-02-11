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
import { SessionFallback } from "./fallback"
import { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { TuiEvent } from "@/cli/cmd/tui/event"
import type { ModelMessage } from "ai"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const FALLBACK_RETRY_LIMIT = 1
  const log = Log.create({ service: "session.processor" })

  class FirstTokenTimeoutError extends Error {
    constructor(timeoutMs: number, modelID: string) {
      super(`First token timeout after ${timeoutMs}ms for model ${modelID}`)
      this.name = "FirstTokenTimeoutError"
    }
  }

  export function estimateInputChars(messages: ModelMessage[]): number {
    let chars = 0
    for (const msg of messages) {
      if (typeof msg.content === "string") {
        chars += msg.content.length
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if ("text" in part && typeof part.text === "string") {
            chars += part.text.length
          }
        }
      }
    }
    return chars
  }

  export function computeTtftTimeout(baseMs: number, messages: ModelMessage[]): number {
    return baseMs + estimateInputChars(messages) * 0.5
  }

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
    fallbackModels?: Array<{ providerID: string; modelID: string }>
    firstTokenTimeout?: number
    agentName?: string
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false

    const modelList = input.fallbackModels?.length
      ? SessionFallback.buildModelList(
          { providerID: input.model.providerID, modelID: input.model.id },
          input.fallbackModels,
        )
      : undefined
    let fallbackStartIndex =
      modelList && input.agentName ? SessionFallback.getStartIndex(input.sessionID, input.agentName) : 0
    if (modelList && fallbackStartIndex >= modelList.length) {
      fallbackStartIndex = 0
    }
    let currentModelIndex = fallbackStartIndex
    if (modelList) {
      log.info("fallback.init", {
        modelList: modelList.map((m) => `${m.providerID}/${m.modelID}`).join(", "),
        fallbackStartIndex,
        agentName: input.agentName,
        sessionID: input.sessionID,
      })
    }

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
        const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true

        // If fallback state remembers a previously successful model, switch to it
        if (modelList && fallbackStartIndex > 0 && fallbackStartIndex < modelList.length) {
          const ref = modelList[fallbackStartIndex]
          try {
            const nextModel = await Provider.getModel(ref.providerID, ref.modelID)
            input.model = nextModel
            streamInput.model = nextModel
            input.assistantMessage.modelID = nextModel.id
            input.assistantMessage.providerID = nextModel.providerID
            await Session.updateMessage(input.assistantMessage)
          } catch {
            // If resolving the remembered model fails, reset to primary
            // so the fallback cycle covers all models
            currentModelIndex = 0
            fallbackStartIndex = 0
          }
        }

        while (true) {
          let ttftTimer: ReturnType<typeof setTimeout> | undefined
          let ttftAbortController: AbortController | undefined

          try {
            let currentText: MessageV2.TextPart | undefined
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}

            // Set up TTFT timer when fallback is configured and firstTokenTimeout is set
            const ttftBase =
              modelList && modelList.length > 1 && input.firstTokenTimeout ? input.firstTokenTimeout : undefined
            let effectiveAbort = input.abort
            let ttftAbortController: AbortController | undefined
            if (ttftBase !== undefined) {
              ttftAbortController = new AbortController()
              effectiveAbort = AbortSignal.any([input.abort, ttftAbortController.signal])
            }

            const stream = await LLM.stream({ ...streamInput, abort: effectiveAbort })

            // Start TTFT timer after LLM.stream() returns to measure only HTTP/network overhead
            // This excludes framework initialization time (provider init, config loading, etc.)
            let ttftTimer: ReturnType<typeof setTimeout> | undefined
            if (ttftBase !== undefined) {
              const timeoutMs = computeTtftTimeout(ttftBase, streamInput.messages)
              ttftTimer = setTimeout(() => {
                ttftAbortController!.abort(
                  new FirstTokenTimeoutError(timeoutMs, `${input.model.providerID}/${input.model.id}`),
                )
              }, timeoutMs)
              log.info("ttft.timer.start", {
                timeoutMs,
                baseMs: ttftBase,
                model: `${input.model.providerID}/${input.model.id}`,
              })
            }

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  if (ttftTimer) {
                    clearTimeout(ttftTimer)
                    ttftTimer = undefined
                  }
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
                    if (part.text) await Session.updatePart({ part, delta: value.text })
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
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  if (ttftTimer) {
                    clearTimeout(ttftTimer)
                    ttftTimer = undefined
                  }
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
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

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
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await PermissionNext.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: value.input,
                        },
                        always: [value.toolName],
                        ruleset: agent.permission,
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
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
                        attachments: value.output.attachments,
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
                  break

                case "text-start":
                  if (ttftTimer) {
                    clearTimeout(ttftTimer)
                    ttftTimer = undefined
                  }
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
                    if (currentText.text)
                      await Session.updatePart({
                        part: currentText,
                        delta: value.text,
                      })
                  }
                  break

                case "text-end":
                  if (currentText) {
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
                  break

                default:
                  // AI SDK yields "abort" event when the abort signal fires,
                  // rather than throwing. Detect TTFT-triggered abort and throw
                  // to enter the catch block and trigger fallback.
                  if ((value as any).type === "abort" && ttftAbortController?.signal.aborted && !input.abort.aborted) {
                    const reason = ttftAbortController.signal.reason
                    if (reason instanceof FirstTokenTimeoutError) {
                      throw reason
                    }
                  }
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }
          } catch (e: any) {
            // If the TTFT abort controller triggered (not user abort), replace the
            // DOMException("AbortError") with FirstTokenTimeoutError so it doesn't
            // get classified as AbortedError (which skips fallback).
            let err = e
            if (ttftAbortController?.signal.aborted && !input.abort.aborted) {
              const reason = ttftAbortController.signal.reason
              if (reason instanceof FirstTokenTimeoutError) {
                err = reason
              }
            }

            log.error("process", {
              error: err,
              stack: JSON.stringify(err.stack),
            })
            const error = MessageV2.fromError(err, { providerID: input.model.providerID })

            // No fallback configured → preserve existing retry/fail logic
            if (!modelList || modelList.length <= 1) {
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
                continue
              }
              input.assistantMessage.error = error
              Bus.publish(Session.Event.Error, {
                sessionID: input.assistantMessage.sessionID,
                error: input.assistantMessage.error,
              })
              SessionStatus.set(input.sessionID, { type: "idle" })
            } else {
              // Fallback configured: context overflow and abort should not trigger fallback
              if (MessageV2.ContextOverflowError.isInstance(error) || MessageV2.AbortedError.isInstance(error)) {
                input.assistantMessage.error = error
                Bus.publish(Session.Event.Error, {
                  sessionID: input.assistantMessage.sessionID,
                  error: input.assistantMessage.error,
                })
                SessionStatus.set(input.sessionID, { type: "idle" })
              } else {
                // For retryable API errors, try a short retry before switching models
                const retry = SessionRetry.retryable(error)
                if (retry !== undefined && MessageV2.APIError.isInstance(error) && attempt < FALLBACK_RETRY_LIMIT) {
                  attempt++
                  const delay = SessionRetry.delay(attempt, error)
                  SessionStatus.set(input.sessionID, {
                    type: "retry",
                    attempt,
                    message: retry,
                    next: Date.now() + delay,
                  })
                  await SessionRetry.sleep(delay, input.abort).catch(() => {})
                  continue
                }

                // Not retryable, or retry exhausted — switch to next model
                let switched = false
                let tryIdx: number | undefined = SessionFallback.nextIndex(
                  currentModelIndex,
                  modelList.length,
                  fallbackStartIndex,
                )
                while (tryIdx !== undefined) {
                  const ref = modelList[tryIdx]
                  try {
                    const nextModel = await Provider.getModel(ref.providerID, ref.modelID)
                    input.model = nextModel
                    streamInput.model = nextModel
                    input.assistantMessage.modelID = nextModel.id
                    input.assistantMessage.providerID = nextModel.providerID
                    await Session.updateMessage(input.assistantMessage)
                    log.info("fallback", {
                      from: currentModelIndex,
                      to: tryIdx,
                      providerID: ref.providerID,
                      modelID: ref.modelID,
                    })
                    currentModelIndex = tryIdx
                    attempt = 0
                    switched = true
                    break
                  } catch {
                    // This model can't be resolved, skip to the next one
                    currentModelIndex = tryIdx
                    tryIdx = SessionFallback.nextIndex(currentModelIndex, modelList.length, fallbackStartIndex)
                  }
                }

                if (switched) continue

                // All models tried → final failure
                input.assistantMessage.error = error
                Bus.publish(Session.Event.Error, {
                  sessionID: input.assistantMessage.sessionID,
                  error: input.assistantMessage.error,
                })
                SessionStatus.set(input.sessionID, { type: "idle" })
              }
            }
          } finally {
            if (ttftTimer) {
              clearTimeout(ttftTimer)
              ttftTimer = undefined
            }
          }
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
          // Record which model was last used for next request.
          // Only record on actual success — when all models fail, preserve the
          // previous success record so the next call starts from a known-good model.
          if (modelList && input.agentName) {
            if (!input.assistantMessage.error) {
              log.info("fallback.record", {
                sessionID: input.sessionID,
                agentName: input.agentName,
                currentModelIndex,
                model: `${input.model.providerID}/${input.model.id}`,
              })
              SessionFallback.recordSuccess(input.sessionID, input.agentName, currentModelIndex)
              if (currentModelIndex !== fallbackStartIndex) {
                const from = modelList[fallbackStartIndex]
                const to = modelList[currentModelIndex]
                Bus.publish(TuiEvent.ToastShow, {
                  message: `${input.agentName}: ${from.providerID}/${from.modelID} → ${to.providerID}/${to.modelID}`,
                  variant: "info" as const,
                  duration: 3000,
                })
              }
            }
          }
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }
}
