// Changing the top-level tool list invalidates the provider prompt cache. Protocols with native
// mid-conversation tool changes keep it frozen and lower `Message.tools(...)` markers instead; other
// routes fold every marker, in order, into the top-level list.
import { Message, SystemMessage, type LLMRequest, type ToolChanges, type ToolEntry } from "./schema/messages.js"

export const toolsUpdate = (message: Message): ToolChanges | undefined =>
  message.role === "system" ? message.tools : undefined

/** Apply one change: removals first, then additions replace a same-named tool in place or append. */
export const foldTools = <Item extends { readonly name: string }>(
  tools: ReadonlyArray<Item>,
  add: ReadonlyArray<Item>,
  remove: ReadonlyArray<string>,
): ReadonlyArray<Item> => {
  const added = new Map(add.map((tool) => [tool.name, tool]))
  const kept = tools.filter((tool) => !remove.includes(tool.name)).map((tool) => added.get(tool.name) ?? tool)
  const names = new Set(kept.map((tool) => tool.name))
  return [...kept, ...[...added.values()].filter((tool) => !names.has(tool.name))]
}

// A marker's own text stays as an ordinary system update.
export const foldToolUpdates = (request: LLMRequest): LLMRequest => {
  if (!request.messages.some((message) => toolsUpdate(message) !== undefined)) return request
  return {
    ...request,
    tools: request.messages.reduce((tools, message) => {
      const update = toolsUpdate(message)
      return update === undefined ? tools : foldTools(tools, update.add, update.remove)
    }, request.tools),
    messages: request.messages.flatMap((message) => {
      if (message.role !== "system" || message.tools === undefined) return [message]
      if (message.content.length === 0) return []
      return [new SystemMessage({ id: message.id, role: "system", content: message.content })]
    }),
  }
}

export const applyToolUpdates = (request: LLMRequest): LLMRequest =>
  request.model.route.supportsToolUpdates?.(request) ? request : foldToolUpdates(request)

/** Rewrite the tools each marker adds, keeping the request identity when there are no markers. */
export const mapToolUpdates = (
  request: LLMRequest,
  f: (tools: ReadonlyArray<ToolEntry>) => ReadonlyArray<ToolEntry>,
): LLMRequest => {
  if (!request.messages.some((message) => toolsUpdate(message) !== undefined)) return request
  return {
    ...request,
    messages: request.messages.map((message) =>
      message.role === "system" && message.tools !== undefined
        ? new SystemMessage({ ...message, tools: { add: f(message.tools.add), remove: message.tools.remove } })
        : message,
    ),
  }
}

/** Names of top-level tools that only exist through tool updates, not the starting `tools`. */
export const inlineToolNames = (request: LLMRequest) => {
  const starting = new Set(request.tools.map((tool) => tool.name))
  return new Set(
    request.messages
      .flatMap((message) => toolsUpdate(message)?.add ?? [])
      .filter((tool) => tool.type === "tool" && !starting.has(tool.name))
      .map((tool) => tool.name),
  )
}

/** The note sent with removals: a provider may not stop the model from calling a removed tool. */
export const removalNotice = (names: ReadonlyArray<string>) => {
  const quoted = names.map((name) => `\`${name}\``)
  if (quoted.length === 1) return `${quoted[0]} is no longer available. Do not call it.`
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)} are no longer available. Do not call them.`
}
