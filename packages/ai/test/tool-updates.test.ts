import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import {
  ai,
  LLMEvent,
  Message,
  tool,
  ToolCallPart,
  ToolDefinition,
  ToolNamespace,
  type LLMRequest,
} from "../src/effect.js"
import { AI } from "../src/index.js"
import { Gemini } from "../src/protocols/gemini.js"
import { TestLLM } from "../src/testing.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { AnthropicMessages } from "../src/protocols/anthropic-messages.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { OpenAIResponses } from "../src/protocols/openai-responses.js"
import { gatewayProtocol } from "../src/protocols/utils/gateway-protocol.js"
import { GoogleVertexMessages, OpenAI } from "../src/providers.js"
import { planToolUpdates, type ToolUpdate } from "../src/tool-updates.js"
import { it, testEffect } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"

const defineTool = (name: string, description = `${name} tool`) =>
  ToolDefinition.make({ name, description, inputSchema: { type: "object" } })

const read = defineTool("read")
const edit = defineTool("edit")
const write = defineTool("write")
const jira = defineTool("jira")
const lookup = tool({
  name: "lookup",
  description: "Look something up.",
  input: Schema.Struct({ query: Schema.String }),
  success: Schema.String,
  execute: ({ query }) => Effect.succeed(`found ${query}`),
})

const ALL: ReadonlyArray<ToolUpdate> = ["add", "remove", "replace"]
const updates = (list: ReadonlyArray<ToolUpdate>) => ({ tools: { updates: list } })

const anthropic = (id: string, list?: ReadonlyArray<ToolUpdate>) =>
  AnthropicMessages.route
    .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
    .model({ id, capabilities: list === undefined ? undefined : updates(list) })

const openai = (id: string, list?: ReadonlyArray<ToolUpdate>) =>
  OpenAIResponses.route
    .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
    .model({ id, capabilities: list === undefined ? undefined : updates(list) })

const chat = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4.1-mini", capabilities: updates(ALL) })

const gemini = Gemini.route
  .with({
    endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
    auth: Auth.header("x-goog-api-key", "test"),
  })
  .model({ id: "gemini-3.5-flash", capabilities: updates(ALL) })

const opus5 = anthropic("claude-opus-5", ALL)
const astra = openai("gpt-6-astra", ALL)

const swap = Message.tools({ add: [write], remove: ["edit"] })
const conversation = [Message.user("Fix it."), Message.assistant("Done."), swap, Message.user("Next.")]
const folded = [Message.user("Fix it."), Message.assistant("Done."), Message.user("Next.")]

const names = (request: LLMRequest) => request.tools.map((entry) => entry.name)
const markers = (request: LLMRequest) =>
  request.messages.flatMap((message) =>
    message.role === "system" && message.tools ? [{ add: message.tools.add, remove: message.tools.remove }] : [],
  )
const changes = (add: ReadonlyArray<ToolDefinition>, remove: ReadonlyArray<string> = []) => ({ add, remove })

describe("Message.tools", () => {
  test("builds an empty system message whose tools field round-trips through the schema", () => {
    const message = Message.make(
      Message.tools({ add: [{ name: "write", description: "write tool", inputSchema: { type: "object" } }] }),
    )

    expect(message.role).toBe("system")
    expect(message.content).toEqual([])
    expect(message.tools).toEqual({ add: [write], remove: [] })
    const decoded = Schema.decodeUnknownSync(Message)(Schema.encodeSync(Message)(message))
    expect(decoded.role === "system" && decoded.tools).toEqual({ add: [write], remove: [] })
    expect(decoded.role === "system" && decoded.tools?.add[0]).toBeInstanceOf(ToolDefinition)
  })

  test("stores definitions for tool objects and names for removals", () => {
    const message = Message.make(Message.tools({ add: [lookup], remove: [lookup, read, "edit"] }))

    expect(message.tools).toEqual({ add: [lookup._definition], remove: ["lookup", "read", "edit"] })
    expect(Message.make(Message.system("Note.")).tools).toBeUndefined()
  })
})

