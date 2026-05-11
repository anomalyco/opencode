import { EventStreamCodec } from "@smithy/eventstream-codec"
import { fromUtf8, toUtf8 } from "@smithy/util-utf8"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as BedrockConverse from "../../src/protocols/bedrock-converse"
import { it } from "../lib/effect"
import { fixedResponse } from "../lib/http"
import {
  eventSummary,
  expectWeatherToolLoop,
  runWeatherToolLoop,
  weatherTool,
  weatherToolLoopRequest,
  weatherToolName,
} from "../recorded-scenarios"
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

// Override the default SSE content-type with the binary event-stream type so
// the cassette layer treats the body as bytes when recording.
const fixedBytes = (bytes: Uint8Array) =>
  fixedResponse(bytes.slice().buffer, { headers: { "content-type": "application/vnd.amazon.eventstream" } })

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

describe("Bedrock Converse route", () => {
  it.effect("prepares Converse target with system, inference config, and messages", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(baseRequest)

      expect(prepared.body).toEqual({
        modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
        system: [{ text: "You are concise." }],
        messages: [{ role: "user", content: [{ text: "Say hello." }] }],
        inferenceConfig: { maxTokens: 64, temperature: 0 },
      })
    }),
  )

  it.effect("prepares tool config with toolSpec and toolChoice", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.updateRequest(baseRequest, {
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

      expect(prepared.body).toMatchObject({
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
      const prepared = yield* LLMClient.prepare(
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

      expect(prepared.body).toMatchObject({
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
      const response = yield* LLMClient.generate(baseRequest).pipe(Effect.provide(fixedBytes(body)))

      expect(response.text).toBe("Hello!")
      const finishes = response.events.filter((event) => event.type === "request-finish")
      // Bedrock splits the finish across `messageStop` (carries reason) and
      // `metadata` (carries usage). We consolidate them into a single
      // terminal `request-finish` event with both.
      expect(finishes).toHaveLength(1)
      expect(finishes[0]).toMatchObject({ type: "request-finish", reason: "stop" })
      expect(response.usage).toMatchObject({
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
      const response = yield* LLMClient.generate(
        LLM.updateRequest(baseRequest, {
          tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object" } }],
        }),
      ).pipe(Effect.provide(fixedBytes(body)))

      expect(response.toolCalls).toEqual([
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
        ["contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "Let me think." } } }],
        ["contentBlockStop", { contentBlockIndex: 0 }],
        ["messageStop", { stopReason: "end_turn" }],
      )
      const response = yield* LLMClient.generate(baseRequest).pipe(Effect.provide(fixedBytes(body)))

      expect(response.reasoning).toBe("Let me think.")
    }),
  )

  it.effect("emits provider-error for throttlingException", () =>
    Effect.gen(function* () {
      const body = eventStreamBody(
        ["messageStart", { role: "assistant" }],
        ["throttlingException", { message: "Slow down" }],
      )
      const response = yield* LLMClient.generate(baseRequest).pipe(Effect.provide(fixedBytes(body)))

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
      const error = yield* LLMClient.generate(LLM.updateRequest(baseRequest, { model: unsignedModel })).pipe(
        Effect.provide(fixedBytes(eventStreamBody(["messageStop", { stopReason: "end_turn" }]))),
        Effect.flip,
      )

      expect(error.message).toContain("Bedrock Converse requires either model.apiKey")
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
      const prepared = yield* LLMClient.prepare(LLM.updateRequest(baseRequest, { model: signed }))

      expect(prepared.route).toBe("bedrock-converse")
      // The prepare phase doesn't sign — toHttp does. We assert the credential
      // is plumbed onto the model native field for the signer to find.
      expect(prepared.model.native).toMatchObject({
        aws_credentials: { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE" },
        aws_region: "us-east-1",
      })
    }),
  )

  it.effect("emits cachePoint markers after system, user-text, and assistant-text with cache hints", () =>
    Effect.gen(function* () {
      const cache = new CacheHint({ type: "ephemeral" })
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          id: "req_cache",
          model,
          system: [{ type: "text", text: "System prefix.", cache }],
          messages: [
            LLM.user([{ type: "text", text: "User prefix.", cache }]),
            LLM.assistant([{ type: "text", text: "Assistant prefix.", cache }]),
          ],
          generation: { maxTokens: 16, temperature: 0 },
        }),
      )

      expect(prepared.body).toMatchObject({
        // System: text block followed by cachePoint marker.
        system: [{ text: "System prefix." }, { cachePoint: { type: "default" } }],
        messages: [
          {
            role: "user",
            content: [{ text: "User prefix." }, { cachePoint: { type: "default" } }],
          },
          {
            role: "assistant",
            content: [{ text: "Assistant prefix." }, { cachePoint: { type: "default" } }],
          },
        ],
      })
    }),
  )

  it.effect("does not emit cachePoint when no cache hint is set", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(baseRequest)
      expect(prepared.body).toMatchObject({
        system: [{ text: "You are concise." }],
        messages: [{ role: "user", content: [{ text: "Say hello." }] }],
      })
    }),
  )

  it.effect("lowers image media into Bedrock image blocks", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          id: "req_image",
          model,
          messages: [
            LLM.user([
              { type: "text", text: "What is in this image?" },
              { type: "media", mediaType: "image/png", data: "AAAA" },
              { type: "media", mediaType: "image/jpeg", data: "BBBB" },
              { type: "media", mediaType: "image/jpg", data: "CCCC" },
              { type: "media", mediaType: "image/webp", data: "DDDD" },
            ]),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        messages: [
          {
            role: "user",
            content: [
              { text: "What is in this image?" },
              { image: { format: "png", source: { bytes: "AAAA" } } },
              { image: { format: "jpeg", source: { bytes: "BBBB" } } },
              // image/jpg is a non-standard alias; we map it to jpeg.
              { image: { format: "jpeg", source: { bytes: "CCCC" } } },
              { image: { format: "webp", source: { bytes: "DDDD" } } },
            ],
          },
        ],
      })
    }),
  )

  it.effect("base64-encodes Uint8Array image bytes", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          id: "req_image_bytes",
          model,
          messages: [LLM.user([{ type: "media", mediaType: "image/png", data: new Uint8Array([1, 2, 3, 4, 5]) }])],
        }),
      )

      // Buffer.from([1,2,3,4,5]).toString("base64") === "AQIDBAU="
      expect(prepared.body).toMatchObject({
        messages: [
          {
            role: "user",
            content: [{ image: { format: "png", source: { bytes: "AQIDBAU=" } } }],
          },
        ],
      })
    }),
  )

  it.effect("lowers document media into Bedrock document blocks with format and name", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          id: "req_doc",
          model,
          messages: [
            LLM.user([
              { type: "media", mediaType: "application/pdf", data: "PDFDATA", filename: "report.pdf" },
              { type: "media", mediaType: "text/csv", data: "CSVDATA" },
            ]),
          ],
        }),
      )

      expect(prepared.body).toMatchObject({
        messages: [
          {
            role: "user",
            content: [
              // Filename round-trips when supplied.
              { document: { format: "pdf", name: "report.pdf", source: { bytes: "PDFDATA" } } },
              // Falls back to a stable placeholder when filename is missing.
              { document: { format: "csv", name: "document.csv", source: { bytes: "CSVDATA" } } },
            ],
          },
        ],
      })
    }),
  )

  it.effect("rejects unsupported image media types", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.prepare(
        LLM.request({
          id: "req_bad_image",
          model,
          messages: [LLM.user([{ type: "media", mediaType: "image/svg+xml", data: "x" }])],
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("Bedrock Converse does not support image media type image/svg+xml")
    }),
  )

  it.effect("rejects unsupported document media types", () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.prepare(
        LLM.request({
          id: "req_bad_doc",
          model,
          messages: [LLM.user([{ type: "media", mediaType: "application/x-tar", data: "x", filename: "a.tar" }])],
        }),
      ).pipe(Effect.flip)

      expect(error.message).toContain("Bedrock Converse does not support media type application/x-tar")
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
  provider: "amazon-bedrock",
  protocol: "bedrock-converse",
  requires: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
})

