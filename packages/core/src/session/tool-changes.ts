export * as SessionToolChanges from "./tool-changes.js"

import { type LanguageModel, Message, type SystemMessage, ToolDefinition } from "@opencode/ai/effect"
import type { Model } from "@opencode/schema/model"
import type { Tool } from "@opencode/schema/tool"
import { canonicalJson } from "../util/canonical-json.js"
import type { SessionMessage } from "./message.js"

// Changing a request's top-level tools invalidates the provider's prompt cache. On models that take tool changes in
// place, each epoch declares the tools it started with at the top of every request, and the history replays each
// later change where it was recorded. Both are hidden system messages, so the epoch follows the history: a compaction
// leaves its baseline behind (provider checkpoints don't keep tools added later), a revert or fork keeps only the
// changes before its point, and a baseline shaped for another provider or model ends it. Variants share the epoch.

export interface Epoch {
  /** The baseline's index in the history; changes before it belong to an earlier epoch. */
  readonly start: number
  /** Declared at the top of every request in the epoch. */
  readonly baseline: ReadonlyArray<Tool.Definition>
  /** The tools after the latest recorded change. */
  readonly current: ReadonlyArray<Tool.Definition>
}

/** What a request declares, and the change a durable step records before sending it. */
export interface Plan {
  readonly tools: ReadonlyArray<ToolDefinition>
  /** Appended after the history: the change from the epoch's current tools to the offered ones. */
  readonly marker?: SystemMessage
  readonly record?: Tool.Changes & { readonly model?: Model.Ref }
}

/** Whether the model takes some tool change in place on its route. Other models never record or replay changes. */
export const tracked = (model: LanguageModel) => {
  const kinds = model.route.toolUpdates?.kinds ?? []
  return (model.capabilities?.tools?.updates ?? []).some((kind) => kinds.includes(kind))
}

/** The epoch the history continues on `model`, or undefined when the next step starts one. */
export const epoch = (
  messages: ReadonlyArray<SessionMessage.Info>,
  model: { readonly ref: Model.Ref; readonly model: LanguageModel },
): Epoch | undefined => {
  if (!tracked(model.model)) return undefined
  const start = messages.findLastIndex((message) => message.type === "system" && message.tools?.model !== undefined)
  const baseline = changes(messages[start])
  if (baseline?.model?.providerID !== model.ref.providerID || baseline.model.id !== model.ref.id) return undefined
  return {
    start,
    baseline: baseline.add,
    current: messages.slice(start + 1).reduce((tools, message) => fold(tools, changes(message)), baseline.add),
  }
}

/** The marker a recorded change replays as. Changes outside the epoch replay as nothing. */
export const replay = (message: SessionMessage.Info, index: number, epoch: Epoch | undefined) => {
  const recorded = changes(message)
  if (recorded === undefined || epoch === undefined || index <= epoch.start) return undefined
  return marker(recorded)
}

/** Compares the offered tools with the epoch's and decides what the request declares. */
export const plan = (input: {
  readonly model: { readonly ref: Model.Ref; readonly model: LanguageModel }
  readonly epoch: Epoch | undefined
  readonly offered: ReadonlyArray<ToolDefinition>
}): Plan => {
  if (!tracked(input.model.model)) return { tools: input.offered }
  const offered = input.offered.map(definition)
  if (input.epoch === undefined)
    return {
      tools: input.offered,
      record: {
        add: offered,
        remove: [],
        model: { providerID: input.model.ref.providerID, id: input.model.ref.id },
      },
    }
  const current = new Map(input.epoch.current.map((tool) => [tool.name, key(tool)]))
  const names = new Set(offered.map((tool) => tool.name))
  const change = {
    add: offered.filter((tool) => current.get(tool.name) !== key(tool)),
    remove: input.epoch.current.flatMap((tool) => (names.has(tool.name) ? [] : [tool.name])),
  }
  const tools = input.epoch.baseline.map(ToolDefinition.make)
  if (change.add.length === 0 && change.remove.length === 0) return { tools }
  return {
    tools,
    marker: marker(change),
    record: change,
  }
}

// The one place a change becomes a request message, so the step that records it and every later replay send the
// same bytes. No message ID, since the recording step has none yet.
const marker = (change: Tool.Changes) =>
  Message.make(Message.tools({ add: change.add.map(ToolDefinition.make), remove: change.remove }))

const changes = (message: SessionMessage.Info | undefined) => (message?.type === "system" ? message.tools : undefined)

/** Removals first, then additions replace a same-named tool in place or append, as the AI package folds them. */
const fold = (tools: ReadonlyArray<Tool.Definition>, change: Tool.Changes | undefined) => {
  if (change === undefined) return tools
  const added = new Map(change.add.map((tool) => [tool.name, tool]))
  const kept = tools.filter((tool) => !change.remove.includes(tool.name)).map((tool) => added.get(tool.name) ?? tool)
  const names = new Set(kept.map((tool) => tool.name))
  return [...kept, ...change.add.filter((tool) => !names.has(tool.name))]
}

// What the provider sees of a tool. An output schema is never sent, so changing one isn't a tool change.
const definition = (tool: ToolDefinition): Tool.Definition => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  ...(tool.freeform === undefined ? {} : { freeform: tool.freeform }),
  ...(tool.native === undefined ? {} : { native: tool.native }),
})

// Key order inside a schema can differ between equal tools, so they compare by canonical JSON.
const key = (tool: Tool.Definition) => canonicalJson(JSON.parse(JSON.stringify(tool)))
