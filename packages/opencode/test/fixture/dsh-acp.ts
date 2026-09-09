import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, type SessionConfigOption } from "@agentclientprotocol/sdk"
import { Readable, Writable } from "node:stream"

const mode = process.argv[2]
if (mode === "stubborn") {
  setInterval(() => {}, 1000)
  process.on("SIGTERM", () => {})
}
const turns = new Map<string, number>()
const selectedModels = new Map<string, string>()
const pending = new Map<string, () => void>()
const modelValues = [
  { value: JSON.stringify(["deepseek-official", "deepseek-v4-flash"]), name: "DeepSeek V4 Flash" },
  { value: JSON.stringify(["deepseek-official", "deepseek-v4-pro"]), name: "DeepSeek V4 Pro" },
]
const configOptions = (sessionId: string): SessionConfigOption[] => [{
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: selectedModels.get(sessionId) ?? modelValues[0].value,
  options: [{ group: "deepseek-official", name: "DeepSeek", options: modelValues }],
}]
const connection = new AgentSideConnection(() => ({
  async initialize() {
    if (mode === "hang") await new Promise(() => {})
    if (mode === "error") throw new Error("SECRET_FROM_REMOTE")
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: mode === "wrong" ? "other-agent" : "deepseek-harness-acp", version: "0.0.1" },
      agentCapabilities: { sessionCapabilities: { resume: {}, close: {} } },
    }
  },
  async authenticate() {},
  async newSession() {
    const sessionId = crypto.randomUUID()
    turns.set(sessionId, 0)
    selectedModels.set(sessionId, modelValues[0].value)
    if (mode === "early-config") await connection.sessionUpdate({ sessionId, update: {
      sessionUpdate: "config_option_update", configOptions: [],
    } })
    return { sessionId, configOptions: configOptions(sessionId) }
  },
  async resumeSession(input) {
    turns.set(input.sessionId, 1)
    selectedModels.set(input.sessionId, modelValues[0].value)
    return { configOptions: configOptions(input.sessionId) }
  },
  async loadSession() { throw new Error("unsupported") },
  async closeSession(input) {
    if (mode === "stubborn") await new Promise(() => {})
    pending.get(input.sessionId)?.()
    turns.delete(input.sessionId)
    selectedModels.delete(input.sessionId)
    return {}
  },
  async cancel(input) { pending.get(input.sessionId)?.() },
  async setSessionConfigOption(input) {
    if (input.configId !== "model" || typeof input.value !== "string" || !modelValues.some((item) => item.value === input.value)) {
      throw new Error("unknown model option")
    }
    selectedModels.set(input.sessionId, input.value)
    return { configOptions: configOptions(input.sessionId) }
  },
  async prompt(input) {
    const text = input.prompt.flatMap((part) => part.type === "text" ? [part.text] : []).join("")
    if (text === "crash") process.exit(7)
    if (text === "error") throw new Error("SECRET_FROM_REMOTE")
    if (!turns.has(input.sessionId)) throw new Error("unknown session")
    turns.set(input.sessionId, turns.get(input.sessionId)! + 1)
    await connection.sessionUpdate({ sessionId: input.sessionId, update: {
      sessionUpdate: "agent_message_chunk", content: { type: "text", text: `turn ${turns.get(input.sessionId)}: ` },
    } })
    if (text === "hold") {
      await new Promise<void>((resolve) => pending.set(input.sessionId, resolve))
      return { stopReason: "cancelled" }
    }
    if (text === "permission") {
      await connection.sessionUpdate({ sessionId: input.sessionId, update: {
        sessionUpdate: "tool_call", toolCallId: "call-1", title: "write", status: "in_progress", rawInput: { path: "example.txt" },
      } })
      const result = await connection.requestPermission({
        sessionId: input.sessionId, toolCall: { toolCallId: "call-1" },
        options: [{ kind: "allow_once", name: "Allow", optionId: "yes" }, { kind: "reject_once", name: "Reject", optionId: "no" }],
      })
      await connection.sessionUpdate({ sessionId: input.sessionId, update: {
        sessionUpdate: "tool_call_update", toolCallId: "call-1",
        status: result.outcome.outcome === "selected" && result.outcome.optionId === "yes" ? "completed" : "failed",
        content: [{ type: "content", content: { type: "text", text: "tool result" } }],
      } })
    }
    if (text === "model") {
      await connection.sessionUpdate({ sessionId: input.sessionId, update: {
        sessionUpdate: "agent_message_chunk", content: { type: "text", text: selectedModels.get(input.sessionId) ?? "none" },
      } })
    }
    await connection.sessionUpdate({ sessionId: input.sessionId, update: {
      sessionUpdate: "agent_message_chunk", content: { type: "text", text: "finished" },
    } })
    return { stopReason: "end_turn" }
  },
}), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>))
await connection.closed
