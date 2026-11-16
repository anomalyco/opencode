// A request's top-level `tools` is shorthand for a leading `Message.tools({ add: tools })`: tool state is one
// ordered list of declarations, that leading one and then each marker in message order. Folding the whole list
// gives the tools a route without in-place changes sends. A protocol that can send some changes in place keeps
// them where they are, so the leading declaration, and the prompt cache behind it, stays fixed.
import { Message, SystemMessage, type LLMRequest, type ToolChanges, type ToolEntry } from "./schema/messages.js"
import type { Capabilities } from "./schema/options.js"

export type ToolUpdate = NonNullable<NonNullable<Capabilities["tools"]>["updates"]>[number]

/** What a protocol can send in place of a `Message.tools(...)` marker; the model's `tools.updates` narrows it. */
export interface ToolUpdateEncoding {
  readonly kinds: ReadonlyArray<ToolUpdate>
  /** Whether the marker at this message index can be sent where it is. Defaults to anywhere. */
  readonly placeable?: (request: LLMRequest, index: number) => boolean
  /** Whether a tool can be added or removed in place. Defaults to every tool. */
  readonly declarable?: (tool: ToolEntry) => boolean
}

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

/** One tool declaration: the request's `tools` lead at index -1, then each marker at its message index. */
export interface ToolDeclaration extends ToolChanges {
  readonly index: number
}

export const toolDeclarations = (request: LLMRequest): ReadonlyArray<ToolDeclaration> => [
  { index: -1, add: request.tools, remove: [] },
  ...request.messages.flatMap((message, index) => {
    const update = toolsUpdate(message)
    return update === undefined ? [] : [{ index, ...update }]
  }),
]

/**
 * Fold the declarations up to the last one this route can't send in place into the leading one (the request's
 * `tools`), and keep later markers in place, trimmed to their effective changes. A marker is sent in place only
 * after the conversation starts, when the model's `tools.updates` and the protocol's encoding both cover what it
 * does: `add` a new name, `replace` a name declared before (even if removed since), `remove` a current tool.
 * Removing a name that matches no current tool does nothing.
 */
export const planToolUpdates = (request: LLMRequest): LLMRequest => {
  const encoding = request.model.route.toolUpdates
  return plan(
    request,
    (request.model.capabilities?.tools?.updates ?? []).filter((kind) => encoding?.kinds.includes(kind)),
  )
}

/** Fold every marker into the top-level tools, as a route without in-place tool changes sends them. */
export const foldToolUpdates = (request: LLMRequest): LLMRequest => plan(request, [])

const plan = (request: LLMRequest, supported: ReadonlyArray<ToolUpdate>): LLMRequest => {
  const [leading, ...changes] = toolDeclarations(request)
  if (leading === undefined || changes.length === 0) return request
  const encoding = request.model.route.toolUpdates
  const firstTurn = request.messages.findIndex((message) => message.role !== "system")
  const steps = changes.reduce(
    (state, change) => {
      const added = change.add.map((tool) => tool.name)
      const removed = state.tools.filter((tool) => change.remove.includes(tool.name) && !added.includes(tool.name))
      const kinds = [
        ...(removed.length > 0 || change.add.some((tool) => dropsTools(state.tools, tool)) ? ["remove" as const] : []),
        ...added.map((name) => (state.declared.has(name) ? ("replace" as const) : ("add" as const))),
      ]
      const native =
        firstTurn !== -1 &&
        change.index > firstTurn &&
        kinds.every((kind) => supported.includes(kind)) &&
        [...change.add, ...removed].every((tool) => encoding?.declarable?.(tool) ?? true) &&
        (encoding?.placeable?.(request, change.index) ?? true)
      const tools = foldTools(state.tools, change.add, change.remove)
      const step = {
        index: change.index,
        native,
        tools,
        changes: { add: change.add, remove: removed.map((tool) => tool.name) },
      }
      return { tools, declared: new Set([...state.declared, ...added]), steps: [...state.steps, step] }
    },
    {
      tools: leading.add,
      declared: new Set(leading.add.map((tool) => tool.name)),
      steps: [] as ReadonlyArray<PlanStep>,
    },
  ).steps
  const cut = steps.findLastIndex((step) => !step.native)
  const kept = new Map(steps.slice(cut + 1).map((step) => [step.index, step.changes]))
  return {
    ...request,
    tools: cut === -1 ? leading.add : steps[cut]!.tools,
    messages: request.messages.flatMap((message, index) => {
      if (message.role !== "system" || message.tools === undefined) return [message]
      const changes = kept.get(index)
      if (changes !== undefined && (changes.add.length > 0 || changes.remove.length > 0))
        return [new SystemMessage({ ...message, tools: changes })]
      if (message.content.length === 0) return []
      return [new SystemMessage({ id: message.id, role: "system", content: message.content })]
    }),
  }
}

interface PlanStep {
  readonly index: number
  readonly native: boolean
  readonly tools: ReadonlyArray<ToolEntry>
  readonly changes: ToolChanges
}

// Redefining a namespace without some of its tools also removes those tools.
const dropsTools = (tools: ReadonlyArray<ToolEntry>, tool: ToolEntry) => {
  const previous = tools.find((entry) => entry.name === tool.name)
  if (previous === undefined) return false
  const next = toolNames(tool)
  return toolNames(previous).some((name) => !next.includes(name))
}

const toolNames = (tool: ToolEntry): ReadonlyArray<string> =>
  tool.type === "namespace"
    ? tool.tools.flatMap((leaf) => toolNames(leaf).map((name) => `${tool.name}_${name}`))
    : [tool.name]

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
