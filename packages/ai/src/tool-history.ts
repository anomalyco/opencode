import { Message, ToolResultPart, type ToolCallPart } from "./schema/messages.js"

const EMPTY_OUTPUT = "(no tool output)"
const MISSING_RESULT = "Tool result missing"

export function normalizeToolHistory(messages: ReadonlyArray<Message>) {
  const output: Message[] = []
  const pending = new Map<string, ToolCallPart>()
  const settle = () => {
    if (pending.size === 0) return
    output.push(
      new Message({
        role: "tool",
        content: [...pending.values()].map((call) =>
          ToolResultPart.make({ id: call.id, name: call.name, result: MISSING_RESULT, resultType: "error" }),
        ),
      }),
    )
    pending.clear()
  }

  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") settle()

    if (message.role === "tool") {
      const content = message.content.flatMap((part) => {
        if (part.type !== "tool-result" || part.providerExecuted === true) return [part]
        const call = pending.get(part.id)
        if (!call) return [normalizeToolResult(part, part.name)]
        pending.delete(part.id)
        return [normalizeToolResult(part, call.name)]
      })
      if (content.length === 0) continue
      output.push(
        content.length === message.content.length && content.every((part, index) => part === message.content[index])
          ? message
          : new Message({
              id: message.id,
              role: message.role,
              content,
              metadata: message.metadata,
              native: message.native,
            }),
      )
      continue
    }

    output.push(message)
    if (message.role !== "assistant") continue
    for (const part of message.content) {
      if (part.type === "tool-call" && part.providerExecuted !== true) pending.set(part.id, part)
    }
  }

  settle()
  return output.length === messages.length && output.every((message, index) => message === messages[index])
    ? messages
    : output
}

function normalizeToolResult(part: ToolResultPart, name: string): ToolResultPart {
  const named = part.name === name ? part : { ...part, name }
  if (named.result.type === "text" && named.result.value === "")
    return { ...named, result: { type: "text", value: EMPTY_OUTPUT } }
  if (named.result.type === "error" && named.result.value === "")
    return { ...named, result: { type: "error", value: EMPTY_OUTPUT } }
  if (named.result.type !== "content") return named
  const value = named.result.value.filter((item) => item.type !== "text" || item.text !== "")
  if (value.length === 0) return { ...named, result: { type: "text", value: EMPTY_OUTPUT } }
  if (value.length === named.result.value.length) return named
  return { ...named, result: { type: "content", value } }
}
