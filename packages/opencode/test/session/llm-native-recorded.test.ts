import { NodeFileSystem } from "@effect/platform-node"
import { HttpRecorder, Redactor } from "@opencode-ai/http-recorder"
import { describe, expect } from "bun:test"
import { tool, type ModelMessage } from "ai"
import { Effect, Layer, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import path from "node:path"
import z from "zod"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Filesystem } from "@/util/filesystem"
import { LLMClient, RequestExecutor } from "@opencode-ai/llm/route"
import { RuntimeFlags } from "@/effect/runtime-flags"
import type { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, SessionID } from "../../src/session/schema"
import type { ModelsDev } from "@opencode-ai/core/models-dev"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const OPENAI_CASSETTE = "session/native-openai-tool-loop"
const ZEN_CASSETTE = "session/native-zen-tool-loop"
const ANTHROPIC_CASSETTE = "session/native-anthropic-tool-loop"
const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures/recordings")
const OPENAI_API_KEY = process.env.OPENCODE_RECORD_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY
const CONSOLE_TOKEN = process.env.OPENCODE_RECORD_CONSOLE_TOKEN
const ZEN_ORG_ID = process.env.OPENCODE_RECORD_ZEN_ORG_ID
const ZEN_API_URL =
  process.env.OPENCODE_RECORD_ZEN_API_URL ?? "https://console.opencode.ai/proxy/connections/fixture/v1"
const ANTHROPIC_API_KEY = process.env.OPENCODE_RECORD_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY

const shouldRecord = process.env.RECORD === "true"
const canRunOpenAI = shouldRecord
  ? Boolean(OPENAI_API_KEY)
  : HttpRecorder.hasCassetteSync(OPENAI_CASSETTE, { directory: FIXTURES_DIR })
const canRunZen = shouldRecord
  ? Boolean(CONSOLE_TOKEN && ZEN_ORG_ID)
  : HttpRecorder.hasCassetteSync(ZEN_CASSETTE, { directory: FIXTURES_DIR })
const canRunAnthropic = shouldRecord
  ? Boolean(ANTHROPIC_API_KEY)
  : HttpRecorder.hasCassetteSync(ANTHROPIC_CASSETTE, { directory: FIXTURES_DIR })

async function loadFixture(providerID: string, modelID: string) {
  const data = await Filesystem.readJson<Record<string, ModelsDev.Provider>>(
    path.join(import.meta.dir, "../tool/fixtures/models-api.json"),
  )
  const provider = data[providerID]
  if (!provider) throw new Error(`Missing provider in fixture: ${providerID}`)
  const model = provider.models[modelID]
  if (!model) throw new Error(`Missing model in fixture: ${modelID}`)
  return model
}

const openAIConfig = (model: ModelsDev.Provider["models"][string]): Partial<Config.Info> => ({
  enabled_providers: ["openai"],
  provider: {
    openai: {
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      npm: "@ai-sdk/openai",
      api: "https://api.openai.com/v1",
      models: {
        [model.id]: JSON.parse(JSON.stringify(model)) as NonNullable<
          NonNullable<Config.Info["provider"]>[string]["models"]
        >[string],
      },
      options: {
        apiKey: OPENAI_API_KEY ?? "fixture-openai-key",
        baseURL: "https://api.openai.com/v1",
      },
    },
  },
})

const anthropicConfig = (model: ModelsDev.Provider["models"][string]): Partial<Config.Info> => ({
  enabled_providers: ["anthropic"],
  provider: {
    anthropic: {
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      npm: "@ai-sdk/anthropic",
      api: "https://api.anthropic.com/v1",
      models: {
        [model.id]: JSON.parse(JSON.stringify(model)) as NonNullable<
          NonNullable<Config.Info["provider"]>[string]["models"]
        >[string],
      },
      options: {
        apiKey: ANTHROPIC_API_KEY ?? "fixture-anthropic-key",
        baseURL: "https://api.anthropic.com/v1",
      },
    },
  },
})

