import { describe, expect } from "bun:test"
import { AIError, LanguageModel, Media, Message, ProviderInternalError, ToolResultPart } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Config } from "@opencode/core/config"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionImageDescribe } from "@opencode/core/session/image-describe"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Document, Entry, Info as ConfigInfo } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const blind = Model.Info.make({
  ...Model.Info.default(Provider.ID.make("test-provider"), Model.ID.make("blind-chat")),
  capabilities: { tools: true, input: ["text"], output: ["text"] },
})
const vision = (id: string, providerID = "test-provider") =>
  Model.Info.make({
    ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
  })
const target = { capabilities: blind.capabilities, providerID: blind.providerID }

const document = (experimental?: ConstructorParameters<typeof ConfigExperimental.Info>[0]): Entry =>
  new Document({
    type: "document",
    info: new ConfigInfo(
      experimental === undefined ? {} : { experimental: new ConfigExperimental.Info(experimental) },
    ),
  })

const config = (experimental: ConstructorParameters<typeof ConfigExperimental.Info>[0] = { image_fallback: true }) =>
  Layer.mock(Config.Service, { entries: () => Effect.succeed([document(experimental)]) })

// The runtime identity mirrors the catalog entry, so the recorded request names the describing model.
const resolver = Layer.mock(ModelResolver.Service, {
  resolveModel: (model: Model.Info) =>
    Effect.succeed(
      SessionRunnerModel.resolved(
        LanguageModel.make({ id: model.id, provider: model.providerID, route: OpenAIChat.route }),
        {
          capabilities: model.capabilities,
          cost: [],
          limit: { context: 200_000, output: 32_000 },
        },
      ),
    ),
})

const media = (data: string, name: string) => ({
  type: "media" as const,
  media: Media.base64(data, "image/png"),
  filename: name,
})

