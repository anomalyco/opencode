import { EventStreamCodec } from "@smithy/eventstream-codec"
import { fromUtf8, toUtf8 } from "@smithy/util-utf8"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LLM } from "../../src"
import { client } from "../../src/adapter"
import { BedrockConverse } from "../../src/provider/bedrock-converse"
import { testEffect } from "../lib/effect"
import { dynamicResponse } from "../lib/http"
import { recordedTests } from "../recorded-test"

const codec = new EventStreamCodec(toUtf8, fromUtf8)
const utf8Encoder = new TextEncoder()

// Build a single AWS event-stream frame for a Converse stream event. Each
// frame carries `:message-type=event` + `:event-type=<name>` headers and a
// JSON payload body.
const eventFrame = (type: string, payload: object) =>
  codec.encode({
    headers: {
      ":message-type": { type: "string", value: "event" },
      ":event-type": { type: "string", value: type },
      ":content-type": { type: "string", value: "application/json" },
    },
    body: utf8Encoder.encode(JSON.stringify(payload)),
  })

const concat = (frames: ReadonlyArray<Uint8Array>) => {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const frame of frames) {
    out.set(frame, offset)
    offset += frame.length
  }
  return out
}

const eventStreamBody = (...payloads: ReadonlyArray<readonly [string, object]>) =>
  concat(payloads.map(([type, payload]) => eventFrame(type, payload)))

const fixedBytes = (bytes: Uint8Array) =>
  dynamicResponse((input) =>
    Effect.succeed(input.respond(bytes, { headers: { "content-type": "application/vnd.amazon.eventstream" } })),
  )

const model = BedrockConverse.model({
  id: "anthropic.claude-3-5-sonnet-20240620-v1:0",
  baseURL: "https://bedrock-runtime.test",
  apiKey: "test-bearer",
})

const baseRequest = LLM.request({
  id: "req_1",
  model,
  system: "You are concise.",
  prompt: "Say hello.",
  generation: { maxTokens: 64, temperature: 0 },
})

const it = testEffect(Layer.empty)

