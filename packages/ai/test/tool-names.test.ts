import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  ai,
  AIError,
  Message,
  namespace,
  tool,
  ToolCallPart,
  ToolDefinition,
  ToolNamespace,
  type LLMRequestInput,
  type ToolExecuteContext,
} from "../src/effect.js"
import { OpenAIChat, OpenAIResponses } from "../src/protocols.js"
import { AmazonBedrock, OpenAI, XAI } from "../src/providers.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { it } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"
import { deltaChunk, finishChunk, toolCallChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"

// Request bodies are read as provider JSON.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
type Body = Record<string, any>

const chat = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })
const responses = OpenAIResponses.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-5.4" })
const bedrock = AmazonBedrock.configure({ baseURL: "https://bedrock-runtime.test", apiKey: "test" }).model(
  "anthropic.claude-sonnet-4-5-20250929-v1:0",
)

const contexts: Array<ToolExecuteContext | undefined> = []
const lookup = tool({
  name: "lookup",
  description: "Look up a customer",
  input: Schema.Struct({ id: Schema.String }),
  success: Schema.String,
  execute: ({ id }, context) => {
    contexts.push(context)
    return Effect.succeed(`customer ${id}`)
  },
})
const get = tool({
  name: "get",
  description: "Get a deal",
  input: Schema.Struct({ id: Schema.String }),
  success: Schema.String,
  execute: ({ id }) => Effect.succeed(`deal ${id}`),
})
const crm = namespace("crm", { description: "CRM tools" }, [lookup, namespace("deals", {}, [get])])

// Replies with each scripted body in turn and records every request body.
const scripted = (bodies: Array<Body>, replies: ReadonlyArray<string>) =>
  dynamicResponse((input) =>
    Effect.sync(() => {
      bodies.push(JSON.parse(input.text))
      return input.respond(replies[bodies.length - 1] ?? replies.at(-1), {
        headers: { "content-type": "text/event-stream" },
      })
    }),
  )

const chatCall = (name: string) => sseEvents(toolCallChunk("call_1", name, '{"id":"42"}'), finishChunk("tool_calls"))
const chatText = sseEvents(deltaChunk({ role: "assistant", content: "Done." }), finishChunk("stop"))

