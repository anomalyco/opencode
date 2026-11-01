import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  ai,
  AIClient,
  AIError,
  DecisionClient,
  Generation,
  ImageClient,
  LanguageModel,
  LLMClient,
  LLMEvent,
  Media,
  RawEvent,
} from "@opencode/ai/effect"
import { AI } from "@opencode/ai"
import { Speech, SpeechClient, SpeechEvent, TranscriptionClient, Video, VideoClient } from "@opencode/ai/experimental"
import { Route, Protocol, RequestExecutor, WebSocketTransport } from "@opencode/ai/route"
import {
  alibaba,
  assemblyai,
  baseten,
  cartesia,
  cloudflareAIGateway,
  cloudflareWorkersAI,
  deepgram,
  deepseek,
  digitalocean,
  elevenlabs,
  fireworks,
  google,
  meta,
  minimax,
  opencode,
  openai,
  openaiCompatible,
  openrouter,
  runway,
  typesafeAI,
  vercelAIGateway,
  xai,
  zai,
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

  test("provider barrels expose callable providers", async () => {
    const providers = await import("@opencode/ai/providers")

    expect(openai("gpt-5.4").route.id).toBe("openai-responses")
    expect(openai.configure({ apiKey: "fixture" })("gpt-5.4").route.id).toBe("openai-responses")
    expect(openai.configure({ apiKey: "fixture" }).chat("gpt-5.4").route.id).toBe("openai-chat")
    for (const provider of [baseten, deepseek, fireworks]) {
      expect(provider.configure).toBeFunction()
      expect(provider("fixture").route).toBeDefined()
    }
    for (const name of ["model", "provider", "configure", "chatModel", "responsesModel", "OpenAI", "Anthropic"]) {
      expect(providers).not.toHaveProperty(name)
    }
    for (const name of ["baseten", "cerebras", "deepinfra", "deepseek", "fireworks", "groq", "togetherai"]) {
      expect(openaiCompatible).not.toHaveProperty(name)
    }
    expect(
      providers.openaiCompatibleResponses.configure({ baseURL: "https://responses.test/v1" })("fixture").route.id,
    ).toBe("openai-compatible-responses")
    expect(cloudflareAIGateway.configure({ accountId: "fixture", gatewayApiKey: "fixture" })).toBeFunction()
    expect(cloudflareWorkersAI.configure({ accountId: "fixture", apiKey: "fixture" })).toBeFunction()
    expect(openrouter("fixture").route.id).toBe("openrouter")
    expect(openrouter.decision).toBeFunction()
    expect(typesafeAI.decision).toBeFunction()
    expect(opencode.decision).toBeFunction()
    expect(vercelAIGateway.decision("typesafe-ai/jev").route.id).toBe("openai-decisions")
    expect(baseten.decision).toBeFunction()
    expect(digitalocean.decision).toBeFunction()
    expect(openai.decision("gpt-6-luna").route.id).toBe("openai-decisions")
    expect(xai("grok-4.3").route.id).toBe("xai-responses")
    expect(xai.configure({ apiKey: "fixture" }).responses("grok-4.3").route.id).toBe("xai-responses")
    expect(xai.configure({ apiKey: "fixture" }).chat("grok-4.3").route.id).toBe("xai-chat")
    expect(openai.configure({ apiKey: "fixture" }).image("gpt-image-2").route.id).toBe("openai-images")
    expect(google.configure({ apiKey: "fixture" }).image("imagen-4.0-generate-001").route.id).toBe("google-images")
    expect(xai.configure({ apiKey: "fixture" }).image("grok-imagine-image").route.id).toBe("xai-images")
    expect(meta.configure({ apiKey: "fixture" }).image("muse-image").route.id).toBe("meta-images")
    expect(zai.configure({ apiKey: "fixture" }).image("glm-image").route.id).toBe("zai-images")
    expect(minimax.configure({ apiKey: "fixture" }).image("image-01").route.id).toBe("minimax-images")
    expect(alibaba.configure({ region: "ap-southeast-1", apiKey: "fixture" }).image("qwen-image-2.0").route.id).toBe(
      "alibaba-images",
    )
    expect(vercelAIGateway.configure({ apiKey: "fixture" }).image("meta/muse-image-1.0").route.id).toBe("openai-images")
    expect(
      cloudflareWorkersAI
        .configure({ accountId: "fixture", apiKey: "fixture" })
        .image("@cf/black-forest-labs/flux-1-schnell").route.id,
    ).toBe("cloudflare-workers-ai-images")
    expect(xai.configure({ apiKey: "fixture" }).video("grok-imagine-video-1.5").route.id).toBe("xai-video")
    expect(google.configure({ apiKey: "fixture" }).video("veo-3.1-generate-preview").route.id).toBe("google-video")
    expect(runway.configure({ apiKey: "fixture" }).video("gen4.5").route.id).toBe("runway-video")
    expect(openai.configure({ apiKey: "fixture" }).speech("gpt-4o-mini-tts").route.id).toBe("openai-speech")
    expect(google.configure({ apiKey: "fixture" }).speech("gemini-2.5-flash-preview-tts").route.id).toBe(
      "google-speech",
    )
    expect(elevenlabs.configure({ apiKey: "fixture" }).speech("eleven_flash_v2_5").route.id).toBe("elevenlabs-speech")
    expect(cartesia.configure({ apiKey: "fixture" }).speech("sonic-3").route.id).toBe("cartesia-speech")
    expect(deepgram.configure({ apiKey: "fixture" }).speech("aura-2-thalia-en").route.id).toBe("deepgram-speech")
    expect(openai.configure({ apiKey: "fixture" }).transcription("gpt-transcribe").route.kind).toBe("stream")
    expect(google.configure({ apiKey: "fixture" }).transcription("gemini-3.5-transcribe").route.kind).toBe("stream")
    expect(deepgram.configure({ apiKey: "fixture" }).transcription("nova-3").route.kind).toBe("inline")
    expect(assemblyai.configure({ apiKey: "fixture" }).transcription("universal-3-5-pro").route.kind).toBe("queued")
    expect(elevenlabs.configure({ apiKey: "fixture" }).transcription("scribe_v2").route.id).toBe(
      "elevenlabs-transcription",
    )
    expect(elevenlabs.configure({ apiKey: "fixture" }).transcription("scribe_v2").route.kind).toBe("inline")
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