describe("Bedrock Converse adapter", () => {
  it.effect("prepares Converse target with system, inference config, and messages", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [BedrockConverse.adapter] }).prepare(baseRequest)

      expect(prepared.target).toEqual({
        modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
        system: [{ text: "You are concise." }],
        messages: [{ role: "user", content: [{ text: "Say hello." }] }],
        inferenceConfig: { maxTokens: 64, temperature: 0 },
      })
    }),
  )

  it.effect("prepares tool config with toolSpec and toolChoice", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [BedrockConverse.adapter] }).prepare(
        LLM.request({
          ...baseRequest,
          tools: [
            {
              name: "lookup",
              description: "Lookup data",
              inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
            },
          ],
          toolChoice: LLM.toolChoice({ type: "required" }),
        }),
      )

      expect(prepared.target).toMatchObject({
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: "lookup",
                description: "Lookup data",
                inputSchema: {
                  json: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
                },
              },
            },
          ],
          toolChoice: { any: {} },
        },
      })
    }),
  )

  it.effect("lowers assistant tool-call + tool-result message history", () =>
    Effect.gen(function* () {
      const prepared = yield* client({ adapters: [BedrockConverse.adapter] }).prepare(
        LLM.request({
          id: "req_history",
          model,
          messages: [
            LLM.user("What is the weather?"),
            LLM.assistant([LLM.toolCall({ id: "tool_1", name: "lookup", input: { query: "weather" } })]),
            LLM.toolMessage({ id: "tool_1", name: "lookup", result: { forecast: "sunny" } }),
          ],
        }),
      )

      expect(prepared.target).toMatchObject({
        messages: [
          { role: "user", content: [{ text: "What is the weather?" }] },
          {
            role: "assistant",
            content: [{ toolUse: { toolUseId: "tool_1", name: "lookup", input: { query: "weather" } } }],
          },
          {
            role: "user",
            content: [
              {
                toolResult: {
                  toolUseId: "tool_1",
                  content: [{ json: { forecast: "sunny" } }],
                  status: "success",
                },
              },
            ],
          },
        ],
      })
    }),
  )

  it.effect("decodes text-delta + messageStop + metadata usage from binary event stream", () =>
    Effect.gen(function* () {
      const body = eventStreamBody(
        ["messageStart", { role: "assistant" }],
        ["contentBlockDelta", { contentBlockIndex: 0, delta: { text: "Hello" } }],
        ["contentBlockDelta", { contentBlockIndex: 0, delta: { text: "!" } }],
        ["contentBlockStop", { contentBlockIndex: 0 }],
        ["messageStop", { stopReason: "end_turn" }],
        ["metadata", { usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }],
      )
      const response = yield* client({ adapters: [BedrockConverse.adapter] })
        .generate(baseRequest)
        .pipe(Effect.provide(fixedBytes(body)))

      expect(LLM.outputText(response)).toBe("Hello!")
      const finishes = response.events.filter((event) => event.type === "request-finish")
      // Bedrock splits the finish across `messageStop` (carries reason) and
      // `metadata` (carries usage). We consolidate them into a single
      // terminal `request-finish` event with both.
      expect(finishes).toHaveLength(1)
      expect(finishes[0]).toMatchObject({ type: "request-finish", reason: "stop" })
      expect(LLM.outputUsage(response)).toMatchObject({
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
      })
    }),
  )

  it.effect("assembles streamed tool call input", () =>
    Effect.gen(function* () {
      const body = eventStreamBody(
        ["messageStart", { role: "assistant" }],
        [
          "contentBlockStart",
          {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: "tool_1", name: "lookup" } },
          },
        ],
        ["contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: '{"query"' } } }],
        ["contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: ':"weather"}' } } }],
        ["contentBlockStop", { contentBlockIndex: 0 }],
        ["messageStop", { stopReason: "tool_use" }],
      )
      const response = yield* client({ adapters: [BedrockConverse.adapter] })
        .generate(
          LLM.request({
            ...baseRequest,
            tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object" } }],
          }),
        )
        .pipe(Effect.provide(fixedBytes(body)))

      expect(LLM.outputToolCalls(response)).toEqual([
        { type: "tool-call", id: "tool_1", name: "lookup", input: { query: "weather" } },
      ])
      const events = response.events.filter((event) => event.type === "tool-input-delta")
      expect(events).toEqual([
        { type: "tool-input-delta", id: "tool_1", name: "lookup", text: '{"query"' },
        { type: "tool-input-delta", id: "tool_1", name: "lookup", text: ':"weather"}' },
      ])
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "tool-calls" })
    }),
  )

  it.effect("decodes reasoning deltas", () =>
    Effect.gen(function* () {
      const body = eventStreamBody(
        ["messageStart", { role: "assistant" }],
        [
          "contentBlockDelta",
          { contentBlockIndex: 0, delta: { reasoningContent: { text: "Let me think." } } },
        ],
        ["contentBlockStop", { contentBlockIndex: 0 }],
        ["messageStop", { stopReason: "end_turn" }],
      )
      const response = yield* client({ adapters: [BedrockConverse.adapter] })
        .generate(baseRequest)
        .pipe(Effect.provide(fixedBytes(body)))

      expect(LLM.outputReasoning(response)).toBe("Let me think.")
    }),
  )

  it.effect("emits provider-error for throttlingException", () =>
    Effect.gen(function* () {
      const body = eventStreamBody(
        ["messageStart", { role: "assistant" }],
        ["throttlingException", { message: "Slow down" }],
      )
      const response = yield* client({ adapters: [BedrockConverse.adapter] })
        .generate(baseRequest)
        .pipe(Effect.provide(fixedBytes(body)))

      expect(response.events.find((event) => event.type === "provider-error")).toEqual({
        type: "provider-error",
        message: "Slow down",
        retryable: true,
      })
    }),
  )

  it.effect("rejects requests with no auth path", () =>
    Effect.gen(function* () {
      const unsignedModel = BedrockConverse.model({
        id: "anthropic.claude-3-5-sonnet-20240620-v1:0",
        baseURL: "https://bedrock-runtime.test",
      })
      const error = yield* client({ adapters: [BedrockConverse.adapter] })
        .generate(LLM.request({ ...baseRequest, model: unsignedModel }))
        .pipe(Effect.provide(fixedBytes(eventStreamBody(["messageStop", { stopReason: "end_turn" }]))), Effect.flip)

      expect(error.message).toContain("Bedrock Converse requires either a Bearer API key")
    }),
  )

  it.effect("signs requests with SigV4 when AWS credentials are provided (deterministic plumbing check)", () =>
    Effect.gen(function* () {
      const signed = BedrockConverse.model({
        id: "anthropic.claude-3-5-sonnet-20240620-v1:0",
        baseURL: "https://bedrock-runtime.test",
        credentials: {
          region: "us-east-1",
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        },
      })
      const prepared = yield* client({ adapters: [BedrockConverse.adapter] }).prepare(
        LLM.request({ ...baseRequest, model: signed }),
      )

      expect(prepared.adapter).toBe("bedrock-converse")
      // The prepare phase doesn't sign — toHttp does. We assert the credential
      // is plumbed onto the model native field for the signer to find.
      expect(prepared.model.native).toMatchObject({
        aws_credentials: { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE" },
        aws_region: "us-east-1",
      })
    }),
  )
})

