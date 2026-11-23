import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { ai, type Freeform, LanguageModel, LLMEvent, Message, toDefinitions, ToolCallPart } from "../../src/effect.js"
import * as AmazonBedrockMantle from "../../src/providers/amazon-bedrock-mantle.js"
import * as Anthropic from "../../src/providers/anthropic.js"
import * as Azure from "../../src/providers/azure.js"
import * as DigitalOcean from "../../src/providers/digitalocean.js"
import * as OpenAI from "../../src/providers/openai.js"
import * as OpenAICompatible from "../../src/providers/openai-compatible.js"
import * as OpenAICompatibleResponses from "../../src/providers/openai-compatible-responses.js"
import * as OpenRouter from "../../src/providers/openrouter.js"
import * as Venice from "../../src/providers/venice.js"
import * as VercelAIGateway from "../../src/providers/vercel-ai-gateway.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { tool } from "../../src/tool.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const GRAMMAR = 'start: "ZZ" /[0-9]{3}/'

const tools = (freeform?: Freeform) =>
  toDefinitions([
    tool({
      name: "run",
      description: "Run code",
      input: Schema.Struct({ code: Schema.String }),
      success: Schema.String,
      freeform,
    }),
  ])

const lark = tools({ type: "lark", grammar: GRAMMAR })
// The same tool without `freeform`, as a caller declares it for a model without custom tools.
const plain = tools()

const body = (model: LanguageModel, freeform = lark) =>
  compileRequest(ai.request({ model, prompt: "Run it.", tools: freeform, toolChoice: "run" })).pipe(
    Effect.map((prepared) => prepared.body),
  )

const responses = OpenAI.model("gpt-5.4", { apiKey: "test" })
const chat = OpenAI.chatModel("gpt-5.4", { apiKey: "test" })

const RESPONSES_LARK = {
  type: "custom",
  name: "run",
  description: "Run code",
  format: { type: "grammar", syntax: "lark", definition: GRAMMAR },
}
const CHAT_LARK = {
  type: "custom",
  custom: {
    name: "run",
    description: "Run code",
    format: { type: "grammar", grammar: { syntax: "lark", definition: GRAMMAR } },
  },
}

