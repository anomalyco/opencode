// A request's top-level `tools` is shorthand for a leading `Message.tools({ add: tools })`: tool state is one
// ordered list of declarations, that leading one and then each marker in message order. Folding the whole list
// gives the tools a route without in-place changes sends. A protocol that can send some changes in place keeps
// them where they are, so the leading declaration, and the prompt cache behind it, stays fixed.
import {
  Message,
  SystemMessage,
  type LLMRequest,
  type ToolChanges,
  type ToolDefinition,
  type ToolEntry,
} from "./schema/messages.js"
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

/** Whether any marker adds a tool, so a request without top-level tools still declares some. */
export const addsTools = (request: LLMRequest) =>
  request.messages.some((message) => (toolsUpdate(message)?.add.length ?? 0) > 0)

/** The changes this route sends in place: the model's `tools.updates` that the protocol's encoding covers. */
export const toolUpdateKinds = (request: LLMRequest) => {
  const encoding = request.model.route.toolUpdates
  return (request.model.capabilities?.tools?.updates ?? []).filter((kind) => encoding?.kinds.includes(kind))
}

/** A tool or namespace, whose `tools` are its members when it is a namespace. */
export type FoldableTool = {
  readonly name: string
  readonly type?: string
  readonly tools?: ReadonlyArray<FoldableTool>
}

/**
 * Apply one change: removals first, by path (`crm.lookup`, or `crm` for a whole namespace), then additions replace a
 * same-named tool in place or append.
 */
export const foldTools = <Item extends FoldableTool>(
  tools: ReadonlyArray<Item>,
  add: ReadonlyArray<Item>,
  remove: ReadonlyArray<string>,
): ReadonlyArray<Item> => {
  const added = new Map(add.map((tool) => [tool.name, tool]))
  const kept = removePaths(tools, remove).map((tool) => added.get(tool.name) ?? tool)
  const names = new Set(kept.map((tool) => tool.name))
  return [...kept, ...[...added.values()].filter((tool) => !names.has(tool.name))]
}

/**
 * Fold the declarations up to the last one this route can't send in place into the leading one (the request's
 * `tools`), and keep later markers in place, trimmed to their effective changes. Protocols send kept markers in
 * message order and track what they need along the way. A marker is sent in place only after the conversation starts, when the model's
 * `tools.updates` and the protocol's encoding both cover what it does: `add` a new name, `replace` a name declared
 * before (even if removed since), `remove` a current tool. Removing a name that matches no current tool does nothing.
 */
export const planToolUpdates = (request: LLMRequest): LLMRequest => plan(request, toolUpdateKinds(request))

/** Fold every marker into the top-level tools, as a route without in-place tool changes sends them. */
export const foldToolUpdates = (request: LLMRequest): LLMRequest => plan(request, [])

const plan = (request: LLMRequest, supported: ReadonlyArray<ToolUpdate>): LLMRequest => {
  const changes = request.messages.flatMap((message, index) =>
    message.role === "system" && message.tools !== undefined ? [{ index, ...message.tools }] : [],
  )
  if (changes.length === 0) return request
  const encoding = request.model.route.toolUpdates
  const declarable = (tool: ToolEntry) => encoding?.declarable?.(tool) ?? true
  const firstTurn = request.messages.findIndex((message) => message.role !== "system")
  const steps = changes.reduce<{
    readonly tools: ReadonlyArray<ToolEntry>
    readonly declared: ReadonlySet<string>
    readonly steps: ReadonlyArray<PlanStep>
  }>(
    (state, change) => {
      const added = change.add.map((tool) => tool.name)
      const removed = change.remove.filter(
        (path) => !added.includes(path.split(".")[0]!) && entriesAt(state.tools, path).length > 0,
      )
      const tools = foldTools(state.tools, change.add, change.remove)
      const kinds = [
        ...(removed.length > 0 || withdrawnTools(state.tools, tools).length > 0 ? ["remove" as const] : []),
        ...added.map((name) => (state.declared.has(name) ? ("replace" as const) : ("add" as const))),
      ]
      const native =
        firstTurn !== -1 &&
        change.index > firstTurn &&
        kinds.every((kind) => supported.includes(kind)) &&
        [...change.add, ...removed.flatMap((path) => entriesAt(state.tools, path))].every(declarable) &&
        (encoding?.placeable?.(request, change.index) ?? true)
      const step = {
        index: change.index,
        native,
        tools,
        changes: { add: change.add, remove: removed },
      }
      return { tools, declared: new Set([...state.declared, ...added]), steps: [...state.steps, step] }
    },
    { tools: request.tools, declared: new Set(request.tools.map((tool) => tool.name)), steps: [] },
  ).steps
  const cut = steps.findLastIndex((step) => !step.native)
  const kept = new Map(steps.slice(cut + 1).map((step) => [step.index, step.changes]))
  return {
    ...request,
    tools: cut === -1 ? request.tools : steps[cut]!.tools,
    messages: request.messages.flatMap((message, index) => {
      if (message.role !== "system" || message.tools === undefined) return [message]
      const tools = kept.get(index)
      if (tools !== undefined && (tools.add.length > 0 || tools.remove.length > 0))
        return [new SystemMessage({ ...message, tools })]
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

/** Paths of the tools in `before` that `after` no longer has, including tools a redefined namespace drops. */
export const withdrawnTools = (before: ReadonlyArray<ToolEntry>, after: ReadonlyArray<ToolEntry>) => {
  const kept = new Set(toolLeaves(after).map((leaf) => leaf.path.join(".")))
  return toolLeaves(before)
    .map((leaf) => leaf.path.join("."))
    .filter((path) => !kept.has(path))
}

/** Every tool definition in `tools`, with the namespace path that leads to it and its own name last. */
export const toolLeaves = (
  tools: ReadonlyArray<ToolEntry>,
  path: ReadonlyArray<string> = [],
): ReadonlyArray<{ readonly path: ReadonlyArray<string>; readonly definition: ToolDefinition }> =>
  tools.flatMap((tool) =>
    tool.type === "namespace"
      ? toolLeaves(tool.tools, [...path, tool.name])
      : [{ path: [...path, tool.name], definition: tool }],
  )

// The tools a path names: a top-level tool or namespace, or one inside a namespace.
const entriesAt = (tools: ReadonlyArray<ToolEntry>, path: string): ReadonlyArray<ToolEntry> => {
  const dot = path.indexOf(".")
  if (dot === -1) return tools.filter((tool) => tool.name === path)
  return tools.flatMap((tool) =>
    tool.type === "namespace" && tool.name === path.slice(0, dot) ? entriesAt(tool.tools, path.slice(dot + 1)) : [],
  )
}

const removePaths = <Item extends FoldableTool>(tools: ReadonlyArray<Item>, paths: ReadonlyArray<string>) =>
  paths.length === 0
    ? tools
    : tools.flatMap((tool): ReadonlyArray<Item> => {
        if (paths.includes(tool.name)) return []
        const inner = paths.flatMap((path) =>
          path.startsWith(`${tool.name}.`) ? [path.slice(tool.name.length + 1)] : [],
        )
        if (inner.length === 0 || tool.type !== "namespace" || tool.tools === undefined) return [tool]
        const members = removePaths(tool.tools, inner)
        // A namespace whose last member is removed goes too, as if removed by its own path.
        return members.length === 0 ? [] : [{ ...tool, tools: members }]
      })

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
        ? new SystemMessage({ ...message, tools: { ...message.tools, add: f(message.tools.add) } })
        : message,
    ),
  }
}