describe("planToolUpdates", () => {
  test("folds every marker in history order on a route without in-place changes", () => {
    const result = planToolUpdates(
      ai.request({
        model: chat,
        tools: [read, edit, lookup],
        messages: [
          Message.user("One."),
          Message.tools({ add: [write, defineTool("edit", "edit v2")] }),
          Message.user("Two."),
          Message.tools({ remove: [lookup, "read"] }),
          { role: "system", content: "Tools changed.", tools: { add: [defineTool("read", "read v2")] } },
        ],
      }),
    )

    expect(result.tools).toEqual([defineTool("edit", "edit v2"), write, defineTool("read", "read v2")])
    expect(result.messages).toEqual([Message.user("One."), Message.user("Two."), Message.system("Tools changed.")])
  })

  test("keeps the request identity without markers", () => {
    const plain = ai.request({ model: opus5, tools: [read], prompt: "hi" })
    expect(planToolUpdates(plain)).toBe(plain)
  })

  const plan = (list: ReadonlyArray<ToolUpdate> | undefined, messages: ReadonlyArray<Message | Message.Input>) =>
    planToolUpdates(ai.request({ model: anthropic("claude-opus-5", list), tools: [read, edit], messages }))
  const history = [
    Message.user("One."),
    Message.tools({ add: [jira] }),
    Message.user("Two."),
    Message.tools({ remove: ["edit"] }),
    Message.user("Three."),
    Message.tools({ add: [write] }),
    Message.user("Four."),
    Message.tools({ add: [defineTool("read", "read v2")] }),
  ]

  test.each([
    ["unset", undefined, ["read", "jira", "write"], []],
    ["empty", [], ["read", "jira", "write"], []],
    ["add", ["add"], ["read", "jira", "write"], []],
    ["add + remove", ["add", "remove"], ["read", "jira", "write"], []],
    [
      "add + replace",
      ["add", "replace"],
      ["read", "jira"],
      [changes([write]), changes([defineTool("read", "read v2")])],
    ],
    ["remove + replace", ["remove", "replace"], ["read", "jira", "write"], [changes([defineTool("read", "read v2")])]],
    [
      "all",
      ALL,
      ["read", "edit"],
      [changes([jira]), changes([], ["edit"]), changes([write]), changes([defineTool("read", "read v2")])],
    ],
  ] as const)("with updates %s, folds up to the last marker the model can't take in place", (_, list, tools, kept) => {
    const result = plan(list, history)
    expect(names(result)).toEqual([...tools])
    expect(markers(result)).toEqual([...kept])
  })

  test("keeps additions after the last removal in place when only additions are supported", () => {
    const result = plan(["add"], history.slice(0, 6))
    expect(names(result)).toEqual(["read", "jira"])
    expect(markers(result)).toEqual([changes([write])])
  })

  test("counts adding a tool removed earlier as a replacement", () => {
    const result = plan(
      ["add", "remove"],
      [Message.user("One."), Message.tools({ remove: ["edit"] }), Message.user("Two."), Message.tools({ add: [edit] })],
    )
    expect(names(result)).toEqual(["read", "edit"])
    expect(markers(result)).toEqual([])
  })

  test("treats removing and adding the same name in one marker as a replacement", () => {
    const v2 = defineTool("edit", "edit v2")
    const messages = [Message.user("One."), Message.tools({ add: [v2], remove: ["edit"] })]
    expect(markers(plan(["replace"], messages))).toEqual([changes([v2])])
    expect(markers(plan(["remove"], messages))).toEqual([])
  })

  test("drops removals of unknown names and markers that change nothing", () => {
    const result = plan(ALL, [
      Message.user("One."),
      Message.tools({ remove: ["ghost", "edit"] }),
      Message.tools({ remove: ["ghost"] }),
      Message.tools({}),
    ])
    expect(names(result)).toEqual(["read", "edit"])
    expect(result.messages.map((message) => message.role)).toEqual(["user", "system"])
    expect(markers(result)).toEqual([changes([], ["edit"])])
  })

  test("folds markers before the conversation starts into the leading declaration", () => {
    const result = plan(ALL, [Message.tools({ add: [jira], remove: ["read"] }), Message.user("One.")])
    expect(names(result)).toEqual(["edit", "jira"])
    expect(result.messages).toEqual([Message.user("One.")])
  })

  test("counts redefining a namespace without some of its tools as a removal", () => {
    const namespace = (...tools: ReadonlyArray<ToolDefinition>) => ToolNamespace.make({ name: "jira", tools })
    const request = (list: ReadonlyArray<ToolUpdate>) =>
      planToolUpdates(
        ai.request({
          model: anthropic("claude-opus-5", list),
          tools: [namespace(read, edit)],
          messages: [Message.user("One."), Message.tools({ add: [namespace(read)] })],
        }),
      )
    expect(markers(request(["add", "replace"]))).toEqual([])
    expect(markers(request(ALL))).toHaveLength(1)
  })
})

