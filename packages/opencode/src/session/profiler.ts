import path from "path"
import { createWriteStream, mkdirSync, type WriteStream } from "fs"
import { Global } from "../global"
import { Flag } from "../flag/flag"

export namespace Profiler {
  interface RequestData {
    timestamp: string
    sessionID: string
    messageID: string
    agent: string
    provider: string
    modelID: string
    apiModelID: string
    endpoint: string
    system: string[]
    userQuery: string
    messageCount: number
    tools: string[]
    startTime: number
    text: string
    reasoning: string
    toolCalls: { tool: string; input: unknown }[]
  }

  const pending = new Map<string, RequestData>()
  let stream: WriteStream | undefined

  function enabled() {
    return Flag.OPENCODE_PROFILING
  }

  function ensure() {
    if (stream) return stream
    const dir = path.join(Global.Path.data, "profiling")
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `profile-${new Date().toISOString().split(".")[0].replace(/:/g, "")}.jsonl`)
    stream = createWriteStream(file, { flags: "a" })
    return stream
  }

  export function startRequest(input: {
    sessionID: string
    messageID: string
    agent: string
    provider: string
    modelID: string
    apiModelID: string
    endpoint: string
    system: string[]
    userQuery: string
    messageCount: number
    tools: string[]
  }) {
    if (!enabled()) return
    pending.set(input.sessionID, {
      ...input,
      timestamp: new Date().toISOString(),
      startTime: Date.now(),
      text: "",
      reasoning: "",
      toolCalls: [],
    })
  }

  export function appendText(sessionID: string, delta: string) {
    if (!enabled()) return
    const req = pending.get(sessionID)
    if (req) req.text += delta
  }

  export function appendReasoning(sessionID: string, delta: string) {
    if (!enabled()) return
    const req = pending.get(sessionID)
    if (req) req.reasoning += delta
  }

  export function appendToolCall(sessionID: string, tool: string, input: unknown) {
    if (!enabled()) return
    const req = pending.get(sessionID)
    if (req) req.toolCalls.push({ tool, input })
  }

  export function endRequest(input: {
    sessionID: string
    messageID: string
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: { read: number; write: number }
    }
    cost: number
    finishReason: string
  }) {
    if (!enabled()) return
    const req = pending.get(input.sessionID)
    if (!req) return
    pending.delete(input.sessionID)

    const record = {
      timestamp: req.timestamp,
      sessionID: req.sessionID,
      messageID: req.messageID,
      agent: req.agent,
      provider: req.provider,
      modelID: req.modelID,
      apiModelID: req.apiModelID,
      endpoint: req.endpoint,
      system: req.system,
      userQuery: req.userQuery,
      messageCount: req.messageCount,
      tools: req.tools,
      tokens: input.tokens,
      cost: input.cost,
      finishReason: input.finishReason,
      output: {
        text: req.text,
        reasoning: req.reasoning,
        toolCalls: req.toolCalls,
      },
      durationMs: Date.now() - req.startTime,
    }

    ensure().write(JSON.stringify(record) + "\n")
  }
}
