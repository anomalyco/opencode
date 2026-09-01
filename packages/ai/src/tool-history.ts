import { Message, ToolResultPart, type ToolCallPart } from "./schema/messages.js"

const EMPTY_TOOL_OUTPUT = "(no tool output)"
const MISSING_TOOL_RESULT = "Tool result missing"

export function normalizeToolHistory(messages: ReadonlyArray<Message>) {
  const normalized: Message[] = []
  const pending = new Map<string, ToolCallPart>()
  const appendMissingResults = () => {
    if (pending.size === 0) return
    normalized.push(missingToolResults(pending.values()))
    pending.clear()
  }

  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") appendMissingResults()

    if (message.role === "tool") {
      const tool = normalizeToolMessage(message, pending)
      if (tool) normalized.push(tool)
      continue
    }

    normalized.push(message)
    if (message.role !== "assistant") continue
    for (const part of message.content) {
      if (part.type === "tool-call" && part.providerExecuted !== true) pending.set(part.id, part)
    }
  }

  return normalized.length === messages.length && normalized.every((message, index) => message === messages[index])
    ? messages
    : normalized
}

function missingToolResults(calls: Iterable<ToolCallPart>) {
  return new Message({
    role: "tool",
    content: [...calls].map((call) =>
      ToolResultPart.make({
        id: call.id,
        name: call.name,
        namespace: call.namespace,
        result: MISSING_TOOL_RESULT,
        resultType: "error",
      }),
    ),
  })
}

function normalizeToolMessage(message: Message, pending: Map<string, ToolCallPart>): Message | undefined {
  const content = message.content.map((part) => {
    if (part.type !== "tool-result" || part.providerExecuted === true) return part
    const call = pending.get(part.id)
    if (call) pending.delete(part.id)
    return normalizeToolResult(part, call)
  })
  if (content.length === 0) return undefined
  if (content.every((part, index) => part === message.content[index])) return message
  return new Message({
    id: message.id,
    role: message.role,
    content,
    metadata: message.metadata,
    providerMetadata: message.providerMetadata,
    native: message.native,
  })
}

function normalizeToolResult(part: ToolResultPart, call: ToolCallPart | undefined): ToolResultPart {
  const name = call?.name ?? part.name
  const namespace = call === undefined ? part.namespace : call.namespace
  const named = part.name === name && part.namespace === namespace ? part : { ...part, name, namespace }
  if (named.result.type === "text" && named.result.value === "")
    return { ...named, result: { type: "text", value: EMPTY_TOOL_OUTPUT } }
  if (named.result.type === "error" && named.result.value === "")
    return { ...named, result: { type: "error", value: EMPTY_TOOL_OUTPUT } }
  if (named.result.type !== "content") return named
  const value = named.result.value.filter((item) => item.type !== "text" || item.text !== "")
  if (value.length === 0) return { ...named, result: { type: "text", value: EMPTY_TOOL_OUTPUT } }
  if (value.length === named.result.value.length) return named
  return { ...named, result: { type: "content", value } }
}
