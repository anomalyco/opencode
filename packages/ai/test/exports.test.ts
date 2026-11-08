import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  ai,
  AIClient,
  AIError,
  DecisionClient,
  Generation,
  ImageClient,
  LLMClient,
  LLMEvent,
  Media,
  RawEvent,
  Model,
} from "@opencode/ai/effect"
import { AI } from "@opencode/ai"
import { Speech, SpeechClient, SpeechEvent, TranscriptionClient, Video, VideoClient } from "@opencode/ai/experimental"
import { Route, Protocol, RequestExecutor, WebSocketTransport } from "@opencode/ai/route"
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
  Runway,
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
    expect(Model.make).toBeFunction()
    expect(Media.bytes).toBeFunction()
    expect(ai.image.generate).toBeFunction()
    expect(Video.start).toBeFunction()
    expect(Video.resume).toBeFunction()
    expect(VideoClient.layer).toBeDefined()
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
        yield* RequestExecutor.Service
      }).pipe(Effect.provide(AIClient.layerWith(counting))),
    )
    expect(built).toBe(1)
  })

  test("route barrel exposes route-authoring APIs", () => {
    expect(Route.make).toBeFunction()
    expect(Protocol.make).toBeFunction()
    expect(WebSocketTransport.makeDirect).toBeFunction()
  })

  test("provider barrels expose user-facing facades", async () => {
    const { OpenAICompatibleResponses } = await import("@opencode/ai/providers")

    expect(OpenAI.model).toBeFunction()
    expect(OpenAI.provider.responses).toBe(OpenAI.responses)
    expect(OpenAI.configure({ apiKey: "fixture" }).responses).toBeFunction()
    for (const provider of [Baseten, DeepSeek, Fireworks]) {
      expect(provider.configure).toBeFunction()
      expect(provider.model).toBeFunction()
    }
    for (const name of ["baseten", "cerebras", "deepinfra", "deepseek", "fireworks", "groq", "togetherai"]) {
      expect(OpenAICompatible).not.toHaveProperty(name)
    }
    expect(
      Route.of(OpenAICompatibleResponses.configure({ baseURL: "https://responses.test/v1" }).model("fixture"))?.id,
    ).toBe("openai-compatible-responses")
    expect(CloudflareAIGateway.configure).toBeFunction()
    expect(CloudflareAIGateway.configure({ accountId: "fixture", gatewayApiKey: "fixture" }).model).toBeFunction()
    expect(CloudflareWorkersAI.configure).toBeFunction()
    expect(CloudflareWorkersAI.configure({ accountId: "fixture", apiKey: "fixture" }).model).toBeFunction()
    expect(OpenRouter.model).toBeFunction()
    expect(OpenRouter.decision).toBeFunction()
    expect(TypeSafeAI.decision).toBeFunction()
    expect(OpenCode.decision).toBeFunction()
    expect(Route.of(VercelAIGateway.decision("typesafe-ai/jev"))?.id).toBe("openai-decisions")
    expect(Baseten.decision).toBeFunction()
    expect(DigitalOcean.decision).toBeFunction()
    expect(Route.of(OpenAI.decision("gpt-6-luna"))?.id).toBe("openai-decisions")
    expect(XAI.model).toBeFunction()
    expect(XAI.provider.responses).toBe(XAI.responses)
    expect(XAI.provider.chat).toBe(XAI.chat)
    expect(Route.of(XAI.configure({ apiKey: "fixture" }).responses("grok-4.3"))?.id).toBe("xai-responses")
    expect(Route.of(XAI.configure({ apiKey: "fixture" }).chat("grok-4.3"))?.id).toBe("xai-chat")
    expect(Route.of(OpenAI.configure({ apiKey: "fixture" }).image("gpt-image-2"))?.id).toBe("openai-images")
    expect(OpenAI.provider.image).toBe(OpenAI.image)
    expect(Route.of(Google.configure({ apiKey: "fixture" }).image("imagen-4.0-generate-001"))?.id).toBe("google-images")
    expect(Google.provider.image).toBe(Google.image)
    expect(Route.of(XAI.configure({ apiKey: "fixture" }).image("grok-imagine-image"))?.id).toBe("xai-images")
    expect(XAI.provider.image).toBe(XAI.image)
    expect(Route.of(Meta.configure({ apiKey: "fixture" }).image("muse-image"))?.id).toBe("meta-images")
    expect(Meta.provider.image).toBe(Meta.image)
    expect(Route.of(ZAI.configure({ apiKey: "fixture" }).image("glm-image"))?.id).toBe("zai-images")
    expect(ZAI.provider.image).toBe(ZAI.image)
    expect(Route.of(MiniMax.configure({ apiKey: "fixture" }).image("image-01"))?.id).toBe("minimax-images")
    expect(MiniMax.provider.image).toBe(MiniMax.image)
    expect(
      Route.of(Alibaba.configure({ region: "ap-southeast-1", apiKey: "fixture" }).image("qwen-image-2.0"))?.id,
    ).toBe("alibaba-images")
    expect(Route.of(VercelAIGateway.configure({ apiKey: "fixture" }).image("meta/muse-image-1.0"))?.id).toBe(
      "openai-images",
    )
    expect(VercelAIGateway.provider.image).toBe(VercelAIGateway.image)
    expect(
      Route.of(
        CloudflareWorkersAI.configure({ accountId: "fixture", apiKey: "fixture" }).image(
          "@cf/black-forest-labs/flux-1-schnell",
        ),
      )?.id,
    ).toBe("cloudflare-workers-ai-images")
    expect(Route.of(XAI.configure({ apiKey: "fixture" }).video("grok-imagine-video-1.5"))?.id).toBe("xai-video")
    expect(XAI.provider.video).toBe(XAI.video)
    expect(Route.of(Google.configure({ apiKey: "fixture" }).video("veo-3.1-generate-preview"))?.id).toBe("google-video")
    expect(Google.provider.video).toBe(Google.video)
    expect(Route.of(Runway.configure({ apiKey: "fixture" }).video("gen4.5"))?.id).toBe("runway-video")
    expect(Runway.provider.video).toBe(Runway.video)
    expect(Route.of(OpenAI.configure({ apiKey: "fixture" }).speech("gpt-4o-mini-tts"))?.id).toBe("openai-speech")
    expect(Route.of(Google.configure({ apiKey: "fixture" }).speech("gemini-2.5-flash-preview-tts"))?.id).toBe(
      "google-speech",
    )
    expect(Route.of(ElevenLabs.configure({ apiKey: "fixture" }).speech("eleven_flash_v2_5"))?.id).toBe(
      "elevenlabs-speech",
    )
    expect(Route.of(Cartesia.configure({ apiKey: "fixture" }).speech("sonic-3"))?.id).toBe("cartesia-speech")
    expect(Route.of(Deepgram.configure({ apiKey: "fixture" }).speech("aura-2-thalia-en"))?.id).toBe("deepgram-speech")
    expect(Route.of(OpenAI.configure({ apiKey: "fixture" }).transcription("gpt-transcribe"))?.kind).toBe("stream")
    expect(Route.of(Google.configure({ apiKey: "fixture" }).transcription("gemini-3.5-transcribe"))?.kind).toBe(
      "stream",
    )
    expect(Route.of(Deepgram.configure({ apiKey: "fixture" }).transcription("nova-3"))?.kind).toBe("inline")
    expect(Route.of(AssemblyAI.configure({ apiKey: "fixture" }).transcription("universal-3-5-pro"))?.kind).toBe(
      "queued",
    )
    expect(Route.of(ElevenLabs.configure({ apiKey: "fixture" }).transcription("scribe_v2"))?.id).toBe(
      "elevenlabs-transcription",
    )
    expect(Route.of(ElevenLabs.configure({ apiKey: "fixture" }).transcription("scribe_v2"))?.kind).toBe("inline")
    expect(ElevenLabs.provider.transcription).toBe(ElevenLabs.transcription)
  })

  test("protocol barrels expose supported low-level routes", () => {
    expect(OpenAIChat.route.id).toBe("openai-chat")
    expect(OpenAICompatibleChat.route.id).toBe("openai-compatible-chat")
    expect(OpenResponses.protocol.id).toBe("open-responses")
    expect(OpenResponsesChannel.transport).toBeFunction()
    expect(OpenAICompatibleResponses.route.id).toBe("openai-compatible-responses")
    expect(OpenAICompatibleResponses.route.protocol).toBe("open-responses")
    expect(OpenAIResponses.route.id).toBe("openai-responses")
    expect(AnthropicMessages.route.id).toBe("anthropic-messages")
  })
})