const zenConfig = (model: ModelsDev.Provider["models"][string]): Partial<Config.Info> => ({
  enabled_providers: ["opencode"],
  provider: {
    opencode: {
      name: "OpenCode Zen",
      env: ["OPENCODE_CONSOLE_TOKEN"],
      npm: "@ai-sdk/openai-compatible",
      api: ZEN_API_URL,
      models: {
        [model.id]: JSON.parse(JSON.stringify(model)) as NonNullable<
          NonNullable<Config.Info["provider"]>[string]["models"]
        >[string],
      },
      options: {
        apiKey: CONSOLE_TOKEN ?? "fixture-console-token",
        headers: {
          "x-org-id": ZEN_ORG_ID ?? "fixture-org",
        },
      },
    },
  },
})

function recordedNativeLLMLayer(cassette: string, metadata: Record<string, unknown>) {
  const cassetteService = HttpRecorder.Cassette.fileSystem({ directory: FIXTURES_DIR }).pipe(
    Layer.provide(NodeFileSystem.layer),
  )
  // Only the HTTP client is recorded; RequestExecutor and the opencode LLM stack remain real.
  const recorder = HttpRecorder.recordingLayer(cassette, {
    mode: shouldRecord ? "record" : "replay",
    metadata,
    redactor: Redactor.compose(
      Redactor.defaults({
        url: {
          transform: (url) => url.replace(/\/proxy\/connections\/[^/]+\/v1/, "/proxy/connections/{connection}/v1"),
        },
      }),
      {
        response: (snapshot) => ({ ...snapshot, body: snapshot.body.replace(/wrk_[A-Z0-9]+/g, "wrk_redacted") }),
      },
    ),
  }).pipe(Layer.provide(FetchHttpClient.layer))
  const executor = RequestExecutor.layer.pipe(Layer.provide(recorder))
  const client = LLMClient.layer.pipe(Layer.provide(executor))

  const providerLayer = Provider.defaultLayer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
  )
  const llmLayer = LLM.layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(client),
    Layer.provide(cassetteService),
    Layer.provide(RuntimeFlags.layer({ experimentalNativeLlm: true })),
  )

  return Layer.mergeAll(providerLayer, llmLayer)
}

const openAIIt = testEffect(
  recordedNativeLLMLayer(OPENAI_CASSETTE, {
    provider: "openai",
    protocol: "openai-responses",
    route: "openai-responses",
    tags: ["opencode", "native", "tool-loop"],
  }),
)
const zenIt = testEffect(
  recordedNativeLLMLayer(ZEN_CASSETTE, {
    provider: "opencode",
    protocol: "openai-responses",
    route: "openai-responses",
    tags: ["opencode", "zen", "native", "tool-loop"],
  }),
)
const anthropicIt = testEffect(
  recordedNativeLLMLayer(ANTHROPIC_CASSETTE, {
    provider: "anthropic",
    protocol: "anthropic-messages",
    route: "anthropic-messages",
    tags: ["opencode", "native", "tool-loop"],
  }),
)
const recordedOpenAIInstance = canRunOpenAI ? openAIIt.instance : openAIIt.instance.skip
const recordedZenInstance = canRunZen ? zenIt.instance : zenIt.instance.skip
const recordedAnthropicInstance = canRunAnthropic ? anthropicIt.instance : anthropicIt.instance.skip

const writeConfig = (
  directory: string,
  model: ModelsDev.Provider["models"][string],
  config: (model: ModelsDev.Provider["models"][string]) => Partial<Config.Info> = openAIConfig,
) =>
  Effect.promise(() =>
    Bun.write(
      path.join(directory, "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config(model) }),
    ),
  )

const getModel = (providerID: ProviderID, modelID: ModelID) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    return yield* provider.getModel(providerID, modelID)
  })

const collect = (input: LLM.StreamInput) =>
  Effect.gen(function* () {
    const llm = yield* LLM.Service
    return Array.from(yield* llm.stream(input).pipe(Stream.runCollect))
  })

const WEATHER_RESULT = { temperature: 22, condition: "sunny" } as const
const WEATHER_SYSTEM =
  "Use the get_weather tool exactly once to look up Paris, then reply with exactly: Paris is sunny."
