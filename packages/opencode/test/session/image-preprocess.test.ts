import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ImagePreprocess } from "@/session/image-preprocess"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PartID, SessionID, MessageID } from "@/session/schema"
import type { SessionStatus } from "@/session/status"
import type { Config } from "@/config/config"
import type { Session } from "@/session/session"

const testSessionID = SessionID.make("ses_test")
const testMessageID = MessageID.make("msg_test")

function makeUserMessage(parts: SessionV1.Part[], model?: { providerID: string; modelID: string }): SessionV1.WithParts {
  const info: SessionV1.User = {
    id: testMessageID,
    sessionID: testSessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: model
      ? { providerID: ProviderV2.ID.make(model.providerID), modelID: ModelV2.ID.make(model.modelID) }
      : { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-5") },
  }
  return { info, parts }
}

function textPart(text: string): SessionV1.TextPart {
  return {
    id: PartID.ascending(),
    sessionID: testSessionID,
    messageID: testMessageID,
    type: "text",
    text,
  }
}

function filePart(url: string, mime: string): SessionV1.FilePart {
  return {
    id: PartID.ascending(),
    sessionID: testSessionID,
    messageID: testMessageID,
    type: "file",
    mime,
    url,
  }
}

function makeModel(overrides: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: ModelV2.ID.make("gpt-5"),
    providerID: ProviderV2.ID.make("openai"),
    name: "GPT-5",
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      interleaved: false,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
    },
    api: { id: ModelV2.ID.make("gpt-5"), url: "https://api.openai.com", npm: "@ai-sdk/openai" },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 16_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-01-01",
    ...overrides,
  }
}

function makeVisionModel(): Provider.Model {
  return makeModel({
    id: ModelV2.ID.make("gpt-4o"),
    name: "GPT-4o",
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      interleaved: false,
      input: { text: true, image: true, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
    },
  })
}

function fakeProvider(overrides: {
  getModel?: (providerID: ProviderV2.ID, modelID: ModelV2.ID) => Effect.Effect<Provider.Model, any>
  getImageModel?: () => Effect.Effect<{ providerID: ProviderV2.ID; modelID: ModelV2.ID } | undefined>
} = {}): Provider.Interface {
  const defaults: Provider.Interface = {
    list: () => Effect.succeed({} as Record<ProviderV2.ID, Provider.Info>),
    getProvider: () => Effect.die("not implemented"),
    getModel: () => Effect.succeed(makeModel()),
    getLanguage: () => Effect.die("not implemented"),
    closest: () => Effect.succeed(undefined),
    getSmallModel: () => Effect.succeed(undefined),
    defaultModel: () => Effect.die("not implemented"),
    getImageModel: () => Effect.succeed(undefined),
  }
  return { ...defaults, ...overrides }
}

describe("ImagePreprocess", () => {
  describe("skips preprocessing", () => {
    test("when message is not a user message", async () => {
      const message: SessionV1.WithParts = {
        info: {
          id: testMessageID,
          sessionID: testSessionID,
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
          finish: "stop",
        } as SessionV1.Assistant,
        parts: [textPart("Hello")],
      }

      const result = await Effect.runPromise(
        ImagePreprocess.preprocessImages({
          sessionID: testSessionID.toString(),
          message,
          textParts: [textPart("Hello")],
          sessions: {} as Session.Interface,
          provider: {} as Provider.Interface,
          config: {} as Config.Interface,
          status: {} as SessionStatus.Interface,
        }),
      )

      expect(result).toBe(message)
    })

    test("when current model supports images", async () => {
      const visionModel = makeVisionModel()
      const message = makeUserMessage(
        [textPart("describe this"), filePart("data:image/png;base64,abc", "image/png")],
        { providerID: "openai", modelID: "gpt-4o" },
      )

      const provider = fakeProvider({
        getModel: () => Effect.succeed(visionModel),
      })

      const result = await Effect.runPromise(
        ImagePreprocess.preprocessImages({
          sessionID: testSessionID.toString(),
          message,
          textParts: [textPart("describe this")],
          sessions: {} as Session.Interface,
          provider,
          config: {} as Config.Interface,
          status: {} as SessionStatus.Interface,
        }),
      )

      expect(result).toBe(message)
    })

    test("when no image parts are present", async () => {
      const model = makeModel()
      const message = makeUserMessage([textPart("hello world")], { providerID: "openai", modelID: "gpt-5" })

      const provider = fakeProvider({
        getModel: () => Effect.succeed(model),
      })

      const result = await Effect.runPromise(
        ImagePreprocess.preprocessImages({
          sessionID: testSessionID.toString(),
          message,
          textParts: [textPart("hello world")],
          sessions: {} as Session.Interface,
          provider,
          config: {} as Config.Interface,
          status: {} as SessionStatus.Interface,
        }),
      )

      expect(result).toBe(message)
    })

    test("when no image model is available", async () => {
      const model = makeModel()
      const message = makeUserMessage(
        [textPart("describe this"), filePart("data:image/png;base64,abc", "image/png")],
        { providerID: "openai", modelID: "gpt-5" },
      )

      const provider = fakeProvider({
        getModel: () => Effect.succeed(model),
        getImageModel: () => Effect.succeed(undefined),
      })

      const result = await Effect.runPromise(
        ImagePreprocess.preprocessImages({
          sessionID: testSessionID.toString(),
          message,
          textParts: [textPart("describe this")],
          sessions: {} as Session.Interface,
          provider,
          config: { get: () => Effect.succeed({}) } as unknown as Config.Interface,
          status: {} as SessionStatus.Interface,
        }),
      )

      expect(result).toBe(message)
    })
  })
})
