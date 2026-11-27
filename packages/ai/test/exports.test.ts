import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  ai,
  AIClient,
  AIError,
  DecisionClient,
  EmbeddingClient,
  Generation,
  ImageClient,
  VideoClient,
  LanguageModel,
  LLMClient,
  LLMEvent,
  Media,
  RawEvent,
} from "@opencode/ai/effect"
import { AI, Api, Provider } from "@opencode/ai"
import { Speech, SpeechClient, SpeechEvent, TranscriptionClient } from "@opencode/ai/experimental"
import { Protocol, RequestExecutor, WebSocketTransport } from "@opencode/ai/route"
import {
  Alibaba,
  AssemblyAI,
  Baseten,
  Cartesia,
  CloudflareAIGateway,
  CloudflareWorkersAI,
  Deepgram,
  DeepSeek,
  DigitalOcean,
  ElevenLabs,
  Fireworks,
  Google,
  Meta,
  MiniMax,
  OpenCode,
  OpenAI,
  OpenAICompatible,
  OpenRouter,
  TypeSafeAI,
  VercelAIGateway,
  XAI,
  ZAI,
} from "@opencode/ai/providers"
import {
  AnthropicMessages,
  OpenAIChat,
  OpenAICompatibleChat,
  OpenAICompatibleResponses,
  OpenAIResponses,
  OpenResponses,
  OpenResponsesChannel,
} from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"