const WEATHER_USER = "What is the weather in Paris?"

const weatherTool = () =>
  tool({
    description: "Get the current weather for a city.",
    inputSchema: z.object({ city: z.string() }),
    execute: async () => WEATHER_RESULT,
  })

type LoopParams = {
  readonly providerID: ProviderID
  readonly modelID: string
  readonly configBuilder?: (model: ModelsDev.Provider["models"][string]) => Partial<Config.Info>
  readonly sessionPrefix: string
}

const driveToolLoop = (params: LoopParams) =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const model = yield* Effect.promise(() => loadFixture(params.providerID, params.modelID))
    yield* writeConfig(test.directory, model, params.configBuilder ?? openAIConfig)

    const sessionID = SessionID.make(`session-recorded-${params.sessionPrefix}-loop`)
    const agent = {
      name: "test",
      mode: "primary",
      prompt: "Answer using tools when appropriate.",
      options: {},
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      temperature: 0,
    } satisfies Agent.Info
    const resolved = yield* getModel(params.providerID, ModelID.make(model.id))

    const userMessage: ModelMessage = { role: "user", content: WEATHER_USER }
    const base = {
      user: {
        id: MessageID.make(`msg_user-recorded-${params.sessionPrefix}-loop`),
        sessionID,
        role: "user" as const,
        time: { created: 0 },
        agent: agent.name,
        model: { providerID: params.providerID, modelID: ModelID.make(model.id) },
      } satisfies MessageV2.User,
      sessionID,
      model: resolved,
      agent,
      system: [WEATHER_SYSTEM],
      tools: { get_weather: weatherTool() },
    }

    const turn1 = yield* collect({ ...base, messages: [userMessage] })
    const toolCall = turn1.find((event): event is Extract<(typeof turn1)[number], { type: "tool-call" }> =>
      event.type === "tool-call",
    )
    const toolResult = turn1.find((event): event is Extract<(typeof turn1)[number], { type: "tool-result" }> =>
      event.type === "tool-result",
    )
    expect(toolCall).toBeDefined()
    expect(toolResult).toBeDefined()
    expect(toolCall!.name).toBe("get_weather")
    expect(toolCall!.input).toMatchObject({ city: expect.stringMatching(/Paris/i) })
    expect(turn1.filter((event) => event.type === "step-finish")).toHaveLength(1)

    const turn2 = yield* collect({
      ...base,
      messages: [
        userMessage,
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: toolCall!.id, toolName: toolCall!.name, input: toolCall!.input },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: toolCall!.id,
              toolName: toolCall!.name,
              output: { type: "json", value: WEATHER_RESULT },
            },
          ],
        },
      ],
    })

    const text = turn2
      .filter((event): event is Extract<(typeof turn2)[number], { type: "text-delta" }> => event.type === "text-delta")
      .map((event) => event.text)
      .join("")
    expect(text).toMatch(/Paris is sunny/i)
    expect(turn2.filter((event) => event.type === "finish")).toHaveLength(1)
    expect(turn2.filter((event) => event.type === "tool-call")).toHaveLength(0)
  })

describe("session.llm native recorded", () => {
  recordedOpenAIInstance("drives a native OpenAI tool loop to a final text answer", () =>
    driveToolLoop({ providerID: ProviderID.openai, modelID: "gpt-4.1-mini", sessionPrefix: "openai" }),
  )

  recordedZenInstance("drives a native Zen tool loop to a final text answer", () =>
    driveToolLoop({
      providerID: ProviderID.opencode,
      modelID: "gpt-5.2-codex",
      configBuilder: zenConfig,
      sessionPrefix: "zen",
    }),
  )

  recordedAnthropicInstance("drives a native Anthropic tool loop to a final text answer", () =>
    driveToolLoop({
      providerID: ProviderID.anthropic,
      modelID: "claude-haiku-4-5-20251001",
      configBuilder: anthropicConfig,
      sessionPrefix: "anthropic",
    }),
  )
})
