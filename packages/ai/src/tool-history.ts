import { type Message, ToolMessage, ToolResultPart, type ToolCallPart } from "./schema/messages.js"

const EMPTY_TOOL_OUTPUT = "(no tool output)"
const MISSING_TOOL_RESULT = "Tool result missing"

export function normalizeToolHistory(messages: ReadonlyArray<Message>) {
  const normalized: Message[] = []
  // Calls stay in order: providers can reuse one wire id for sibling calls, so a map by id would overwrite one.
  const pending: ToolCallPart[] = []
  // System updates cannot sit between a tool call and its results, so they wait until every pending call is answered.
  const held: Message[] = []
  const releaseHeld = () => {
    if (pending.length > 0) return
    normalized.push(...held)
    held.length = 0
  }
  const appendMissingResults = () => {
    if (pending.length > 0) normalized.push(missingToolResults(pending))
    pending.length = 0
    releaseHeld()
  }

  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") appendMissingResults()

    if (message.role === "tool") {
      const tool = normalizeToolMessage(message, pending)
      if (tool) normalized.push(tool)
      releaseHeld()
      continue
    }

    if (message.role === "system" && pending.length > 0) {
      held.push(message)
      continue
    }

    normalized.push(message)
    if (message.role !== "assistant") continue
    for (const part of message.content) {
      if (part.type === "tool-call" && part.providerExecuted !== true) pending.push(part)
    }
  }
  appendMissingResults()

  return normalized.length === messages.length && normalized.every((message, index) => message === messages[index])
    ? messages
    : normalized
}

function missingToolResults(calls: Iterable<ToolCallPart>) {
  return new ToolMessage({
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

function normalizeToolMessage(message: ToolMessage, pending: ToolCallPart[]): Message | undefined {
  const content = message.content.map((part) => {
    if (part.type !== "tool-result" || part.providerExecuted === true) return part
    const call = claimPending(pending, part)
    return normalizeToolResult(part, call)
  })
  if (content.length === 0) return undefined
  if (content.every((part, index) => part === message.content[index])) return message
  return new ToolMessage({ ...message, content })
}

/**
 * Remove the call this result answers. An exact `(id, name, namespace)` match wins so siblings that share a wire id
 * keep their own names; otherwise fall back to the id, which is how name-less results backfill their call's name.
 */
function claimPending(pending: ToolCallPart[], result: ToolResultPart): ToolCallPart | undefined {
  const exact = pending.findIndex(
    (call) => call.id === result.id && call.name === result.name && call.namespace === result.namespace,
  )
  const index = exact === -1 ? pending.findIndex((call) => call.id === result.id) : exact
  if (index === -1) return undefined
  return pending.splice(index, 1)[0]
}

function normalizeToolResult(part: ToolResultPart, call: ToolCallPart | undefined): ToolResultPart {
  const named =
    call === undefined || (part.name === call.name && part.namespace === call.namespace)
      ? part
      : { ...part, name: call.name, namespace: call.namespace }
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
