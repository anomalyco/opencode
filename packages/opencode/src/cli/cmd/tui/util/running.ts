import { createSignal, createMemo, createEffect, onCleanup, type Accessor } from "solid-js"
import type { Message, Part, SessionStatus, ToolPart, TextPart, ReasoningPart } from "@opencode-ai/sdk/v2"
import { formatDuration } from "@/util/format"

const MAX_LEN = 40
const RUNNING_THRESHOLD_MS = 2000

export function extractToolCommand(tool: string, input: Record<string, unknown>): string {
  let cmd = ""

  switch (tool) {
    case "bash":
      cmd = (input.command as string) || "bash"
      break
    case "grep":
      cmd = `rg "${input.pattern}"${input.path ? ` ${input.path}` : ""}`
      break
    case "glob":
      cmd = `glob ${input.pattern}`
      break
    case "read":
      cmd = `read ${(input.filePath as string)?.split("/").pop() || input.filePath}`
      break
    case "write":
      cmd = `write ${(input.filePath as string)?.split("/").pop() || input.filePath}`
      break
    case "edit":
      cmd = `edit ${(input.filePath as string)?.split("/").pop() || input.filePath}`
      break
    case "task":
      cmd = `agent: ${(input.description as string) || "..."}`
      break
    case "webfetch":
      cmd = `fetch ${input.url}`
      break
    default:
      cmd = (input.title as string) || tool
  }

  return cmd.length > MAX_LEN ? cmd.slice(0, MAX_LEN - 3) + "..." : cmd
}

export type RunningTool = {
  id: string
  tool: string
  input: Record<string, unknown>
  command: string
  startTime: number
}

export type InferenceStatus =
  | { type: "sending"; startTime: number }
  | { type: "pondering"; startTime: number }
  | { type: "streaming"; startTime: number }
  | { type: "retry"; message: string; remaining: number }

type SyncData = {
  session_status: Record<string, SessionStatus>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
}

export function createRunningState(sessionID: Accessor<string>, data: SyncData) {
  const [tick, setTick] = createSignal(Date.now())

  const sessionStatus = createMemo(() => data.session_status?.[sessionID()] ?? { type: "idle" as const })
  const messages = createMemo(() => data.message[sessionID()] ?? [])

  const [thinkingStartTime, setThinkingStartTime] = createSignal<number | null>(null)

  // Only tick when session is busy or retrying
  createEffect(() => {
    const status = sessionStatus()
    if (status.type === "busy" || status.type === "retry") {
      const interval = setInterval(() => setTick(Date.now()), 1000)
      onCleanup(() => clearInterval(interval))
    }
  })

  // Track when thinking started
  createEffect(() => {
    const status = sessionStatus()
    if (status.type === "busy") {
      if (thinkingStartTime() === null) {
        setThinkingStartTime(Date.now())
      }
    } else {
      setThinkingStartTime(null)
    }
  })

  const runningTools = createMemo(() => {
    const now = tick()
    const tools: RunningTool[] = []

    for (const message of messages()) {
      const parts = data.part[message.id] ?? []
      for (const part of parts) {
        if (part.type === "tool") {
          const toolPart = part as ToolPart
          if (toolPart.state.status === "running") {
            const startTime = toolPart.state.time.start
            if (now - startTime >= RUNNING_THRESHOLD_MS) {
              tools.push({
                id: toolPart.id,
                tool: toolPart.tool,
                input: toolPart.state.input,
                command: "", // filled in below
                startTime,
              })
            }
          }
        }
      }
    }

    // Sort by start time and number agents
    const sorted = tools.sort((a, b) => a.startTime - b.startTime)
    let agentIndex = 0
    for (const tool of sorted) {
      if (tool.tool === "task") {
        agentIndex++
        const desc = (tool.input.description as string) || "..."
        tool.command = `agent${agentIndex}: ${desc}`
      } else {
        tool.command = extractToolCommand(tool.tool, tool.input)
      }
    }
    return sorted
  })

  const inferenceStatus = createMemo((): InferenceStatus | null => {
    const now = tick()
    const status = sessionStatus()

    // Handle retry state
    if (status.type === "retry") {
      const remaining = Math.max(0, Math.ceil((status.next - now) / 1000))
      return { type: "retry", message: status.message, remaining }
    }

    // Not busy = no inference happening
    if (status.type !== "busy") return null

    // Check threshold
    const startTime = thinkingStartTime()
    if (!startTime || now - startTime < RUNNING_THRESHOLD_MS) return null

    const sessionMessages = messages()
    const lastMsg = sessionMessages.at(-1)

    // No messages or last is user message = sending request
    if (!lastMsg || lastMsg.role === "user") {
      return { type: "sending", startTime }
    }

    // Have assistant message - check parts
    const parts = data.part[lastMsg.id] ?? []

    // No parts yet = pondering (waiting for first token)
    if (parts.length === 0) {
      return { type: "pondering", startTime }
    }

    // Check for active text/reasoning streaming (ignore tool parts)
    const lastTextOrReasoning = [...parts]
      .reverse()
      .find((p): p is TextPart | ReasoningPart => p.type === "text" || p.type === "reasoning")

    if (lastTextOrReasoning) {
      const hasContent = lastTextOrReasoning.text?.length > 0
      const isComplete = lastTextOrReasoning.time?.end !== undefined

      if (!hasContent) {
        return { type: "pondering", startTime }
      }

      if (!isComplete) {
        const streamStartTime = lastTextOrReasoning.time?.start ?? startTime
        return { type: "streaming", startTime: streamStartTime }
      }
    }

    // Between tool calls or other intermediate state = pondering
    if (!lastMsg.time.completed) {
      return { type: "pondering", startTime }
    }

    return null
  })

  return { tick, runningTools, inferenceStatus }
}