describe("public exports", () => {
  test("modality, provider, and protocol entrypoints load first in a fresh process", async () => {
    const results = await Promise.all(
      ["image", "video", "speech", "transcription", "providers", "protocols"].map(async (entry) => {
        const child = Bun.spawn(
          [process.execPath, "-e", `await import(${JSON.stringify(`${import.meta.dir}/../src/${entry}.ts`)})`],
          { stderr: "pipe" },
        )
        return { entry, exitCode: await child.exited, stderr: await new Response(child.stderr).text() }
      }),
    )
    expect(results.filter((result) => result.exitCode !== 0)).toEqual([])
  })

  test("root exposes app-facing runtime APIs", () => {
    expect(ai.request).toBeFunction()
    expect(LLMClient.Service).toBeFunction()
    expect(LLMClient.layer).toBeDefined()
    expect(AIError).toBeFunction()
    expect(LanguageModel.make).toBeFunction()
    expect(Media.bytes).toBeFunction()
    expect(ai.image.generate).toBeFunction()
    expect(ai.video.start).toBeFunction()
    expect(ai.video.status).toBeFunction()
    expect(ai.video.result).toBeFunction()
    expect(ai.video.cancel).toBeFunction()
    expect(VideoClient.layer).toBeDefined()
    expect(AI.ai.video.start).toBeFunction()
    expect(Speech.generate).toBeFunction()
    expect(Speech.stream).toBeFunction()
    expect(SpeechClient.layer).toBeDefined()
    expect(SpeechEvent.is.audioDelta).toBeFunction()
    expect(Generation).toBeFunction()
    expect(TestLLM.testLayer).toBeFunction()
    expect(TestLLM.Test.of).toBeFunction()
    expect(ai.decision.generate).toBeFunction()
    expect(DecisionClient.layer).toBeDefined()
    expect(DecisionClient.fetchLayer).toBeDefined()
    expect(ai.embedding.generate).toBeFunction()
    expect(EmbeddingClient.layer).toBeDefined()
    expect(AI.ai.embedding.generate).toBeFunction()
  })

  test("both entry points export the raw event type", () => {
    const event: RawEvent = LLMEvent.raw({ data: { type: "ping" } })
    const promiseEvent: AI.RawEvent = event
    expect(RawEvent).toBe(AI.RawEvent)
    expect(LLMEvent.is.raw(promiseEvent)).toBe(true)
  })

  test("AIClient.layerWith shares one executor across every client", async () => {
    let built = 0
    const counting = Layer.effect(
      RequestExecutor.Service,
      Effect.sync(() => {
        built++
        return RequestExecutor.Service.of({ execute: () => Effect.die("unexpected request") })
      }),
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* LLMClient.Service
        yield* ImageClient.Service
        yield* VideoClient.Service
        yield* SpeechClient.Service
        yield* TranscriptionClient.Service
        yield* DecisionClient.Service
        yield* EmbeddingClient.Service
        yield* RequestExecutor.Service
      }).pipe(Effect.provide(AIClient.layerWith(counting))),
    )
    expect(built).toBe(1)
  })

  test("route barrel exposes API-authoring building blocks", () => {
    expect(Api.make).toBeFunction()
    expect(Provider.make).toBeFunction()
    expect(Protocol.make).toBeFunction()
    expect(WebSocketTransport.makeDirect).toBeFunction()
  })

  test("provider barrels expose user-facing facades", async () => {
    const { OpenAICompatibleResponses } = await import("@opencode/ai/providers")

    expect(OpenAI.model).toBeFunction()
    expect(OpenAI.embedding).toBeFunction()
    expect(OpenAI.openai.model("fixture").api.id).toBe("openai-responses")
    for (const provider of [Baseten, DeepSeek, Fireworks]) expect(provider.model).toBeFunction()
    expect(Baseten.baseten.id).toBe("baseten")
    expect(DeepSeek.deepseek.id).toBe("deepseek")
    expect(Fireworks.fireworks.id).toBe("fireworks")
    for (const name of ["baseten", "cerebras", "deepinfra", "deepseek", "fireworks", "groq", "togetherai"]) {
      expect(OpenAICompatible).not.toHaveProperty(name)
    }
    expect(OpenAICompatibleResponses.model("fixture", { baseURL: "https://responses.test/v1" }).api.id).toBe(
      "openai-compatible-responses",
    )
    expect(CloudflareAIGateway.model).toBeFunction()
    expect(CloudflareWorkersAI.model).toBeFunction()
    expect(OpenRouter.model).toBeFunction()
    expect(OpenRouter.decision).toBeFunction()
    expect(TypeSafeAI.decision).toBeFunction()
    expect(OpenCode.decision).toBeFunction()
    expect(VercelAIGateway.decision("typesafe-ai/jev").route.id).toBe("openai-decisions")
    expect(Baseten.decision).toBeFunction()
    expect(DigitalOcean.decision).toBeFunction()
    expect(OpenAI.decision("gpt-6-luna").route.id).toBe("openai-decisions")
    expect(XAI.model).toBeFunction()
    expect(XAI.model("grok-4.3", { apiKey: "fixture" }).api.id).toBe("xai-responses")
    expect(XAI.xai.with({ apiKey: "fixture" }).model("grok-4.3", { api: "chat-completions" }).api.id).toBe("xai-chat")
    expect(OpenAI.media({ apiKey: "fixture" }).image("gpt-image-2").route.id).toBe("openai-images")
    expect(Google.media({ apiKey: "fixture" }).image("imagen-4.0-generate-001").route.id).toBe("google-images")
    expect(XAI.media({ apiKey: "fixture" }).image("grok-imagine-image").route.id).toBe("xai-images")
    expect(Meta.media({ apiKey: "fixture" }).image("muse-image").route.id).toBe("meta-images")
    expect(ZAI.media({ apiKey: "fixture" }).image("glm-image").route.id).toBe("zai-images")
    expect(MiniMax.media({ apiKey: "fixture" }).image("image-01").route.id).toBe("minimax-images")
    expect(Alibaba.media({ region: "ap-southeast-1", apiKey: "fixture" }).image("qwen-image-2.0").route.id).toBe(
      "alibaba-images",
    )
    expect(VercelAIGateway.media({ apiKey: "fixture" }).image("meta/muse-image-1.0").route.id).toBe("openai-images")
    expect(
      CloudflareWorkersAI.media({ accountId: "fixture", apiKey: "fixture" }).image(
        "@cf/black-forest-labs/flux-1-schnell",
      ).route.id,
    ).toBe("cloudflare-workers-ai-images")
    expect(XAI.media({ apiKey: "fixture" }).video("grok-imagine-video-1.5").route.id).toBe("xai-video")
    expect(OpenAI.media({ apiKey: "fixture" }).speech("gpt-4o-mini-tts").route.id).toBe("openai-speech")
    expect(Google.media({ apiKey: "fixture" }).speech("gemini-2.5-flash-preview-tts").route.id).toBe("google-speech")
    expect(ElevenLabs.configure({ apiKey: "fixture" }).speech("eleven_flash_v2_5").route.id).toBe("elevenlabs-speech")
    expect(Cartesia.configure({ apiKey: "fixture" }).speech("sonic-3").route.id).toBe("cartesia-speech")
    expect(Deepgram.configure({ apiKey: "fixture" }).speech("aura-2-thalia-en").route.id).toBe("deepgram-speech")
    expect(OpenAI.media({ apiKey: "fixture" }).transcription("gpt-transcribe").route.kind).toBe("stream")
    expect(Google.media({ apiKey: "fixture" }).transcription("gemini-3.5-transcribe").route.kind).toBe("stream")
    expect(Deepgram.configure({ apiKey: "fixture" }).transcription("nova-3").route.kind).toBe("inline")
    expect(AssemblyAI.configure({ apiKey: "fixture" }).transcription("universal-3-5-pro").route.kind).toBe("queued")
    expect(ElevenLabs.configure({ apiKey: "fixture" }).transcription("scribe_v2").route.id).toBe(
      "elevenlabs-transcription",
    )
    expect(ElevenLabs.configure({ apiKey: "fixture" }).transcription("scribe_v2").route.kind).toBe("inline")
    expect(ElevenLabs.provider.transcription).toBe(ElevenLabs.transcription)
  })

  test("protocol barrels expose supported low-level APIs", () => {
    expect(OpenAIChat.api.id).toBe("openai-chat")
    expect(OpenAICompatibleChat.api.id).toBe("openai-compatible-chat")
    expect(OpenResponses.protocol.id).toBe("open-responses")
    expect(OpenResponsesChannel.transport).toBeFunction()
    expect(OpenAICompatibleResponses.api.id).toBe("openai-compatible-responses")
    expect(OpenAICompatibleResponses.api.protocol.id).toBe("open-responses")
    expect(OpenAIResponses.api.id).toBe("openai-responses")
    expect(AnthropicMessages.api.id).toBe("anthropic-messages")
  })
})