describe("leading declaration", () => {
  const routes = [
    ["OpenAI Chat", chat],
    ["Gemini", gemini],
    ["Anthropic without updates", anthropic("claude-opus-5")],
    ["Anthropic", opus5],
    ["OpenAI Responses without updates", openai("gpt-6-astra")],
    ["OpenAI Responses", astra],
  ] as const

  it.effect("top-level tools compile the same as a Message.tools marker that leads the history", () =>
    Effect.gen(function* () {
      for (const [, model] of routes) {
        const direct = yield* compileRequest(
          ai.request({ model, tools: [read, edit], messages: conversation, cache: "none" }),
        )
        const leading = yield* compileRequest(
          ai.request({ model, messages: [Message.tools({ add: [read, edit] }), ...conversation], cache: "none" }),
        )
        expect(leading.body).toEqual(direct.body)
      }
    }),
  )

  it.effect("folding every marker matches listing the final tools up front, with no empty system message", () =>
    Effect.gen(function* () {
      for (const model of [chat, gemini, anthropic("claude-opus-5"), openai("gpt-6-astra")]) {
        const withMarkers = yield* compileRequest(
          ai.request({ model, tools: [read, edit], messages: conversation, cache: "none" }),
        )
        const withoutMarkers = yield* compileRequest(
          ai.request({ model, tools: [read, write], messages: folded, cache: "none" }),
        )
        expect(withMarkers.body).toEqual(withoutMarkers.body)
      }
    }),
  )

  it.effect("tool objects send the same definition from top-level tools and Message.tools", () =>
    Effect.gen(function* () {
      const added = yield* compileRequest(
        ai.request({ model: chat, tools: [read], messages: [Message.user("Go."), Message.tools({ add: [lookup] })] }),
      )
      const direct = yield* compileRequest(ai.request({ model: chat, tools: [read, lookup], prompt: "Go." }))

      expect(added.body).toEqual(direct.body)
    }),
  )
})

describe("ai.loop", () => {
  const loopIt = testEffect(TestLLM.testLayer())

  loopIt.effect("runs an executable tool added mid-conversation and not one removed later", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.toolCalls(
          LLMEvent.toolCall({ id: "call-1", name: "lookup", input: { query: "weather" } }),
          LLMEvent.toolCall({ id: "call-2", name: "remove_me", input: {} }),
        ),
        TestLLM.text("Done.", "text-1"),
      )
      const removeMe = AI.tool({
        name: "remove_me",
        description: "Removed before the model calls it.",
        input: Schema.Struct({}),
        execute: () => "ran",
      })

      const events = yield* ai
        .loop({
          model: chat,
          tools: [removeMe],
          messages: [Message.user("Look it up."), Message.tools({ add: [lookup], remove: [removeMe] })],
        })
        .pipe(Stream.runCollect)
      const requests = yield* client.requests()

      expect(requests[0].tools.map((entry) => entry.name)).toEqual(["remove_me"])
      expect(requests[0].messages[1]).toEqual(Message.make(Message.tools({ add: [lookup], remove: ["remove_me"] })))
      expect(Array.from(events).filter(LLMEvent.is.toolResult)).toEqual([
        expect.objectContaining({ id: "call-1", result: { type: "text", value: "found weather" } }),
        expect.objectContaining({ id: "call-2", result: expect.objectContaining({ type: "error" }) }),
      ])
    }),
  )
})

describe("protocol wrappers", () => {
  test("forward the tool update encoding", () => {
    const wrapped = gatewayProtocol(AnthropicMessages.protocol, {
      id: "gateway-anthropic",
      prepare: (request) => Effect.succeed({ request, body: {} }),
    })
    expect(wrapped.toolUpdates).toBe(AnthropicMessages.protocol.toolUpdates)

    const vertex = GoogleVertexMessages.configure({ accessToken: "test", location: "global", project: "test" })
    expect(vertex.model("claude-opus-5").route.toolUpdates).toBe(AnthropicMessages.protocol.toolUpdates)
  })
})

