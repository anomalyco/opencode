import { describe, expect, test } from "bun:test"
import { LanguageModel, ToolDefinition } from "@opencode/ai/effect"
import { AnthropicMessages } from "@opencode/ai/protocols"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { DateTime } from "effect"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionToolChanges } from "@opencode/core/session/tool-changes"
import type { Tool } from "@opencode/schema/tool"

const ref = Model.Ref.make({ providerID: Provider.ID.make("anthropic"), id: Model.ID.make("claude") })
const tracked = {
  ref,
  model: LanguageModel.make({
    id: "claude",
    provider: "anthropic",
    route: AnthropicMessages.route,
    capabilities: { tools: { updates: ["add", "remove", "replace"] } },
  }),
}
const untracked = { ref, model: LanguageModel.make({ id: "claude", provider: "anthropic", route: OpenAIChat.route }) }

const tool = (name: string, description = `The ${name} tool`, properties: Record<string, unknown> = {}) =>
  ToolDefinition.make({ name, description, inputSchema: { type: "object", properties } })
const stored = (tool: ToolDefinition): Tool.Definition => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
})

let seq = 0
const marker = (tools: SessionMessage.System["tools"]) =>
  SessionMessage.System.make({
    id: SessionMessage.ID.make(`msg_tools_${seq++}`),
    type: "system",
    text: "",
    tools,
    time: { created: DateTime.makeUnsafe(0) },
  })
const user = (text: string) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.make(`msg_user_${seq++}`),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(0) },
  })
const baseline = (tools: ReadonlyArray<ToolDefinition>, model: Model.Ref = ref) =>
  marker({ add: tools.map(stored), remove: [], model: { providerID: model.providerID, id: model.id } })

const changeFrom = (history: ReadonlyArray<SessionMessage.Info>, offered: ReadonlyArray<ToolDefinition>) =>
  SessionToolChanges.plan({ model: tracked, epoch: SessionToolChanges.epoch(history, tracked), offered }).record

describe("SessionToolChanges", () => {
  const [read, edit, write] = [tool("read"), tool("edit"), tool("write")]
  const history = [baseline([read, edit]), user("Go")]

  test("starts an epoch from the offered tools, without the variant", () => {
    const plan = SessionToolChanges.plan({
      model: { ...tracked, ref: Model.Ref.make({ ...ref, variant: Model.VariantID.make("high") }) },
      epoch: undefined,
      offered: [read, edit],
    })
    expect(plan.tools).toEqual([read, edit])
    expect(plan.marker).toBeUndefined()
    expect(plan.record).toEqual({ add: [stored(read), stored(edit)], remove: [], model: ref })
  })

  test("records nothing when the tools are unchanged, even reordered", () => {
    expect(changeFrom(history, [read, edit])).toBeUndefined()
    expect(changeFrom(history, [edit, read])).toBeUndefined()
    expect(changeFrom(history, [read, tool("edit", "The edit tool", {})])).toBeUndefined()
  })

  test("ignores a changed output schema, which is never sent", () => {
    const withOutput = ToolDefinition.make({ ...edit, outputSchema: { type: "object", properties: { ok: {} } } })
    expect(changeFrom(history, [read, withOutput])).toBeUndefined()
  })

  test("diffs additions, removals and redefinitions by name", () => {
    expect(changeFrom(history, [read, edit, write])).toEqual({ add: [stored(write)], remove: [] })
    expect(changeFrom(history, [read])).toEqual({ add: [], remove: ["edit"] })
    const edit2 = tool("edit", "Edit, version 2", { path: { type: "string" } })
    expect(changeFrom(history, [read, edit2])).toEqual({ add: [stored(edit2)], remove: [] })
  })

  test("compares against the folded changes, so a removed tool added again is an addition", () => {
    const removed = [...history, marker({ add: [], remove: ["edit"] })]
    const epoch = SessionToolChanges.epoch(removed, tracked)
    expect(epoch?.baseline).toEqual([stored(read), stored(edit)])
    expect(epoch?.current).toEqual([stored(read)])
    expect(changeFrom(removed, [read])).toBeUndefined()
    expect(changeFrom(removed, [read, edit])).toEqual({ add: [stored(edit)], remove: [] })
  })

  test("declares the baseline and appends the change as a marker", () => {
    const plan = SessionToolChanges.plan({
      model: tracked,
      epoch: SessionToolChanges.epoch(history, tracked),
      offered: [read, write],
    })
    expect(plan.tools.map((item) => item.name)).toEqual(["read", "edit"])
    expect(plan.marker?.tools).toEqual({ add: [write], remove: ["edit"] })
  })

  test("replays changes after the latest baseline only", () => {
    const messages = [
      baseline([read]),
      marker({ add: [stored(edit)], remove: [] }),
      user("Compacted"),
      baseline([read, edit]),
      user("Go"),
      marker({ add: [stored(write)], remove: ["read"] }),
    ]
    const epoch = SessionToolChanges.epoch(messages, tracked)
    expect(epoch?.start).toBe(3)
    expect(epoch?.current).toEqual([stored(edit), stored(write)])
    const replayed = messages.map((message, index) => SessionToolChanges.replay(message, index, epoch))
    expect(replayed.map((message) => message?.tools)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { add: [write], remove: ["read"] },
    ])
    // The same history replays the same marker every time.
    expect(SessionToolChanges.replay(messages[5]!, 5, epoch)).toEqual(replayed[5])
  })

  test("ends the epoch when the latest baseline is for another model", () => {
    const other = Model.Ref.make({ providerID: Provider.ID.make("anthropic"), id: Model.ID.make("other") })
    expect(SessionToolChanges.epoch([baseline([read], other), user("Go")], tracked)).toBeUndefined()
    expect(SessionToolChanges.epoch([baseline([read]), user("Go"), baseline([read], other)], tracked)).toBeUndefined()
  })

  test("leaves models without tool updates alone", () => {
    expect(SessionToolChanges.tracked(untracked.model)).toBe(false)
    expect(SessionToolChanges.epoch(history, untracked)).toBeUndefined()
    const plan = SessionToolChanges.plan({ model: untracked, epoch: undefined, offered: [edit, read] })
    expect(plan).toEqual({ tools: [edit, read] })
    // A capability the route can't encode doesn't count either.
    const chat = LanguageModel.make({
      id: "claude",
      provider: "anthropic",
      route: OpenAIChat.route,
      capabilities: { tools: { updates: ["add"] } },
    })
    expect(SessionToolChanges.tracked(chat)).toBe(false)
  })
})