const responsesCall = (item: { readonly name: string; readonly namespace?: string }) => {
  const call = { type: "function_call", id: "fc_1", call_id: "call_1", ...item, arguments: "" }
  return sseEvents(
    { type: "response.output_item.added", output_index: 0, item: call },
    { type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_1", delta: '{"id":"42"}' },
    { type: "response.output_item.done", output_index: 0, item: { ...call, arguments: '{"id":"42"}' } },
    { type: "response.completed", response: { id: "resp_1" } },
  )
}
const responsesText = sseEvents(
  { type: "response.output_text.delta", item_id: "msg_1", delta: "Done." },
  { type: "response.completed", response: { id: "resp_2" } },
)

const run = (
  input: LLMRequestInput & { readonly tools: ReadonlyArray<typeof crm> },
  layer: ReturnType<typeof dynamicResponse>,
) => ai.collect(ai.loop(input)).pipe(Effect.provide(layer))

const compiled = (input: LLMRequestInput) =>
  compileRequest(ai.request(input)).pipe(Effect.map((prepared) => prepared.body as Body))

const functionCalls = (body: Body) =>
  (body.input as Array<Body>).filter((item) => item.type === "function_call").map((item) => [item.namespace, item.name])

const history = [
  Message.user("Look up 42"),
  Message.assistant(ToolCallPart.make({ id: "call_1", name: "lookup", namespace: "crm", input: { id: "42" } })),
  Message.tool({ id: "call_1", name: "lookup", namespace: "crm", result: "customer 42", resultType: "text" }),
]

describe("tool paths", () => {
  test("a dotted tool or namespace name throws at construction", () => {
    const dotted = /group tools with a namespace/
    expect(() => tool({ name: "crm.lookup", description: "Look up", input: Schema.Struct({}) })).toThrow(dotted)
    expect(() => ToolDefinition.make({ name: "crm.lookup", description: "Look up", inputSchema: {} })).toThrow(dotted)
    expect(() => ToolNamespace.make({ name: "crm.v2", tools: [] })).toThrow(dotted)
    expect(() => namespace("crm.v2", {}, [])).toThrow(dotted)
    expect(() => tool({ name: "", description: "Empty", input: Schema.Struct({}) })).toThrow()
  })

  it.effect("a grouped tool round-trips on a flattening protocol", () =>
    Effect.gen(function* () {
      contexts.length = 0
      const bodies: Array<Body> = []
      const result = yield* run(
        { model: chat, prompt: "Look up 42", tools: [crm] },
        scripted(bodies, [chatCall("crm_lookup"), chatText]),
      )
      expect(bodies[0]!.tools.map((item: Body) => item.function.name)).toEqual(["crm_lookup", "crm_deals_get"])
      expect(result.steps[0]!.toolCalls).toEqual([
        expect.objectContaining({ name: "lookup", namespace: "crm", input: { id: "42" } }),
      ])
      expect(contexts).toEqual([{ id: "call_1", name: "lookup", namespace: "crm" }])
      expect(result.messages[1]).toMatchObject({
        role: "tool",
        content: [{ name: "lookup", namespace: "crm", result: { type: "text", value: "customer 42" } }],
      })
      expect(bodies[1]!.messages.slice(1)).toMatchObject([
        { role: "assistant", tool_calls: [{ id: "call_1", function: { name: "crm_lookup" } }] },
        { role: "tool", tool_call_id: "call_1", content: "customer 42" },
      ])
    }),
  )

  it.effect("a grouped tool round-trips on a protocol with native namespaces", () =>
    Effect.gen(function* () {
      const bodies: Array<Body> = []
      const result = yield* run(
        { model: responses, prompt: "Look up 42", tools: [crm] },
        scripted(bodies, [responsesCall({ namespace: "crm", name: "lookup" }), responsesText]),
      )
      expect(bodies[0]!.tools).toMatchObject([
        { type: "namespace", name: "crm", tools: [{ name: "lookup" }, { name: "deals_get" }] },
      ])
      expect(result.steps[0]!.toolCalls).toEqual([expect.objectContaining({ name: "lookup", namespace: "crm" })])
      expect(result.messages[1]).toMatchObject({
        content: [{ name: "lookup", namespace: "crm", result: { type: "text", value: "customer 42" } }],
      })
      expect(functionCalls(bodies[1]!)).toEqual([["crm", "lookup"]])
    }),
  )

  it.effect("a tool in a nested namespace runs on both", () =>
    Effect.gen(function* () {
      const flat: Array<Body> = []
      const viaChat = yield* run(
        { model: chat, prompt: "Get deal 42", tools: [crm] },
        scripted(flat, [chatCall("crm_deals_get"), chatText]),
      )
      const native: Array<Body> = []
      const viaResponses = yield* run(
        { model: responses, prompt: "Get deal 42", tools: [crm] },
        scripted(native, [responsesCall({ namespace: "crm", name: "deals_get" }), responsesText]),
      )
      for (const result of [viaChat, viaResponses])
        expect(result.messages[1]).toMatchObject({
          content: [{ name: "get", namespace: "crm.deals", result: { type: "text", value: "deal 42" } }],
        })
      expect(flat[1]!.messages[1].tool_calls[0].function.name).toBe("crm_deals_get")
      expect(functionCalls(native[1]!)).toEqual([["crm", "deals_get"]])
    }),
  )

  it.effect("two tools sent under the same name fail instead of one replacing the other", () =>
    Effect.gen(function* () {
      const tools = [crm, ToolDefinition.make({ name: "crm_lookup", description: "Other", inputSchema: {} })]
      const error = yield* compiled({ model: chat, prompt: "Hi", tools }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(AIError)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain('"crm.lookup" and "crm_lookup"')
      // OpenAI Responses sends them apart, so they don't collide there.
      expect((yield* compiled({ model: responses, prompt: "Hi", tools })).tools).toHaveLength(2)
    }),
  )

  it.effect("history recorded on one provider replays on another", () =>
    Effect.gen(function* () {
      const fromResponses = yield* run(
        { model: responses, prompt: "Look up 42", tools: [crm] },
        scripted([], [responsesCall({ namespace: "crm", name: "lookup" }), responsesText]),
      )
      const onChat = yield* compiled({
        model: chat,
        tools: [crm],
        messages: [Message.user("Look up 42"), ...fromResponses.messages],
      })
      expect(onChat.messages[1].tool_calls[0].function.name).toBe("crm_lookup")

      const fromChat = yield* run(
        { model: chat, prompt: "Look up 42", tools: [crm] },
        scripted([], [chatCall("crm_lookup"), chatText]),
      )
      const onResponses = yield* compiled({
        model: responses,
        tools: [crm],
        messages: [Message.user("Look up 42"), ...fromChat.messages],
      })
      expect(functionCalls(onResponses)).toEqual([["crm", "lookup"]])
    }),
  )

  it.effect("an undeclared invented name replays provider-safe and stays as called in history", () =>
    Effect.gen(function* () {
      const call = ToolCallPart.make({ id: "call_1", name: "a.b.c", input: {} })
      const messages = [
        Message.user("Hi"),
        Message.assistant(call),
        Message.tool({ id: "call_1", name: "a.b.c", result: "No tool", resultType: "error" }),
      ]
      const onChat = yield* compiled({ model: chat, tools: [crm], messages })
      expect(onChat.messages[1].tool_calls[0].function.name).toBe("a_b_c")
      const onBedrock = yield* compiled({ model: bedrock, tools: [crm], messages })
      expect(onBedrock.messages[1].content[0].toolUse.name).toBe("a_b_c")
      expect(messages[1]!.content[0]).toMatchObject({ name: "a.b.c" })
    }),
  )

  it.effect("histories that recorded flattened names replay through the table", () =>
    Effect.gen(function* () {
      const messages = [
        Message.user("Look up 42"),
        Message.assistant(ToolCallPart.make({ id: "call_1", name: "crm_lookup", input: { id: "42" } })),
        Message.tool({ id: "call_1", name: "crm_lookup", result: "customer 42", resultType: "text" }),
      ]
      expect(functionCalls(yield* compiled({ model: responses, tools: [crm], messages }))).toEqual([["crm", "lookup"]])
      const onChat = yield* compiled({ model: chat, tools: [crm], messages })
      expect(onChat.messages[1].tool_calls[0].function.name).toBe("crm_lookup")
    }),
  )

  it.effect("a forced choice names a tool by path or by the tool itself", () =>
    Effect.gen(function* () {
      for (const toolChoice of ["crm.lookup", lookup] as const) {
        const body = yield* compiled({ model: chat, prompt: "Hi", tools: [crm], toolChoice })
        expect(body.tool_choice).toEqual({ type: "function", function: { name: "crm_lookup" } })
      }
      // OpenAI Responses can't force a tool inside a namespace, so that request sends flat names, and decodes them.
      const bodies: Array<Body> = []
      const result = yield* run(
        { model: responses, prompt: "Look up 42", tools: [crm], toolChoice: "crm.lookup" },
        scripted(bodies, [responsesCall({ name: "crm_lookup" }), responsesText]),
      )
      expect(bodies[0]!.tool_choice).toEqual({ type: "function", name: "crm_lookup" })
      expect(bodies[0]!.tools.map((item: Body) => item.name)).toEqual(["crm_lookup", "crm_deals_get"])
      expect(result.steps[0]!.toolCalls).toEqual([expect.objectContaining({ name: "lookup", namespace: "crm" })])
      expect(functionCalls(bodies[1]!)).toEqual([["crm", "lookup"]])

      const twice = [crm, namespace("support", {}, [lookup])]
      const error = yield* compiled({ model: chat, prompt: "Hi", tools: twice, toolChoice: lookup }).pipe(Effect.flip)
      expect(error.message).toContain("name it by its path")
    }),
  )

  it.effect("Message.tools removes a tool or a whole namespace by path", () =>
    Effect.gen(function* () {
      const other = ToolDefinition.make({ name: "other", description: "Other", inputSchema: {} })
      const removing = (remove: ReadonlyArray<string>) =>
        compiled({
          model: chat,
          tools: [crm, other],
          messages: [Message.user("Hi"), Message.tools({ remove }), Message.user("Again")],
        }).pipe(Effect.map((body) => body.tools.map((item: Body) => item.function.name)))
      expect(yield* removing(["crm"])).toEqual(["other"])
      expect(yield* removing(["crm.lookup"])).toEqual(["crm_deals_get", "other"])
      expect(yield* removing(["crm.deals"])).toEqual(["crm_lookup", "other"])

      // Removing a namespace's last member removes the namespace, so OpenAI Responses doesn't send it empty.
      const native = yield* compiled({
        model: responses,
        tools: [namespace("solo", {}, [lookup]), other],
        messages: [Message.user("Hi"), Message.tools({ remove: ["solo.lookup"] }), Message.user("Again")],
      })
      expect(native.tools.map((item: Body) => item.name)).toEqual(["other"])
    }),
  )
})

describe("compaction uses the names steps use", () => {
  const request = { tools: [crm], messages: history }
  const toolNames = (body: Body) =>
    (body.tools as Array<Body>).map((item) =>
      item.type === "namespace" ? [item.name, item.tools.map((leaf: Body) => leaf.name)] : item.name,
    )

  const compactBodies: Array<Body> = []
  const compactLayer = dynamicResponse(({ text, respond }) =>
    Effect.sync(() => {
      compactBodies.push(JSON.parse(text))
      return respond(
        JSON.stringify({
          object: "response.compaction",
          output: [{ type: "compaction", id: "cmp_1", encrypted_content: "x" }],
        }),
      )
    }),
  )

  for (const model of [
    OpenAI.configure({ apiKey: "test" }).responses("gpt-5.4"),
    XAI.configure({ apiKey: "test" }).responses("grok-4.6"),
  ])
    it.effect(`${model.provider} /responses/compact`, () =>
      Effect.gen(function* () {
        compactBodies.length = 0
        const step = yield* compiled({ model, ...request })
        yield* ai.compact(ai.request({ model, ...request })).pipe(Effect.provide(compactLayer))
        expect(functionCalls(compactBodies[0]!)).toEqual(functionCalls(step))
        expect(toolNames(compactBodies[0]!)).toEqual(toolNames(step))
      }),
    )

  it.effect("OpenAI trigger compaction", () =>
    Effect.gen(function* () {
      const model = OpenAI.configure({ apiKey: "test" }).responses("gpt-5.4")
      const bodies: Array<Body> = []
      const step = yield* compiled({ model, ...request })
      yield* ai.compact(ai.request({ model, ...request }), { mechanism: "trigger" }).pipe(
        Effect.provide(
          scripted(bodies, [
            sseEvents({
              type: "response.completed",
              response: { id: "resp_1", output: [{ type: "compaction", id: "cmp_1", encrypted_content: "x" }] },
            }),
          ]),
        ),
      )
      expect(functionCalls(bodies[0]!)).toEqual([["crm", "lookup"]])
      expect(functionCalls(bodies[0]!)).toEqual(functionCalls(step))
      expect(toolNames(bodies[0]!)).toEqual(toolNames(step))
    }),
  )
})
