import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { ai, LLMEvent, type LLMResponse, Message, tool, ToolCallPart, ToolDefinition } from "../src/effect.js"
import { AI } from "../src/index.js"
import { Gemini } from "../src/protocols/gemini.js"
import { TestLLM } from "../src/testing.js"
import { Auth, LLMClient } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { AnthropicMessages } from "../src/protocols/anthropic-messages.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { OpenAIResponses } from "../src/protocols/openai-responses.js"
import { gatewayProtocol } from "../src/protocols/utils/gateway-protocol.js"
import { GoogleVertexMessages } from "../src/providers.js"
import { applyToolUpdates, foldToolUpdates } from "../src/tool-updates.js"
import { it, testEffect } from "./lib/effect.js"
import { dynamicResponse, fixedResponse } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

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

const enabled = { tools: { updates: true } }

const anthropic = (id: string, capabilities?: { readonly tools?: { readonly updates?: boolean } }) =>
  AnthropicMessages.route
    .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
    .model({ id, capabilities })

const openai = (id: string, capabilities?: { readonly tools?: { readonly updates?: boolean } }) =>
  OpenAIResponses.route
    .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
    .model({ id, capabilities })

const chat = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4.1-mini" })

const opus5 = anthropic("claude-opus-5", enabled)
const astra = openai("gpt-6-astra", enabled)

const swap = Message.tools({ add: [write], remove: ["edit"] })
const conversation = [Message.user("Fix it."), Message.assistant("Done."), swap, Message.user("Next.")]
const folded = [Message.user("Fix it."), Message.assistant("Done."), Message.user("Next.")]

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

describe("foldToolUpdates", () => {
  test("adds, redefines by name, and removes in history order, then drops the markers", () => {
    const request = ai.request({
      model: chat,
      tools: [read, edit],
      messages: [
        Message.user("One."),
        Message.tools({ add: [write, defineTool("edit", "edit v2")] }),
        Message.user("Two."),
        Message.tools({ remove: ["read"] }),
        Message.user("Three."),
        Message.tools({ add: [defineTool("read", "read v2")] }),
      ],
    })

    const result = foldToolUpdates(request)
    expect(result.tools).toEqual([defineTool("edit", "edit v2"), write, defineTool("read", "read v2")])
    expect(result.messages).toEqual([Message.user("One."), Message.user("Two."), Message.user("Three.")])
  })

  test("removes by tool object or name and keeps a marker's own text", () => {
    const request = ai.request({
      model: chat,
      tools: [read, edit, lookup],
      messages: [
        Message.user("One."),
        Message.tools({ remove: [lookup, edit] }),
        { role: "system", content: "Tools changed.", tools: { add: [write], remove: ["read"] } },
      ],
    })

    const result = foldToolUpdates(request)
    expect(result.tools).toEqual([write])
    expect(result.messages).toEqual([Message.user("One."), Message.system("Tools changed.")])
  })

  test("keeps the request identity without markers and for routes that lower them", () => {
    const plain = ai.request({ model: opus5, tools: [read], prompt: "hi" })
    expect(applyToolUpdates(plain)).toBe(plain)

    const supported = ai.request({ model: opus5, tools: [read, edit], messages: conversation })
    expect(applyToolUpdates(supported)).toBe(supported)
  })

  it.effect("compiles markers into the top-level tools for protocols without native tool updates", () =>
    Effect.gen(function* () {
      const model = OpenAIChat.route
        .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
        .model({ id: "gpt-4.1-mini", capabilities: enabled })
      const withMarkers = yield* compileRequest(ai.request({ model, tools: [read, edit], messages: conversation }))
      const withoutMarkers = yield* compileRequest(ai.request({ model, tools: [read, write], messages: folded }))

      expect(withMarkers.body).toEqual(withoutMarkers.body)
    }),
  )

  it.effect("never sends a marker as an empty system message", () =>
    Effect.gen(function* () {
      const gemini = Gemini.route
        .with({
          endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
          auth: Auth.header("x-goog-api-key", "test"),
        })
        .model({ id: "gemini-3.5-flash", capabilities: enabled })
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
})

describe("tool objects", () => {
  it.effect("send the same definition from top-level tools and Message.tools", () =>
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
  test("forward native tool update support", () => {
    const wrapped = gatewayProtocol(AnthropicMessages.protocol, {
      id: "gateway-anthropic",
      prepare: (request) => Effect.succeed({ request, body: {} }),
    })
    expect(wrapped.supportsToolUpdates).toBe(AnthropicMessages.protocol.supportsToolUpdates)

    const vertex = GoogleVertexMessages.configure({ accessToken: "test", location: "global", project: "test" })
    expect(vertex.model("claude-opus-5").route.supportsToolUpdates).toBe(AnthropicMessages.protocol.supportsToolUpdates)
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
        {
          role: "system",
          content: [
            definition(write),
            removal("edit"),
            { type: "text", text: "`edit` is no longer available. Do not call it." },
          ],
        },
      ])
      const addition = prepared.body.messages[3]?.content[0]
      expect(addition?.type === "tool_addition" && addition.tool.definition).toEqual(plain.body.tools?.[1])
    }),
  )

  it.effect("folds markers that no user message or tool result would precede", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [read, edit],
          messages: [Message.user("Fix it."), Message.assistant("Done."), swap],
          cache: "none",
        }),
      )

      expect(prepared.body.messages.some((message) => message.role === "system")).toBe(false)
      expect(prepared.body.tools?.map((entry) => entry.name)).toEqual(["read", "write"])
    }),
  )

  it.effect("only mentions removals that match no current tool in the note", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [read],
          messages: [Message.user("Go."), Message.tools({ remove: ["read", "ghost"] })],
          cache: "none",
        }),
      )

      expect(prepared.body.messages.at(-1)).toEqual({
        role: "system",
        content: [
          removal("read"),
          { type: "text", text: "`read` and `ghost` are no longer available. Do not call them." },
        ],
      })
    }),
  )

  it.effect("drops a marker that changes nothing", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({ model: opus5, tools: [read], messages: [Message.user("Go."), Message.tools({})], cache: "none" }),
      )

      expect(prepared.body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Go." }] }])
    }),
  )

  it.effect("lists several removals in one note", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          tools: [read, edit, write],
          messages: [Message.user("Go."), Message.tools({ remove: ["read", "edit", "write"] })],
          cache: "none",
        }),
      )

      expect(prepared.body.messages.at(-1)).toEqual({
        role: "system",
        content: [
          removal("read"),
          removal("edit"),
          removal("write"),
          { type: "text", text: "`read`, `edit` and `write` are no longer available. Do not call them." },
        ],
      })
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

  it.effect("folds markers when the flag is off, the model lacks system updates, or no tools start the request", () =>
    Effect.gen(function* () {
      for (const [model, tools] of [
        [anthropic("claude-opus-5"), [read, edit]],
        [anthropic("claude-opus-4-5", enabled), [read, edit]],
        [opus5, []],
      ] as const) {
        const prepared = yield* compileRequest(ai.request({ model, tools, messages: conversation, cache: "none" }))

        expect(prepared.body.messages.some((message) => message.role === "system")).toBe(false)
        expect(prepared.body.tools?.map((entry) => entry.name)).toEqual(
          tools.length === 0 ? ["write"] : ["read", "write"],
        )
      }
    }),
  )
})