describe("cache policy", () => {
  it.effect("walks the tail breakpoint back past a trailing tools marker", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [read, edit],
          messages: [Message.user("first"), Message.assistant("reply"), Message.user("latest"), swap],
          cache: { messages: { tail: 1 } },
        }),
      )

      expect(prepared.body.messages.at(-2)).toEqual({
        role: "user",
        content: [{ type: "text", text: "latest", cache_control: { type: "ephemeral" } }],
      })
      expect(prepared.body.messages.at(-1)?.role).toBe("system")
    }),
  )
})

describe("Anthropic Messages tool updates", () => {
  const definition = (value: ToolDefinition) => ({
    type: "tool_addition",
    tool: {
      type: "tool_definition",
      definition: { name: value.name, description: value.description, input_schema: value.inputSchema },
    },
  })
  const removal = (name: string) => ({ type: "tool_removal", tool: { type: "tool_reference", name } })

  it.effect("lowers markers to native system messages and keeps the top-level tools", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({ model: opus5, tools: [read, edit], messages: conversation, cache: "none" }),
      )
      const plain = yield* compileRequest(
        ai.request({ model: opus5, tools: [read, write], prompt: "x", cache: "none" }),
      )

      expect(prepared.body.tools?.map((entry) => entry.name)).toEqual(["read", "edit"])
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Fix it." }] },
        { role: "assistant", content: [{ type: "text", text: "Done." }] },
        { role: "user", content: [{ type: "text", text: "Next." }] },
        { role: "system", content: [definition(write), removal("edit")] },
      ])
      const addition = prepared.body.messages[3]?.content[0]
      expect(addition?.type === "tool_addition" && addition.tool.definition).toEqual(plain.body.tools?.[1])
    }),
  )

  it.effect("redefines a tool with a same-name addition and re-adds a removed one", () =>
    Effect.gen(function* () {
      const v2 = defineTool("edit", "edit v2")
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [read, edit],
          messages: [
            Message.user("One."),
            Message.tools({ add: [v2] }),
            Message.user("Two."),
            Message.tools({ remove: ["read"] }),
            Message.user("Three."),
            Message.tools({ add: [read] }),
          ],
          cache: "none",
        }),
      )

      expect(prepared.body.tools?.map((entry) => entry.name)).toEqual(["read", "edit"])
      expect(prepared.body.messages.filter((message) => message.role === "system")).toEqual([
        { role: "system", content: [definition(v2)] },
        { role: "system", content: [removal("read")] },
        { role: "system", content: [definition(read)] },
      ])
    }),
  )

  it.effect("removes the tools a redefined namespace leaves out", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [ToolNamespace.make({ name: "jira", tools: [read, edit] })],
          messages: [
            Message.user("One."),
            Message.tools({ add: [ToolNamespace.make({ name: "jira", tools: [read] })] }),
          ],
          cache: "none",
        }),
      )

      expect(prepared.body.messages.at(-1)).toEqual({
        role: "system",
        content: [definition(defineTool("jira_read", "read tool")), removal("jira_edit")],
      })
    }),
  )

  it.effect("adds tools in place with no top-level tools and keeps tool_choice", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          messages: [Message.user("Go."), Message.tools({ add: [jira] })],
          toolChoice: { type: "tool", name: "jira" },
          cache: "none",
        }),
      )

      expect(prepared.body.tools).toBeUndefined()
      expect(prepared.body.tool_choice).toEqual({ type: "tool", name: "jira" })
      expect(prepared.body.messages.at(-1)).toEqual({ role: "system", content: [definition(jira)] })
    }),
  )

  it.effect("folds markers that no user message or tool result would precede, keeping later ones in place", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [read, edit],
          messages: [
            Message.user("Fix it."),
            Message.assistant("Done."),
            swap,
            Message.assistant("More."),
            Message.user("Next."),
            Message.tools({ add: [jira] }),
          ],
          cache: "none",
        }),
      )

      expect(prepared.body.tools?.map((entry) => entry.name)).toEqual(["read", "write"])
      expect(prepared.body.messages.at(-1)).toEqual({ role: "system", content: [definition(jira)] })
      expect(prepared.body.messages.filter((message) => message.role === "system")).toHaveLength(1)
    }),
  )

  it.effect("sends several removals as blocks in one message and nothing for unknown names", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [read, edit, write],
          messages: [Message.user("Go."), Message.tools({ remove: ["read", "ghost", "write"] })],
          cache: "none",
        }),
      )
      const unknown = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [read],
          messages: [Message.user("Go."), Message.tools({ remove: ["ghost"] })],
          cache: "none",
        }),
      )

      expect(prepared.body.messages.at(-1)).toEqual({ role: "system", content: [removal("read"), removal("write")] })
      expect(unknown.body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Go." }] }])
    }),
  )

  it.effect("moves a marker between a tool call and its result after the result", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [read, edit],
          messages: [
            Message.user("Read it."),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "read", input: {} })]),
            Message.tools({ add: [write] }),
            Message.tool({ id: "call_1", name: "read", result: { ok: true } }),
          ],
          cache: "none",
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Read it." }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"ok":true}' }] },
        { role: "system", content: [definition(write)] },
      ])
    }),
  )

  it.effect("requests the inline tools beta only when markers are sent", () =>
    Effect.gen(function* () {
      for (const [messages, expected] of [
        [conversation, true],
        [folded, false],
      ] as const) {
        const request = ai.request({ model: opus5, tools: [read, edit], messages })
        const compiled = yield* compileRequest(request)
        const prepared = yield* AnthropicMessages.route.prepareTransport(compiled.body, request)
        expect(prepared.request.headers["anthropic-beta"]!.split(",").includes("inline-tools-2026-09-15")).toBe(
          expected,
        )
      }
    }),
  )

  it.effect("folds markers when the model lacks updates or system updates", () =>
    Effect.gen(function* () {
      for (const model of [anthropic("claude-opus-5"), anthropic("claude-opus-4-5", ALL)]) {
        const prepared = yield* compileRequest(
          ai.request({ model, tools: [read, edit], messages: conversation, cache: "none" }),
        )

        expect(prepared.body.messages.some((message) => message.role === "system")).toBe(false)
        expect(prepared.body.tools?.map((entry) => entry.name)).toEqual(["read", "write"])
      }
    }),
  )
})

