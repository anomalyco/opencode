import { describe, expect, test } from "bun:test"
import { LanguageModel, Message, ToolResultPart } from "@opencode-ai/ai"
import { Gemini } from "@opencode-ai/ai/protocols/gemini"
import { OpenAIResponses } from "@opencode-ai/ai/protocols/openai-responses"
import { compileRequest } from "@opencode-ai/ai/route/client"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { SessionModelRequest, boundImages, unsupportedParts } from "@opencode-ai/core/session/model-request"
import { SessionModelTransport } from "@opencode-ai/core/session/model-transport"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { Money } from "@opencode-ai/schema/money"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { ConfigProvider, DateTime, Effect } from "effect"
import { testEffect } from "./lib/effect"

const capabilities = (input: string[]) => ({ tools: true, input, output: ["text"] })

const it = testEffect(
  LayerNode.compile(LayerNode.group([SessionModelRequest.node, PluginHooks.node]), [
    [SessionModelTransport.node, SessionModelTransport.makeLayer({ open: () => Effect.die("Unexpected connection") })],
  ]),
)

const requestInput = (model: LanguageModel) => ({
  scope: {
    session: Session.Info.make({
      id: Session.ID.make("ses_request_options"),
      projectID: Project.ID.global,
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
      location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
    }),
    agentID: Agent.ID.make("build"),
    model: SessionRunnerModel.resolved(model, {
      capabilities: { ...capabilities(["text"]), responsesWebsockets: model.provider === "openai" },
      cost: [],
      limit: { context: 200_000, output: 32_000 },
    }),
  },
  transcript: { system: [], messages: [Message.user("Hello")] },
})

describe("SessionModelRequest.context options", () => {
  it.effect("compiles ordered generation and provider overrides without mutating defaults", () =>
    Effect.gen(function* () {
      const requests = yield* SessionModelRequest.Service
      const hooks = yield* PluginHooks.Service
      const model = Gemini.route
        .with({
          generation: { maxTokens: 100, topP: 0.7 },
          providerOptions: { thinkingConfig: { includeThoughts: true, thinkingBudget: 256 } },
        })
        .model({
          id: "gemini-2.5-flash",
          defaults: {
            generation: { temperature: 0.8 },
            providerOptions: { thinkingConfig: { thinkingBudget: 512 } },
          },
        })
      const baseline = yield* requests.prepare(requestInput(model))
      expect(baseline.request.generation).toBeUndefined()
      expect(baseline.request.providerOptions).toBeUndefined()
      const first = yield* hooks.register("session", "context", (event) =>
        Effect.sync(() => {
          expect(event.generation).toEqual({})
          expect(event.providerOptions).toEqual({})
          event.generation = {
            maxTokens: 2048,
            temperature: 0.2,
            topK: 40,
            frequencyPenalty: 0.1,
            presencePenalty: 0.3,
            seed: 42,
            stop: ["END"],
          }
          event.providerOptions = { thinkingConfig: { thinkingBudget: 1024 } }
        }),
      )
      const second = yield* hooks.register("session", "context", (event) =>
        Effect.sync(() => {
          expect(event.generation.temperature).toBe(0.2)
          expect(event.providerOptions.thinkingConfig).toEqual({ thinkingBudget: 1024 })
          event.generation.temperature = 0
          event.generation.stop?.push("STOP")
        }),
      )
      const prepared = yield* requests.prepare(requestInput(model))
      expect((yield* compileRequest(prepared.request)).body).toMatchObject({
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0,
          topP: 0.7,
          topK: 40,
          frequencyPenalty: 0.1,
          presencePenalty: 0.3,
          seed: 42,
          stopSequences: ["END", "STOP"],
          thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 },
        },
      })
      // Each new request starts with fresh override objects, even while hooks remain registered.
      expect((yield* requests.prepare(requestInput(model))).request.generation).toEqual(prepared.request.generation)
      yield* first.dispose
      yield* second.dispose
      const unhooked = yield* requests.prepare(requestInput(model))
      expect(unhooked.request.generation).toBeUndefined()
      expect(unhooked.request.providerOptions).toBeUndefined()
      expect((yield* compileRequest(unhooked.request)).body).toEqual((yield* compileRequest(baseline.request)).body)
      expect(model.defaults?.generation).toEqual({ temperature: 0.8 })
      expect(model.route.defaults.generation).toEqual({ maxTokens: 100, topP: 0.7 })
      expect(model.defaults?.providerOptions).toEqual({ thinkingConfig: { thinkingBudget: 512 } })
      expect(model.route.defaults.providerOptions).toEqual({
        thinkingConfig: { includeThoughts: true, thinkingBudget: 256 },
      })
    }),
  )

  it.effect("compiles OpenAI semantic reasoning options without revoking WebSocket transport", () =>
    Effect.gen(function* () {
      const requests = yield* SessionModelRequest.Service
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("session", "context", () => Effect.die("Other-provider hook must not run"), {
        providerID: "google",
      })
      yield* hooks.register(
        "session",
        "context",
        (event) =>
          Effect.sync(() => {
            event.generation.maxTokens = 8000
            event.providerOptions.reasoningEffort = "high"
          }),
        { providerID: "openai" },
      )
      const input = requestInput(OpenAIResponses.route.model({ id: "gpt-5.5" }))
      const prepared = yield* requests.prepare({ ...input, webSocket: "session" })
      expect(prepared.options.webSocket).toBeDefined()
      expect(prepared.options.http).toBeUndefined()
      expect((yield* compileRequest(prepared.request)).body).toMatchObject({
        max_output_tokens: 8000,
        reasoning: { effort: "high" },
        store: false,
        include: ["reasoning.encrypted_content"],
      })
      const excluded = yield* requests.prepare({ ...input, contextHooks: false })
      expect(excluded.request.generation).toBeUndefined()
      expect(excluded.request.providerOptions).toBeUndefined()
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { OPENCODE_EXPERIMENTAL_OPENAI_RESPONSES_WEBSOCKET: "true" } }),
        ),
      ),
    ),
  )
})