describe("Bedrock Converse recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      const response = yield* llm.generate(
        LLM.request({
          id: "recorded_bedrock_text",
          model: recordedModel(),
          system: "Reply with the single word 'Hello'.",
          prompt: "Say hello.",
          generation: { maxTokens: 16, temperature: 0 },
        }),
      )

      expect(eventSummary(response.events)).toEqual([
        { type: "text", value: "Hello" },
        { type: "finish", reason: "stop", usage: { inputTokens: 12, outputTokens: 2, totalTokens: 14 } },
      ])
    }),
  )

  recorded.effect.with("streams a tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      const response = yield* llm.generate(
        LLM.request({
          id: "recorded_bedrock_tool_call",
          model: recordedModel(),
          system: "Call tools exactly as requested.",
          prompt: "Call get_weather with city exactly Paris.",
          tools: [weatherTool],
          toolChoice: LLM.toolChoice(weatherTool),
          generation: { maxTokens: 80, temperature: 0 },
        }),
      )

      expect(eventSummary(response.events)).toEqual([
        { type: "tool-call", name: weatherToolName, input: { city: "Paris" } },
        { type: "finish", reason: "tool-calls", usage: { inputTokens: 419, outputTokens: 16, totalTokens: 435 } },
      ])
    }),
  )

  recorded.effect.with("drives a tool loop", { tags: ["tool", "tool-loop", "golden"] }, () =>
    Effect.gen(function* () {
      const llm = yield* LLMClient.Service
      expectWeatherToolLoop(
        yield* runWeatherToolLoop(
          weatherToolLoopRequest({
            id: "recorded_bedrock_tool_loop",
            model: recordedModel(),
          }),
        ),
      )
    }),
  )
})
