export * as ClaudeSession from "./session.js"

import type { LanguageModelV3FunctionTool } from "@ai-sdk/provider"
import type { Options, SDKMessage, SDKResultMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { ToolNames } from "../tools/names.js"
import { ClaudeProbe } from "./probe.js"
import { ClaudeSDK } from "./sdk.js"

interface Turn {
  readonly drained: PromiseWithResolvers<void>
  readonly messages: SDKMessage[]
  wake?: () => void
  finished: boolean
}

export type Interface = Awaited<ReturnType<typeof start>>

export async function start(options: Options) {
  const { query } = await ClaudeSDK.load()
  let input!: ReadableStreamDefaultController<SDKUserMessage>
  const prompt = new ReadableStream<SDKUserMessage>({
    start(controller) {
      input = controller
    },
  })
  const session = query({ prompt, options })
  let turn: Turn | undefined
  let initialized = false
  let ended = false
  let failure: unknown
  let stopping: Promise<void> | undefined
  let persisted = false
  const ready = session.initializationResult().then((init): ClaudeProbe.Result => {
    const error = ClaudeProbe.versionError(init.claude_code_version)
    if (error) throw error
    initialized = true
    return { version: init.claude_code_version!, account: init.account, models: init.models }
  })
  // A cancel during startup can stop the session before anything awaits ready.
  ready.catch(() => {})

  function finishTurn() {
    if (!turn) return
    turn.finished = true
    turn.drained.resolve()
  }

  // The only reader of the SDK iterator, including while a turn is being cancelled.
  async function readAll() {
    try {
      for await (const message of session) {
        if (turn) {
          turn.messages.push(message)
          turn.wake?.()
        }
        if (message.type === "assistant" || message.type === "result") persisted = true
        if (message.type === "result") finishTurn()
      }
    } catch (error) {
      failure = error
    } finally {
      ended = true
      finishTurn()
      turn?.wake?.()
    }
  }
  const pump = readAll()

  async function interrupt() {
    const active = turn
    if (!active || active.finished || ended) return
    await session.interrupt()
    // interrupt() resolves before the result and transcript flush, so wait for the drain before another turn starts.
    await active.drained.promise
  }

  async function shutdown() {
    try {
      if (initialized && !ended) {
        await session.interrupt()
        if (turn && !turn.finished) await turn.drained.promise
      }
      input.close()
      // An uninitialized process has no conversation to flush.
      if (!initialized) session.close()
      await pump
    } finally {
      session.close()
    }
  }

  function stop() {
    if (!stopping) stopping = shutdown()
    return stopping
  }

  function begin(content: SDKUserMessage["message"]["content"], uuid = crypto.randomUUID()) {
    if (ended || stopping) throw failure ?? new Error("Claude Code session has stopped")
    if (turn && !turn.finished) throw new Error("Claude Code is still finishing the previous turn")
    turn = { drained: Promise.withResolvers<void>(), messages: [], finished: false }
    input.enqueue({ type: "user", uuid, message: { role: "user", content }, parent_tool_use_id: null })
  }

  async function readStep(
    emit: (message: SDKMessage) => void,
    tools: readonly LanguageModelV3FunctionTool[],
  ): Promise<SDKResultMessage | "tools"> {
    const active = turn
    if (!active) throw new Error("No Claude turn to read")
    let calledTools = false
    while (true) {
      const message = active.messages.shift()
      if (!message) {
        if (ended) throw failure ?? new Error("Claude Code stopped before finishing its reply")
        await new Promise<void>((resolve) => {
          active.wake = resolve
        })
        continue
      }
      emit(message)
      if (message.type === "assistant" && message.parent_tool_use_id === null) {
        for (const part of message.message.content) {
          // Calls to tools we did not offer get Claude Code's own error, and the turn continues without OpenCode.
          if (part.type === "tool_use" && ToolNames.original(part.name, tools)) calledTools = true
        }
      }
      const replyEnded =
        message.type === "stream_event" && message.parent_tool_use_id === null && message.event.type === "message_stop"
      if (calledTools && replyEnded) return "tools"
      if (message.type === "result") return message
    }
  }

  return {
    id: options.resume ?? options.sessionId!,
    ready,
    get ended() {
      return ended
    },
    get persisted() {
      return persisted
    },
    get running() {
      return !!turn && !turn.finished
    },
    begin,
    readStep,
    addUser(content: SDKUserMessage["message"]["content"], uuid: NonNullable<SDKUserMessage["uuid"]>) {
      input.enqueue({
        type: "user",
        uuid,
        priority: "next",
        message: { role: "user", content },
        parent_tool_use_id: null,
      })
    },
    interrupt,
    stop,
    setModel: (model: string) => session.setModel(model),
    setEffort: (effort: Options["effort"]) => session.applyFlagSettings({ effortLevel: effort ?? null }),
  }
}
