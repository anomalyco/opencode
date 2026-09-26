import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  AIClient,
  AIError,
  Generation,
  Image,
  ImageClient,
  LanguageModel,
  LLM,
  LLMClient,
  Media,
  Provider,
  Speech,
  SpeechClient,
  SpeechEvent,
  TranscriptionClient,
  Video,
  VideoClient,
} from "@opencode/ai"
import { Route, Protocol, RequestExecutor, WebSocketTransport } from "@opencode/ai/route"
import { Provider as ProviderSubpath } from "@opencode/ai/provider"
import {
  AssemblyAI,
  Baseten,
  BlackForestLabs,
  Cartesia,
  CloudflareAIGateway,
  CloudflareWorkersAI,
  Deepgram,
  DeepSeek,
  ElevenLabs,
  Fal,
  Fireworks,
  Google,
  Meta,
  OpenCodeZen,
  OpenAI,
  OpenAICompatible,
  OpenRouter,
  Replicate,
  Runway,
  Stability,
  TypeSafeAI,
  VercelAIGateway,
  XAI,
  ZAI,
} from "@opencode/ai/providers"
import {
  OpenAIChat,
  OpenAICompatibleChat,
  OpenAICompatibleResponses,
  OpenAIResponses,
  OpenResponses,
  OpenResponsesChannel,
} from "@opencode/ai/protocols"
import * as AnthropicMessages from "@opencode/ai/protocols/anthropic-messages"
import { TestLLM } from "@opencode/ai/testing"
import { Evaluation, EvaluationClient } from "@opencode/ai/experimental"

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
    expect(LLM.request).toBeFunction()
    expect(LLMClient.Service).toBeFunction()
    expect(LLMClient.layer).toBeDefined()
    expect(AIError).toBeFunction()
    expect(LanguageModel.make).toBeFunction()
    expect(Media.bytes).toBeFunction()
    expect(Image.generate).toBeFunction()
    expect(Video.start).toBeFunction()
    expect(Video.resume).toBeFunction()
    expect(VideoClient.layer).toBeDefined()
    expect(Speech.generate).toBeFunction()
    expect(Speech.stream).toBeFunction()
    expect(SpeechClient.layer).toBeDefined()
    expect(SpeechEvent.is.audioDelta).toBeFunction()
    expect(Generation).toBeFunction()
    expect(Provider.make).toBeFunction()
    expect(ProviderSubpath.make).toBe(Provider.make)
    expect(TestLLM.layer).toBeFunction()
    expect(TestLLM.testLayer).toBeFunction()
    expect(TestLLM.Test.of).toBeFunction()
    expect(Evaluation.run).toBeFunction()
    expect(EvaluationClient.layer).toBeDefined()
    expect(EvaluationClient.fetchLayer).toBeDefined()
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
      OpenAICompatibleResponses.configure({ baseURL: "https://responses.test/v1" }).model("fixture").route.id,
    ).toBe("openai-compatible-responses")
    expect(CloudflareAIGateway.configure).toBeFunction()
    expect(CloudflareAIGateway.configure({ accountId: "fixture", gatewayApiKey: "fixture" }).model).toBeFunction()
    expect(CloudflareWorkersAI.configure).toBeFunction()
    expect(CloudflareWorkersAI.configure({ accountId: "fixture", apiKey: "fixture" }).model).toBeFunction()
    expect(OpenRouter.model).toBeFunction()
    expect(OpenRouter.experimental.evaluation).toBeFunction()
    expect(TypeSafeAI.experimental.evaluation).toBeFunction()
    expect(OpenCodeZen.experimental.evaluation).toBeFunction()
    expect(VercelAIGateway.experimental.evaluation).toBeFunction()
    expect(XAI.model).toBeFunction()
    expect(XAI.provider.responses).toBe(XAI.responses)
    expect(XAI.provider.chat).toBe(XAI.chat)
    expect(XAI.configure({ apiKey: "fixture" }).responses("grok-4.3").route.id).toBe("openai-responses")
    expect(XAI.configure({ apiKey: "fixture" }).chat("grok-4.3").route.id).toBe("openai-compatible-chat")
    expect(OpenAI.configure({ apiKey: "fixture" }).image("gpt-image-2").route.id).toBe("openai-images")
    expect(OpenAI.provider.image).toBe(OpenAI.image)
    expect(Google.configure({ apiKey: "fixture" }).image("imagen-4.0-generate-001").route.id).toBe("google-images")
    expect(Google.provider.image).toBe(Google.image)
    expect(XAI.configure({ apiKey: "fixture" }).image("grok-imagine-image").route.id).toBe("xai-images")
    expect(XAI.provider.image).toBe(XAI.image)
    expect(Fal.configure({ apiKey: "fixture" }).image("fal-ai/flux/dev").route.id).toBe("fal-images")
    expect(Fal.provider.image).toBe(Fal.image)
    expect(BlackForestLabs.configure({ apiKey: "fixture" }).image("flux-2-pro").route.id).toBe("bfl-images")
    expect(BlackForestLabs.provider.image).toBe(BlackForestLabs.image)
    expect(Replicate.configure({ apiKey: "fixture" }).image("black-forest-labs/flux-schnell").route.id).toBe(
      "replicate-images",
    )
    expect(Replicate.provider.image).toBe(Replicate.image)
    expect(Stability.configure({ apiKey: "fixture" }).image("sd3.5-large").route.id).toBe("stability-images")
    expect(Stability.provider.image).toBe(Stability.image)
    expect(Stability.configure({ apiKey: "fixture" }).upscale().route.id).toBe("stability-upscale")
    expect(Stability.provider.upscale).toBe(Stability.upscale)
    expect(Meta.configure({ apiKey: "fixture" }).image("muse-image").route.id).toBe("meta-images")
    expect(Meta.provider.image).toBe(Meta.image)
    expect(ZAI.configure({ apiKey: "fixture" }).image("glm-image").route.id).toBe("zai-images")
    expect(ZAI.provider.image).toBe(ZAI.image)
    expect(XAI.configure({ apiKey: "fixture" }).video("grok-imagine-video-1.5").route.id).toBe("xai-video")
    expect(XAI.provider.video).toBe(XAI.video)
    expect(Google.configure({ apiKey: "fixture" }).video("veo-3.1-generate-preview").route.id).toBe("google-video")
    expect(Google.provider.video).toBe(Google.video)
    expect(Fal.configure({ apiKey: "fixture" }).video("fal-ai/veo3.1").route.id).toBe("fal-video")
    expect(Fal.provider.video).toBe(Fal.video)
    expect(Runway.configure({ apiKey: "fixture" }).video("gen4.5").route.id).toBe("runway-video")
    expect(Runway.provider.video).toBe(Runway.video)
    expect(OpenAI.configure({ apiKey: "fixture" }).speech("gpt-4o-mini-tts").route.id).toBe("openai-speech")
    expect(Google.configure({ apiKey: "fixture" }).speech("gemini-2.5-flash-preview-tts").route.id).toBe(
      "google-speech",
    )
    expect(ElevenLabs.configure({ apiKey: "fixture" }).speech("eleven_flash_v2_5").route.id).toBe("elevenlabs-speech")
    expect(Cartesia.configure({ apiKey: "fixture" }).speech("sonic-3").route.id).toBe("cartesia-speech")
    expect(Deepgram.configure({ apiKey: "fixture" }).speech("aura-2-thalia-en").route.id).toBe("deepgram-speech")
    expect(OpenAI.configure({ apiKey: "fixture" }).transcription("gpt-transcribe").route.kind).toBe("stream")
    expect(Google.configure({ apiKey: "fixture" }).transcription("gemini-3.5-transcribe").route.kind).toBe("stream")
    expect(Deepgram.configure({ apiKey: "fixture" }).transcription("nova-3").route.kind).toBe("inline")
    expect(AssemblyAI.configure({ apiKey: "fixture" }).transcription("universal-3-5-pro").route.kind).toBe("queued")
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