describe("OpenAI Responses tool updates", () => {
  const additional = (body: OpenAIResponses.OpenAIResponsesBody) =>
    body.input.flatMap((item) =>
      "type" in item && item.type === "additional_tools"
        ? [item.tools.map((entry) => ("description" in entry ? `${entry.name}: ${entry.description}` : entry.type))]
        : [],
    )
  const topLevel = (body: OpenAIResponses.OpenAIResponsesBody) =>
    body.tools?.map((entry) => ("name" in entry ? entry.name : entry.type))
  // One line per input item: declared tools, developer text, or the item type.
  const trace = (body: OpenAIResponses.OpenAIResponsesBody) =>
    body.input.map((item) => {
      if ("type" in item && item.type === "additional_tools")
        return `tools: ${item.tools.map((entry) => ("name" in entry ? entry.name : entry.type)).join(", ")}`
      if ("role" in item && item.role === "developer" && typeof item.content === "string") return item.content
      return "role" in item ? item.role : item.type
    })
  const hint = (...unavailable: ReadonlyArray<string>) =>
    [
      "Tool update: the tools below are added to the ones you already have. Earlier tools stay available unless marked unavailable, and a tool declared again replaces its earlier definition.",
      ...(unavailable.length === 0 ? [] : [`Still unavailable: ${unavailable.join(", ")}.`]),
    ].join("\n")

  it.effect("declares every tool in a leading additional_tools item and leaves top-level tools out", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(ai.request({ model: astra, tools: [read, edit], prompt: "Go." }))
      const plain = yield* compileRequest(
        ai.request({ model: openai("gpt-6-astra"), tools: [read, edit], prompt: "Go." }),
      )

      expect(prepared.body.tools).toBeUndefined()
      expect(prepared.body.input).toEqual([
        { type: "additional_tools", role: "developer", tools: plain.body.tools },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Go." }] },
      ])
      expect(additional(plain.body)).toEqual([])
    }),
  )

  it.effect("adds and redefines tools with later items, each after an incremental hint", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          tools: [read, edit],
          messages: [
            Message.user("Fix it."),
            Message.tools({ add: [write] }),
            Message.user("Next."),
            Message.tools({ add: [defineTool("edit", "edit v2")] }),
          ],
        }),
      )

      expect(prepared.body.tools).toBeUndefined()
      expect(additional(prepared.body)).toEqual([
        ["read: read tool", "edit: edit tool"],
        ["write: write tool"],
        ["edit: edit v2"],
      ])
      expect(trace(prepared.body)).toEqual([
        "tools: read, edit",
        "user",
        hint(),
        "tools: write",
        "user",
        hint(),
        "tools: edit",
      ])
    }),
  )

  it.effect("sends the first item without a hint when no tools lead the request", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          messages: [
            Message.user("Go."),
            Message.tools({ add: [jira] }),
            Message.user("More."),
            Message.tools({ add: [write] }),
          ],
        }),
      )

      expect(trace(prepared.body)).toEqual(["user", "tools: jira", "user", hint(), "tools: write"])
    }),
  )

  it.effect("announces removals, lists them in later hints until re-added, and keeps them declared", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          tools: [read, edit, write],
          messages: [
            Message.user("One."),
            Message.tools({ remove: ["edit", "write"] }),
            Message.user("Two."),
            Message.tools({ add: [jira] }),
            Message.user("Three."),
            Message.tools({ add: [edit] }),
          ],
        }),
      )

      expect(trace(prepared.body)).toEqual([
        "tools: read, edit, write",
        "user",
        "These tools are no longer available. Do not call them: edit, write.",
        "user",
        hint("edit", "write"),
        "tools: jira",
        "user",
        hint("write"),
        "tools: edit",
      ])
    }),
  )

  it.effect("sends a redefinition and a removal in one marker as an item and an announcement", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          tools: [read, edit],
          messages: [Message.user("One."), Message.tools({ add: [defineTool("read", "read v2")], remove: ["edit"] })],
        }),
      )

      expect(trace(prepared.body)).toEqual([
        "tools: read, edit",
        "user",
        hint(),
        "tools: read",
        "These tools are no longer available. Do not call them: edit.",
      ])
    }),
  )

  it.effect("folds removals when the model doesn't list remove", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: openai("gpt-6-astra", ["add", "replace"]),
          tools: [read, edit],
          messages: [...conversation, Message.tools({ add: [jira] })],
        }),
      )

      expect(trace(prepared.body)).toEqual(["tools: read, write", "user", "assistant", "user", hint(), "tools: jira"])
    }),
  )

  it.effect("folds redefinitions when the model lists replace without add", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: openai("gpt-6-astra", ["replace"]),
          tools: [read, edit],
          messages: [Message.user("Go."), Message.tools({ add: [defineTool("edit", "edit v2")] })],
        }),
      )

      expect(additional(prepared.body)).toEqual([])
      expect(prepared.body.tools?.map((entry) => ("description" in entry ? entry.description : entry.type))).toEqual([
        "read tool",
        "edit v2",
      ])
    }),
  )

  it.effect("folds redefinitions when the model only lists add", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: openai("gpt-6-astra", ["add"]),
          tools: [read, edit],
          messages: [Message.user("Go."), Message.tools({ add: [defineTool("edit", "edit v2"), jira] })],
        }),
      )

      expect(additional(prepared.body)).toEqual([["read: read tool", "edit: edit v2", "jira: jira tool"]])
    }),
  )

  it.effect("keeps hosted tools top-level and folds changes to them", () =>
    Effect.gen(function* () {
      const image = OpenAI.imageGeneration()
      const prepared = yield* compileRequest(ai.request({ model: astra, tools: [read, image], prompt: "Go." }))
      const added = yield* compileRequest(
        ai.request({
          model: astra,
          tools: [read],
          messages: [Message.user("Go."), Message.tools({ add: [image] })],
        }),
      )

      expect(topLevel(prepared.body)).toEqual(["image_generation"])
      expect(additional(prepared.body)).toEqual([["read: read tool"]])
      expect(topLevel(added.body)).toEqual(["image_generation"])
      expect(additional(added.body)).toEqual([["read: read tool"]])
    }),
  )

  it.effect("keeps tool_choice for tools declared only in additional_tools", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({ model: astra, tools: [read], toolChoice: { type: "tool", name: "read" }, prompt: "Go." }),
      )
      const added = yield* compileRequest(
        ai.request({
          model: astra,
          messages: [Message.user("Go."), Message.tools({ add: [jira] })],
          toolChoice: "required",
        }),
      )

      expect(prepared.body.tool_choice).toEqual({ type: "function", name: "read" })
      expect(added.body.tool_choice).toBe("required")
      expect(additional(added.body)).toEqual([["jira: jira tool"]])
    }),
  )

  it.effect("sends a marker's own text after its tool changes", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          tools: [read],
          messages: [Message.user("Go."), { role: "system", content: "Use jira now.", tools: { add: [jira] } }],
        }),
      )

      expect(trace(prepared.body)).toEqual(["tools: read", "user", hint(), "tools: jira", "Use jira now."])
    }),
  )

  it.effect("adds freeform tools as custom tools and replays their calls as custom tool calls", () =>
    Effect.gen(function* () {
      const run = ToolDefinition.make({
        name: "run",
        description: "Run code",
        inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
        freeform: { type: "text" },
      })
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          tools: [read],
          messages: [
            Message.user("Run it."),
            Message.tools({ add: [run] }),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "run", input: { code: "ls" } })]),
            Message.tool({ id: "call_1", name: "run", result: "ok" }),
          ],
        }),
      )
      const plain = yield* compileRequest(ai.request({ model: openai("gpt-6-astra"), tools: [read, run], prompt: "x" }))

      expect(prepared.body.input[3]).toEqual({
        type: "additional_tools",
        role: "developer",
        tools: [plain.body.tools?.[1]],
      })
      expect(plain.body.tools?.[1]?.type).toBe("custom")
      expect(prepared.body.input[4]).toEqual({ type: "custom_tool_call", call_id: "call_1", name: "run", input: "ls" })
    }),
  )

  it.effect("keeps earlier declarations and calls of a freeform tool unchanged when it is redefined later", () =>
    Effect.gen(function* () {
      const schema = { type: "object", properties: { code: { type: "string" } }, required: ["code"] }
      const run = ToolDefinition.make({
        name: "run",
        description: "Run code",
        inputSchema: schema,
        freeform: { type: "text" },
      })
      const runRegex = ToolDefinition.make({
        name: "run",
        description: "Run code",
        inputSchema: schema,
        freeform: { type: "regex", pattern: "[a-z]+" },
      })
      const runJson = ToolDefinition.make({ name: "run", description: "Run code (JSON)", inputSchema: schema })
      const history = [
        Message.user("Run it."),
        Message.assistant([ToolCallPart.make({ id: "call_1", name: "run", input: { code: "ls" } })]),
        Message.tool({ id: "call_1", name: "run", result: "ok" }),
        Message.assistant("Done."),
      ]
      const before = yield* compileRequest(ai.request({ model: astra, tools: [read, run], messages: history }))
      for (const redefined of [runRegex, runJson]) {
        const after = yield* compileRequest(
          ai.request({
            model: astra,
            tools: [read, run],
            messages: [...history, Message.user("Again."), Message.tools({ add: [redefined] })],
          }),
        )
        // The request before the change is a prefix of the one after it, so the cached prompt holds.
        expect(after.body.input.slice(0, before.body.input.length)).toEqual(before.body.input)
      }
      expect(before.body.input[2]).toEqual({ type: "custom_tool_call", call_id: "call_1", name: "run", input: "ls" })
    }),
  )

  it.effect("keeps top-level tools and folds markers without updates", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({ model: openai("gpt-6-astra"), tools: [read, edit], messages: conversation }),
      )

      expect(additional(prepared.body)).toEqual([])
      expect(topLevel(prepared.body)).toEqual(["read", "write"])
    }),
  )

  const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque" }

  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        expect(new URL(request.url).pathname).toEndWith("/responses/compact")
        const body = JSON.parse(text)
        expect(body.tools.map((entry: { name: string }) => entry.name)).toEqual(["read", "write", "jira"])
        expect(body.input.map((item: { type: string }) => item.type)).toEqual(["message", "message", "message"])
        return respond(JSON.stringify({ object: "response.compaction", output: [checkpoint] }))
      }),
    ),
  ).effect("folds every tool into top-level tools on the compaction endpoint", () =>
    Effect.gen(function* () {
      const result = yield* ai.compact(
        ai.request({
          model: astra,
          tools: [read, edit],
          messages: [...conversation, Message.tools({ add: [jira] })],
        }),
        { mechanism: "endpoint" },
      )
      expect(result.replacement.map((message) => message.content[0]?.type)).toEqual(["compaction"])
    }),
  )
})