describe("freeform tools", () => {
  it.effect("encodes each format as a Responses custom tool", () =>
    Effect.gen(function* () {
      expect((yield* body(responses, tools({ type: "text" }))).tools).toEqual([
        { type: "custom", name: "run", description: "Run code", format: { type: "text" } },
      ])
      expect((yield* body(responses, tools({ type: "regex", pattern: "ZZ[0-9]{3}" }))).tools).toEqual([
        {
          type: "custom",
          name: "run",
          description: "Run code",
          format: { type: "grammar", syntax: "regex", definition: "ZZ[0-9]{3}" },
        },
      ])
      const prepared = yield* body(responses)
      expect(prepared.tools).toEqual([RESPONSES_LARK])
      expect(prepared.tool_choice).toEqual({ type: "custom", name: "run" })
    }),
  )

  it.effect("encodes each format as a Chat custom tool", () =>
    Effect.gen(function* () {
      expect((yield* body(chat, tools({ type: "text" }))).tools).toEqual([
        { type: "custom", custom: { name: "run", description: "Run code", format: { type: "text" } } },
      ])
      expect((yield* body(chat, tools({ type: "regex", pattern: "ZZ[0-9]{3}" }))).tools).toEqual([
        {
          type: "custom",
          custom: {
            name: "run",
            description: "Run code",
            format: { type: "grammar", grammar: { syntax: "regex", definition: "ZZ[0-9]{3}" } },
          },
        },
      ])
      const prepared = yield* body(chat)
      expect(prepared.tools).toEqual([CHAT_LARK])
      expect(prepared.tool_choice).toEqual({ type: "custom", custom: { name: "run" } })
    }),
  )

  it.effect("encodes custom tools in every route that reuses the OpenAI wire format", () =>
    Effect.gen(function* () {
      const settings = { apiKey: "test" }
      const responsesModels = [
        Azure.responsesModel("gpt-5.4", { ...settings, resourceName: "fixture" }),
        AmazonBedrockMantle.responsesModel("openai.gpt-5.4", { ...settings, region: "us-east-1" }),
        VercelAIGateway.responsesModel("openai/gpt-5.4", settings),
        OpenAICompatibleResponses.model("gpt-5.4", { ...settings, baseURL: "https://responses.test/v1" }),
        OpenRouter.responsesModel("openai/gpt-5.4", settings),
        DigitalOcean.responsesModel("openai-gpt-5.4", settings),
        Venice.responsesModel("openai-gpt-54", settings),
      ]
      const chatModels = [
        Azure.chatModel("gpt-5.4", { ...settings, resourceName: "fixture" }),
        AmazonBedrockMantle.chatModel("openai.gpt-5.4", { ...settings, region: "us-east-1" }),
        VercelAIGateway.chatModel("openai/gpt-5.4", settings),
        OpenRouter.model("openai/gpt-5.4", settings),
        OpenAICompatible.model("gpt-5.4", { ...settings, baseURL: "https://chat.test/v1" }),
      ]
      for (const model of responsesModels) {
        const prepared = yield* body(model)
        expect(prepared.tools).toEqual([RESPONSES_LARK])
      }
      for (const model of chatModels) {
        const prepared = yield* body(model)
        expect(prepared.tools).toEqual([CHAT_LARK])
      }
    }),
  )

  it.effect("sends JSON tools for tools without freeform and for other protocols", () =>
    Effect.gen(function* () {
      const prepared = yield* body(responses, plain)
      expect(prepared.tools).toMatchObject([{ type: "function", name: "run" }])
      expect(prepared.tool_choice).toEqual({ type: "function", name: "run" })
      expect((yield* body(chat, plain)).tools).toMatchObject([{ type: "function", function: { name: "run" } }])
      expect((yield* body(Anthropic.model("claude-sonnet-4-5", { apiKey: "test" }))).tools).toMatchObject([
        { name: "run", input_schema: { properties: { code: { type: "string" } } } },
      ])
    }),
  )

  it.effect("streams Responses custom calls as JSON argument deltas", () =>
    Effect.gen(function* () {
      const item = { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "run", input: "" }
      const response = yield* LLMClient.generate(ai.request({ model: responses, prompt: "Run it.", tools: lark })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.added", output_index: 0, item },
              { type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: "ZZ" },
              { type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: '"1\n' },
              { type: "response.custom_tool_call_input.done", output_index: 0, item_id: "ctc_1", input: 'ZZ"1\n' },
              { type: "response.output_item.done", output_index: 0, item: { ...item, input: 'ZZ"1\n' } },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )

      const deltas = response.events.filter((event) => event.type === "tool-input-delta").map((event) => event.text)
      expect(deltas).toEqual(['{"code":"', "ZZ", '\\"1\\n', '"}'])
      expect(JSON.parse(deltas.join(""))).toEqual({ code: 'ZZ"1\n' })
      expect(response.events.filter(LLMEvent.is.toolCall)).toEqual([
        expect.objectContaining({
          id: "call_1",
          name: "run",
          input: { code: 'ZZ"1\n' },
          providerMetadata: { openai: { itemId: "ctc_1", custom: true } },
        }),
      ])
      expect(response.finishReason.normalized).toBe("tool-calls")

      const replay = yield* compileRequest(ai.request({ model: responses, messages: [response.message], tools: lark }))
      expect(replay.body.input[0]).toEqual({
        type: "custom_tool_call",
        id: "ctc_1",
        call_id: "call_1",
        name: "run",
        input: 'ZZ"1\n',
      })
    }),
  )

  it.effect("parses a Responses custom call that arrives only when done", () =>
    Effect.gen(function* () {
      const item = { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "run", input: "ZZ123" }
      const response = yield* LLMClient.generate(ai.request({ model: responses, prompt: "Run it.", tools: lark })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              { type: "response.output_item.done", output_index: 0, item },
              { type: "response.completed", response: { id: "resp_1" } },
            ),
          ),
        ),
      )
      expect(response.events.filter(LLMEvent.is.toolCall)).toEqual([
        expect.objectContaining({ id: "call_1", name: "run", input: { code: "ZZ123" } }),
      ])
    }),
  )

  it.effect("streams Chat custom calls as JSON argument deltas", () =>
    Effect.gen(function* () {
      const chunk = (call: Record<string, unknown>, finish: string | null = null) => ({
        id: "chatcmpl_1",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call }] }, finish_reason: finish }],
      })
      const response = yield* LLMClient.generate(ai.request({ model: chat, prompt: "Run it.", tools: lark })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({ id: "call_1", type: "custom", custom: { name: "run", input: "" } }),
              chunk({ custom: { input: "ZZ" } }),
              chunk({ custom: { input: '"1\n' } }),
              { id: "chatcmpl_1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
            ),
          ),
        ),
      )

      const deltas = response.events.filter((event) => event.type === "tool-input-delta").map((event) => event.text)
      expect(deltas).toEqual(['{"code":"', "ZZ", '\\"1\\n', '"}'])
      expect(response.events.filter(LLMEvent.is.toolCall)).toEqual([
        expect.objectContaining({ id: "call_1", name: "run", input: { code: 'ZZ"1\n' } }),
      ])
      expect(response.finishReason.normalized).toBe("tool-calls")
    }),
  )

  it.effect("replays history the way each tool is declared in the current request", () =>
    Effect.gen(function* () {
      const history = (metadata: Record<string, unknown>) => [
        Message.user("Run it."),
        Message.assistant([
          ToolCallPart.make({
            id: "call_1",
            name: "run",
            input: { code: "ZZ123" },
            providerMetadata: { openai: metadata },
          }),
        ]),
        Message.tool({ id: "call_1", name: "run", result: "ok" }),
      ]
      const input = (declared: typeof lark, metadata: Record<string, unknown>) =>
        compileRequest(ai.request({ model: responses, messages: history(metadata), tools: declared })).pipe(
          Effect.map((prepared) => prepared.body.input.slice(1)),
        )
      const custom = { itemId: "ctc_1", custom: true }

      expect(yield* input(lark, custom)).toEqual([
        { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "run", input: "ZZ123" },
        { type: "custom_tool_call_output", call_id: "call_1", output: '"ok"' },
      ])
      expect(yield* input(plain, custom)).toEqual([
        { type: "function_call", call_id: "call_1", name: "run", arguments: '{"code":"ZZ123"}' },
        { type: "function_call_output", call_id: "call_1", output: '"ok"' },
      ])
      expect(yield* input(lark, { itemId: "fc_1" })).toEqual([
        { type: "custom_tool_call", call_id: "call_1", name: "run", input: "ZZ123" },
        { type: "custom_tool_call_output", call_id: "call_1", output: '"ok"' },
      ])
      expect(yield* input(plain, { itemId: "fc_1" })).toEqual([
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "run", arguments: '{"code":"ZZ123"}' },
        { type: "function_call_output", call_id: "call_1", output: '"ok"' },
      ])

      const messages = (model: LanguageModel, declared = lark) =>
        compileRequest(ai.request({ model, messages: history(custom), tools: declared })).pipe(
          Effect.map((prepared) => prepared.body.messages.slice(1)),
        )
      expect(yield* messages(chat)).toMatchObject([
        { role: "assistant", tool_calls: [{ id: "call_1", type: "custom", custom: { name: "run", input: "ZZ123" } }] },
        { role: "tool", tool_call_id: "call_1", content: '"ok"' },
      ])
      expect(yield* messages(chat, plain)).toMatchObject([
        {
          role: "assistant",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "run", arguments: '{"code":"ZZ123"}' } }],
        },
        { role: "tool", tool_call_id: "call_1", content: '"ok"' },
      ])
      expect(yield* messages(Anthropic.model("claude-sonnet-4-5", { apiKey: "test" }))).toMatchObject([
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "run", input: { code: "ZZ123" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1" }] },
      ])
    }),
  )

  it.effect("rejects freeform tools without exactly one required string parameter", () =>
    Effect.sync(() => {
      const make = (fields: Schema.Struct<Schema.Struct.Fields>) =>
        tool({
          name: "run",
          description: "Run code",
          input: Schema.toJsonSchemaDocument(fields).schema,
          freeform: { type: "text" },
        })
      expect(() => make(Schema.Struct({ code: Schema.Number }))).toThrow("exactly one parameter, a required string")
      expect(() => make(Schema.Struct({ code: Schema.optional(Schema.String) }))).toThrow()
      expect(() => make(Schema.Struct({ code: Schema.String, lang: Schema.String }))).toThrow()
      expect(make(Schema.Struct({ code: Schema.String }))._definition.freeform).toEqual({ type: "text" })
    }),
  )

  // A tool whose raw body is one field among others takes them on a first line.
  const optionsTool = toDefinitions([
    tool({
      name: "run",
      description: "Run code",
      input: Schema.Struct({
        code: Schema.String,
        timeout: Schema.optionalKey(Schema.Number.check(Schema.isInt())),
        background: Schema.optionalKey(Schema.Boolean),
      }),
      success: Schema.String,
      freeform: { type: "text", field: "code" },
    }),
  ])
  const LINE = '// @options: { "background": true, "timeout": 5 }'
  const RAW = `${LINE}\nawait build()`
  const INPUT = { code: "await build()", background: true, timeout: 5 }
  const item = { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "run", input: "" }
  const generate = (events: ReadonlyArray<unknown>, model: LanguageModel = responses) =>
    LLMClient.generate(ai.request({ model, prompt: "Run it.", tools: optionsTool })).pipe(
      Effect.provide(fixedResponse(sseEvents(...events))),
    )

  it.effect("sends a tool with other parameters with a grammar and a description of the line", () =>
    Effect.gen(function* () {
      const [sent] = (yield* body(responses, optionsTool)).tools
      expect(sent).toMatchObject({ type: "custom", name: "run", format: { type: "grammar", syntax: "lark" } })
      expect(sent.description).toStartWith("Run code\n\nTo set `timeout` or `background`, start with a `// @options:`")
      expect(sent.format.definition).toContain("ff_object: ff_pair_0 ff_rest_1 | ff_pair_1 ff_rest_2")
      expect((yield* body(chat, optionsTool)).tools[0]).toMatchObject({
        type: "custom",
        custom: {
          description: sent.description,
          format: { type: "grammar", grammar: { syntax: "lark", definition: sent.format.definition } },
        },
      })
      // A model that only takes text gets no grammar, and other protocols the JSON tool as is.
      const text = LanguageModel.update(responses, { capabilities: { tools: { freeform: ["text"] } } })
      expect((yield* body(text, optionsTool)).tools).toEqual([{ ...sent, format: { type: "text" } }])
      expect((yield* body(Anthropic.model("claude-sonnet-4-5", { apiKey: "test" }), optionsTool)).tools).toMatchObject([
        { name: "run", description: "Run code", input_schema: { properties: { background: {}, timeout: {} } } },
      ])
    }),
  )

  it.effect("reads the line on Responses and replays it exactly as written", () =>
    Effect.gen(function* () {
      const response = yield* generate([
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: `${LINE}\n` },
        { type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: "await build()" },
        { type: "response.output_item.done", output_index: 0, item: { ...item, input: RAW } },
        { type: "response.completed", response: { id: "resp_1" } },
      ])
      expect(response.events.filter(LLMEvent.is.toolCall)).toEqual([
        expect.objectContaining({
          id: "call_1",
          input: INPUT,
          providerMetadata: { openai: { itemId: "ctc_1", custom: true, header: LINE } },
        }),
      ])
      const replay = (message: Message) =>
        compileRequest(ai.request({ model: responses, messages: [message], tools: optionsTool })).pipe(
          Effect.map((prepared) => prepared.body.input[0]),
        )
      expect(yield* replay(response.message)).toMatchObject({ type: "custom_tool_call", call_id: "call_1", input: RAW })
      // A changed input, like one a hook edited, gets a fresh line.
      const call = response.message.content.find((part) => part.type === "tool-call")!
      const edited = Message.assistant([ToolCallPart.make({ ...call, input: { ...INPUT, timeout: 6 } })])
      expect(yield* replay(edited)).toMatchObject({
        input: '// @options: {"timeout":6,"background":true}\nawait build()',
      })
    }),
  )

  it.effect("reads the line on Chat and replays it exactly as written", () =>
    Effect.gen(function* () {
      const chunk = (call: Record<string, unknown>) => ({
        id: "chatcmpl_1",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call }] }, finish_reason: null }],
      })
      const response = yield* generate(
        [
          chunk({ id: "call_1", type: "custom", custom: { name: "run", input: `${LINE}\n` } }),
          chunk({ custom: { input: "await build()" } }),
          { id: "chatcmpl_1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
        ],
        chat,
      )
      expect(response.events.filter(LLMEvent.is.toolCall)).toEqual([
        expect.objectContaining({ id: "call_1", input: INPUT }),
      ])
      const replay = yield* compileRequest(
        ai.request({ model: chat, messages: [response.message], tools: optionsTool }),
      )
      expect(replay.body.messages[0]).toMatchObject({ tool_calls: [{ type: "custom", custom: { input: RAW } }] })
    }),
  )

  it.effect("finishes a custom call that only the completed response ends", () =>
    Effect.gen(function* () {
      const response = yield* generate([
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: RAW },
        { type: "response.completed", response: { id: "resp_1" } },
      ])
      expect(response.events.filter(LLMEvent.is.toolCall)).toEqual([
        expect.objectContaining({ id: "call_1", input: INPUT }),
      ])
    }),
  )

  it.effect("fails a call with a bad line, saying what is wrong", () =>
    Effect.gen(function* () {
      const raw = "// @options: {background: true}\nawait build()"
      const response = yield* generate([
        { type: "response.output_item.done", output_index: 0, item: { ...item, input: raw } },
        { type: "response.completed", response: { id: "resp_1" } },
      ])
      expect(response.events.filter(LLMEvent.is.toolCall)).toEqual([])
      expect(response.events.filter(LLMEvent.is.toolInputError)).toEqual([
        expect.objectContaining({
          id: "call_1",
          raw,
          message: expect.stringContaining("Invalid `// @options:` line: it does not hold a JSON object."),
        }),
      ])
    }),
  )

  it.effect("rejects a named field that is not a required string", () =>
    Effect.sync(() => {
      expect(() =>
        tool({
          name: "run",
          description: "Run code",
          input: Schema.toJsonSchemaDocument(Schema.Struct({ code: Schema.String, lang: Schema.String })).schema,
          freeform: { type: "text", field: "script" },
        }),
      ).toThrow("A freeform tool's `script` parameter must be a required string")
    }),
  )
})