// Live recorded integration tests. Run with `RECORD=true AWS_ACCESS_KEY_ID=...
// AWS_SECRET_ACCESS_KEY=... [AWS_SESSION_TOKEN=...] bun run test ...` to refresh
// cassettes; replay is the default and works without credentials.
//
// Region is pinned to us-east-1 in tests so the request URL is stable across
// machines on replay. If you need to record from a different region (e.g. your
// account has access elsewhere), pass `BEDROCK_RECORDING_REGION=eu-west-1` —
// but then commit the resulting cassette and others should record from the
// same region too.
const RECORDING_REGION = process.env.BEDROCK_RECORDING_REGION ?? "us-east-1"

const recordedModel = () =>
  BedrockConverse.model({
    // Most newer Anthropic models on Bedrock require a cross-region inference
    // profile (`us.` prefix). Nova does not require an Anthropic use-case form
    // and is on-demand-throughput accessible by default for most accounts.
    id: process.env.BEDROCK_MODEL_ID ?? "us.amazon.nova-micro-v1:0",
    credentials: {
      region: RECORDING_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fixture",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fixture",
      sessionToken: process.env.AWS_SESSION_TOKEN,
    },
  })

const recorded = recordedTests({
  prefix: "bedrock-converse",
  requires: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
})

describe("Bedrock Converse recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [BedrockConverse.adapter] })
      const response = yield* llm.generate(
        LLM.request({
          id: "recorded_bedrock_text",
          model: recordedModel(),
          system: "Reply with the single word 'Hello'.",
          prompt: "Say hello.",
          generation: { maxTokens: 16, temperature: 0 },
        }),
      )

      expect(LLM.outputText(response)).toMatch(/hello/i)
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish" })
    }),
  )

  recorded.effect("streams a tool call", () =>
    Effect.gen(function* () {
      const llm = client({ adapters: [BedrockConverse.adapter] })
      const response = yield* llm.generate(
        LLM.request({
          id: "recorded_bedrock_tool_call",
          model: recordedModel(),
          system: "Call tools exactly as requested.",
          prompt: "Call get_weather with city exactly Paris.",
          tools: [
            {
              name: "get_weather",
              description: "Get current weather for a city.",
              inputSchema: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
                additionalProperties: false,
              },
            },
          ],
          toolChoice: LLM.toolChoice({ type: "tool", name: "get_weather" }),
          generation: { maxTokens: 80, temperature: 0 },
        }),
      )

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expect(LLM.outputToolCalls(response)).toEqual([
        { type: "tool-call", id: expect.any(String), name: "get_weather", input: { city: "Paris" } },
      ])
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish", reason: "tool-calls" })
    }),
  )
})