describe("OpenAI Responses tool updates", () => {
  const updates = (body: OpenAIResponses.OpenAIResponsesBody) =>
    body.input.filter(
      (item) => "type" in item && (item.type === "additional_tools" || ("role" in item && item.role === "developer")),
    )

  it.effect("lowers additions to additional_tools items and removals to developer text in place", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(ai.request({ model: astra, tools: [read, edit], messages: conversation }))
      const plain = yield* compileRequest(ai.request({ model: astra, tools: [read, write], prompt: "x" }))

      expect(prepared.body.tools?.map((entry) => ("name" in entry ? entry.name : entry.type))).toEqual(["read", "edit"])
      expect(prepared.body.input).toEqual([
        { type: "message", role: "user", content: [{ type: "input_text", text: "Fix it." }] },
        { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done." }] },
        { type: "additional_tools", role: "developer", tools: [plain.body.tools?.[1]] },
        {
          type: "message",
          role: "developer",
          content: "`edit` is no longer available. Do not call it.",
        },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Next." }] },
      ])
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

      expect(prepared.body.input.slice(1).map((item) => ("type" in item ? item.type : undefined))).toEqual([
        "additional_tools",
        "message",
      ])
      expect(prepared.body.input[2]).toEqual({ type: "message", role: "developer", content: "Use jira now." })
    }),
  )

  it.effect("replays calls to inline-only tools from another model under a namespace named after the tool", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          tools: [read],
          messages: [
            Message.user("File it."),
            Message.tools({ add: [jira] }),
            Message.assistant([
              ToolCallPart.make({ id: "call_1", name: "jira", input: {} }),
              ToolCallPart.make({ id: "call_2", name: "read", input: {} }),
            ]),
            Message.tool({ id: "call_1", name: "jira", result: "ok" }),
            Message.tool({ id: "call_2", name: "read", result: "ok" }),
          ],
        }),
      )

      expect(prepared.body.input.filter((item) => "type" in item && item.type === "function_call")).toEqual([
        { type: "function_call", call_id: "call_1", name: "jira", namespace: "jira", arguments: "{}" },
        { type: "function_call", call_id: "call_2", name: "read", namespace: undefined, arguments: "{}" },
      ])
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
      const plain = yield* compileRequest(ai.request({ model: astra, tools: [read, run], prompt: "x" }))

      expect(prepared.body.input[1]).toEqual({
        type: "additional_tools",
        role: "developer",
        tools: [plain.body.tools?.[1]],
      })
      expect(plain.body.tools?.[1]?.type).toBe("custom")
      expect(prepared.body.input[2]).toEqual({ type: "custom_tool_call", call_id: "call_1", name: "run", input: "ls" })
    }),
  )

  it.effect("replays the namespace of returned calls to inline-only tools exactly as received", () =>
    Effect.gen(function* () {
      const messages = [Message.user("File it."), Message.tools({ add: [jira] })]
      const returned = (namespace?: string) =>
        LLMClient.generate(ai.request({ model: astra, tools: [read], messages })).pipe(
          Effect.provide(
            fixedResponse(
              sseEvents(
                {
                  type: "response.output_item.done",
                  item: {
                    type: "function_call",
                    id: "fc_1",
                    call_id: "call_1",
                    name: "jira",
                    namespace,
                    arguments: "{}",
                  },
                },
                { type: "response.completed", response: { id: "resp_1" } },
              ),
            ),
          ),
        )
      const replayed = (response: LLMResponse) =>
        compileRequest(
          ai.request({
            model: astra,
            tools: [read],
            messages: [...messages, response.message, Message.tool({ id: "call_1", name: "jira", result: "ok" })],
          }),
        ).pipe(
          Effect.map((prepared) => prepared.body.input.find((item) => "type" in item && item.type === "function_call")),
        )
      const namespaced = yield* returned("jira")
      const plain = yield* returned(undefined)

      expect(namespaced.toolCalls.map((call) => [call.name, call.namespace])).toEqual([["jira", undefined]])
      expect(namespaced.toolCalls[0]?.providerMetadata).toEqual({ openai: { itemId: "fc_1", namespace: "jira" } })
      expect(yield* replayed(namespaced)).toEqual({
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "jira",
        namespace: "jira",
        arguments: "{}",
      })
      expect(plain.toolCalls[0]?.providerMetadata).toEqual({ openai: { itemId: "fc_1" } })
      expect(yield* replayed(plain)).toEqual({
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "jira",
        namespace: undefined,
        arguments: "{}",
      })
    }),
  )

  it.effect("folds markers that add a tool named like a starting tool", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          tools: [read, edit],
          messages: [Message.user("Go."), Message.tools({ add: [defineTool("edit", "edit v2")] })],
        }),
      )

      expect(updates(prepared.body)).toEqual([])
      expect(prepared.body.tools?.map((entry) => ("description" in entry ? entry.description : entry.type))).toEqual([
        "read tool",
        "edit v2",
      ])
    }),
  )

  it.effect("folds markers when the flag is off or no tools start the request", () =>
    Effect.gen(function* () {
      for (const [model, tools] of [
        [openai("gpt-6-astra"), [read, edit]],
        [astra, []],
      ] as const) {
        const prepared = yield* compileRequest(ai.request({ model, tools, messages: conversation }))

        expect(updates(prepared.body)).toEqual([])
        expect(prepared.body.tools?.map((entry) => ("name" in entry ? entry.name : entry.type))).toEqual(
          tools.length === 0 ? ["write"] : ["read", "write"],
        )
      }
    }),
  )

  const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque" }

  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        expect(new URL(request.url).pathname).toEndWith("/responses/compact")
        const body = JSON.parse(text)
        expect(body.tools.map((entry: { name: string }) => entry.name)).toEqual(["read", "write"])
        expect(body.input.map((item: { type: string }) => item.type)).toEqual(["message", "message", "message"])
        return respond(JSON.stringify({ object: "response.compaction", output: [checkpoint] }))
      }),
    ),
  ).effect("folds markers into the compaction endpoint tools", () =>
    Effect.gen(function* () {
      const result = yield* ai.compact(ai.request({ model: astra, tools: [read, edit], messages: conversation }), {
        mechanism: "endpoint",
      })
      expect(result.replacement.map((message) => message.content[0]?.type)).toEqual(["compaction"])
    }),
  )
})