describe("SessionImageDescribe.substitute", () => {
  const it = testEffect(
    SessionImageDescribe.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          config(),
          Layer.mock(Model.Service, { image: () => Effect.succeed(vision("auto-vision")) }),
          TestLLM.testLayer({ fallback: TestLLM.text("A red square", "describe") }),
          resolver,
        ),
      ),
    ),
  )

  it.effect("replaces an image a blind model cannot see with its description", () =>
    Effect.gen(function* () {
      const describe = yield* SessionImageDescribe.Service
      const llm = yield* TestLLM.Test
      const messages = [Message.user([Message.text("What is in this picture?"), media("aXNhbWFnZTE=", "chart.png")])]

      const result = yield* describe.substitute(messages, target)

      const requests = yield* llm.requests()
      expect(requests).toHaveLength(1)
      expect(JSON.stringify(requests[0]?.system)).toContain("image analysis assistant")
      expect(requests[0]?.messages[0]).toMatchObject({
        role: "user",
        content: [
          {
            type: "text",
            text: 'The image\'s file name is "chart.png".\nFor context, the user\'s message reads:\nWhat is in this picture?',
          },
          { type: "media", filename: "chart.png" },
        ],
      })
      expect(result[0]?.content).toEqual([
        Message.text("What is in this picture?"),
        Message.text(
          '[Image "chart.png" converted to text by test-provider/auto-vision because the active model cannot see images]\nA red square',
        ),
      ])
    }),
  )

  it.effect("describes the same image once and reuses the description", () =>
    Effect.gen(function* () {
      const describe = yield* SessionImageDescribe.Service
      const llm = yield* TestLLM.Test
      const messages = [Message.user([media("aXNhbWFnZTI=", "once.png")])]

      yield* describe.substitute(messages, target)
      const second = yield* describe.substitute(messages, target)

      expect(yield* llm.requests()).toHaveLength(1)
      expect(second[0]?.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("A red square") })
    }),
  )

  it.effect("describes images nested in tool results", () =>
    Effect.gen(function* () {
      const describe = yield* SessionImageDescribe.Service
      const messages = [
        Message.tool(
          ToolResultPart.make({
            id: "call_1",
            name: "read",
            result: {
              type: "content",
              value: [
                { type: "file", uri: "data:image/png;base64,aXNhbWFnZTM=", mime: "image/png", name: "shot.png" },
              ],
            },
          }),
        ),
      ]

      const result = yield* describe.substitute(messages, target)

      expect(result[0]).toMatchObject({
        role: "tool",
        content: [
          {
            type: "tool-result",
            result: {
              type: "content",
              value: [{ type: "text", text: expect.stringContaining('[Image "shot.png" converted to text') }],
            },
          },
        ],
      })
    }),
  )

  it.effect("keeps images the target model can already see", () =>
    Effect.gen(function* () {
      const describe = yield* SessionImageDescribe.Service
      const llm = yield* TestLLM.Test
      const messages = [Message.user([media("aXNhbWFnZTQ=", "seen.png")])]

      const result = yield* describe.substitute(messages, {
        capabilities: vision("sees-fine").capabilities,
        providerID: blind.providerID,
      })

      expect(result).toBe(messages)
      expect(yield* llm.requests()).toHaveLength(0)
    }),
  )

  it.effect("keeps a failed image's placeholder path untouched", () =>
    Effect.gen(function* () {
      const describe = yield* SessionImageDescribe.Service
      const llm = yield* TestLLM.Test
      yield* llm.always(
        TestLLM.failAfter(new AIError({ reason: new ProviderInternalError({ message: "vision offline" }) })),
      )
      const messages = [Message.user([media("aXNhbWFnZTU=", "gone.png")])]

      const result = yield* describe.substitute(messages, target)

      expect(result).toBe(messages)
    }),
  )

  const unconfigured = testEffect(
    SessionImageDescribe.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          config(),
          Layer.mock(Model.Service, { image: () => Effect.succeed(undefined) }),
          TestLLM.testLayer(),
          resolver,
        ),
      ),
    ),
  )

  unconfigured.effect("keeps images when no vision model is available", () =>
    Effect.gen(function* () {
      const describe = yield* SessionImageDescribe.Service
      const llm = yield* TestLLM.Test
      const messages = [Message.user([media("aXNhbWFnZTY=", "nope.png")])]

      const result = yield* describe.substitute(messages, target)

      expect(result).toBe(messages)
      expect(yield* llm.requests()).toHaveLength(0)
    }),
  )

  const configured = testEffect(
    SessionImageDescribe.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          config({
            image_fallback: true,
            image_model: { providerID: Provider.ID.make("test-provider"), model: Model.ID.make("picked-vision") },
          }),
          Layer.mock(Model.Service, {
            get: (providerID: Provider.ID, modelID: Model.ID) =>
              Effect.succeed(
                providerID === vision("picked-vision").providerID && modelID === vision("picked-vision").id
                  ? vision("picked-vision")
                  : undefined,
              ),
          }),
          TestLLM.testLayer({ fallback: TestLLM.text("Described", "describe") }),
          resolver,
        ),
      ),
    ),
  )

  configured.effect("prefers the configured experimental.image_model", () =>
    Effect.gen(function* () {
      const describe = yield* SessionImageDescribe.Service
      const llm = yield* TestLLM.Test

      yield* describe.substitute([Message.user([media("aXNhbWFnZTc=", "any.png")])], target)

      const requests = yield* llm.requests()
      expect(requests).toHaveLength(1)
      expect(String(requests[0]?.model.id)).toBe("picked-vision")
    }),
  )

  const disabled = testEffect(
    SessionImageDescribe.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          config({ image_fallback: false }),
          Layer.mock(Model.Service, { image: () => Effect.succeed(vision("never-used")) }),
          TestLLM.testLayer(),
          resolver,
        ),
      ),
    ),
  )

  disabled.effect("does nothing while the image_fallback flag is off", () =>
    Effect.gen(function* () {
      const describe = yield* SessionImageDescribe.Service
      const llm = yield* TestLLM.Test
      const messages = [Message.user([media("aXNhbWFnZTg=", "off.png")])]

      const result = yield* describe.substitute(messages, target)

      expect(result).toBe(messages)
      expect(yield* llm.requests()).toHaveLength(0)
    }),
  )
})

describe("Model.image", () => {
  const catalog = testEffect(
    AppNodeBuilder.build(
      LayerNode.group([Provider.node, Model.node, Bus.node, Credential.node, Integration.node]),
      [
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make("test") })),
          ),
        ),
      ],
    ),
  )

  catalog.effect("prefers the session provider's known cheap vision family over newer strangers", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.make("test-provider"), () => {})
        editor.update(Provider.ID.make("other-provider"), () => {})
      })
      yield* models.transform((editor) => {
        editor.update(Provider.ID.make("test-provider"), Model.ID.make("flashy"), (model) => {
          model.family = Model.Family.make("gemini-flash-lite")
          model.capabilities.input = ["text", "image"]
        })
        editor.update(Provider.ID.make("test-provider"), Model.ID.make("own-plain"), (model) => {
          model.capabilities.input = ["text", "image"]
        })
        editor.update(Provider.ID.make("other-provider"), Model.ID.make("newest-vision"), (model) => {
          model.family = Model.Family.make("premium-family")
          model.capabilities.input = ["text", "image"]
        })
        editor.update(Provider.ID.make("test-provider"), Model.ID.make("text-only"), (model) => {
          model.family = Model.Family.make("gemini-flash-lite")
        })
      })

      expect(yield* models.image(Provider.ID.make("test-provider"))).toMatchObject({ id: Model.ID.make("flashy") })
      // A same-provider vision model wins over a stranger's newer flagship.
      expect(yield* models.image(Provider.ID.make("other-provider"))).toMatchObject({
        id: Model.ID.make("newest-vision"),
      })
      expect(yield* models.image()).toMatchObject({ id: Model.ID.make("flashy") })
    }),
  )
})