describe("SessionModelRequest.unsupportedParts", () => {
  test("replaces unsupported user media with a visible error", () => {
    const messages = unsupportedParts(
      [
        Message.user([
          Message.text("Describe these files"),
          { type: "media", mediaType: "image/png", data: "aGVsbG8=", filename: "logo.png" },
          { type: "media", mediaType: "application/pdf", data: "JVBERg==", filename: "document.pdf" },
        ]),
      ],
      capabilities(["text"]),
    )

    expect(messages[0]?.content).toEqual([
      Message.text("Describe these files"),
      Message.text('ERROR: Cannot read "logo.png" (this model does not support image input). Inform the user.'),
      Message.text('ERROR: Cannot read "document.pdf" (this model does not support pdf input). Inform the user.'),
    ])
  })

  test("replaces unsupported media nested in tool results", () => {
    const messages = unsupportedParts(
      [
        Message.tool(
          ToolResultPart.make({
            id: "call_1",
            name: "read",
            result: {
              type: "content",
              value: [
                { type: "text", text: "Image read successfully" },
                { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "logo.png" },
              ],
            },
          }),
        ),
      ],
      capabilities(["text"]),
    )

    expect(messages[0]?.content[0]).toMatchObject({
      type: "tool-result",
      result: {
        type: "content",
        value: [
          { type: "text", text: "Image read successfully" },
          {
            type: "text",
            text: 'ERROR: Cannot read "logo.png" (this model does not support image input). Inform the user.',
          },
        ],
      },
    })
  })

  test("preserves supported media", () => {
    const message = Message.user({ type: "media", mediaType: "image/png", data: "aGVsbG8=" })
    expect(unsupportedParts([message], capabilities(["text", "image"]))[0]?.content).toEqual(message.content)
  })
})

describe("SessionModelRequest.boundImages", () => {
  test("preserves images below the trigger", () => {
    const messages = [Message.user({ type: "media", mediaType: "image/png", data: "aGVsbG8=" })]
    expect(boundImages(messages)).toBe(messages)
  })

  test("replaces oldest images until the retained payload reaches the target", () => {
    const image = "a".repeat(9 * 1024 * 1024)
    const messages = [
      Message.user({ type: "media", mediaType: "image/png", data: image, filename: "first.png" }),
      Message.user({ type: "media", mediaType: "image/png", data: image, filename: "second.png" }),
      Message.user({ type: "media", mediaType: "image/png", data: image, filename: "third.png" }),
    ]
    const result = boundImages(messages)

    expect(result[0]?.content[0]).toMatchObject({ type: "text" })
    expect(result[1]?.content[0]).toMatchObject({ type: "text" })
    expect(result[2]?.content[0]).toMatchObject({ type: "media", filename: "third.png" })
  })

  test("replaces images nested in tool results", () => {
    const image = "a".repeat(13 * 1024 * 1024)
    const result = boundImages([
      Message.tool(
        ToolResultPart.make({
          id: "call_1",
          name: "read",
          result: {
            type: "content",
            value: [
              { type: "file", uri: `data:image/png;base64,${image}`, mime: "image/png", name: "first.png" },
              { type: "file", uri: `data:image/png;base64,${image}`, mime: "image/png", name: "second.png" },
            ],
          },
        }),
      ),
    ])

    expect(result[0]?.content[0]).toMatchObject({
      type: "tool-result",
      result: {
        type: "content",
        value: [{ type: "text" }, { type: "file", name: "second.png" }],
      },
    })
  })
})
