import { NodeFileSystem } from "@effect/platform-node"
import { HttpRecorder, Redactor } from "@opencode-ai/http-recorder"
import { describe, expect } from "bun:test"
import { tool, type ModelMessage, type JSONValue } from "ai"
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
import { LLMEvent, LLMResponse } from "@opencode-ai/llm"
import { LLMClient, RequestExecutor, WebSocketExecutor } from "@opencode-ai/llm/route"
import { RuntimeFlags } from "@/effect/runtime-flags"
import type { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, SessionID } from "../../src/session/schema"
import type { ModelsDev } from "@opencode-ai/core/models-dev"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures/recordings")

const zenURL = (connection: string) => `https://console.opencode.ai/proxy/connections/${connection}/v1`

type ProviderSpec = {
  readonly providerID: ProviderID
  readonly modelID: string
  readonly cassette: string
  readonly protocol: string
  readonly tags: ReadonlyArray<string>
  readonly canRecord: boolean
  readonly config: (model: ModelsDev.Provider["models"][string]) => Partial<Config.Info>
}

const cloneModel = (model: ModelsDev.Provider["models"][string]) =>
  structuredClone(model) as NonNullable<NonNullable<Config.Info["provider"]>[string]["models"]>[string]

const PROVIDERS = {
  openai: {
    providerID: ProviderID.openai,
    modelID: "gpt-4.1-mini",
    cassette: "session/native-openai-tool-loop",
    protocol: "openai-responses",
    tags: ["opencode", "native", "tool-loop"],
    canRecord: Boolean(process.env.OPENCODE_RECORD_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY),
    config: (model) => ({
      enabled_providers: ["openai"],
      provider: {
        openai: {
          name: "OpenAI",
          env: ["OPENAI_API_KEY"],
          npm: "@ai-sdk/openai",
          api: "https://api.openai.com/v1",
          models: { [model.id]: cloneModel(model) },
          options: {
            apiKey: process.env.OPENCODE_RECORD_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "fixture-openai-key",
            baseURL: "https://api.openai.com/v1",
          },
        },
      },
    }),
  },
  opencode: {
    providerID: ProviderID.opencode,
    modelID: "gpt-5.2-codex",
    cassette: "session/native-zen-tool-loop",
    protocol: "openai-responses",
    tags: ["opencode", "zen", "native", "tool-loop"],
    canRecord: Boolean(process.env.OPENCODE_RECORD_CONSOLE_TOKEN && process.env.OPENCODE_RECORD_ZEN_ORG_ID),
    config: (model) => ({
      enabled_providers: ["opencode"],
      provider: {
        opencode: {
          name: "OpenCode Zen",
          env: ["OPENCODE_CONSOLE_TOKEN"],
          npm: "@ai-sdk/openai-compatible",
          // The connection slug is account-specific; the cassette redactor
          // normalizes it to {connection} for replay. Set during recording.
          api: zenURL(process.env.OPENCODE_RECORD_ZEN_CONNECTION ?? "fixture"),
          models: { [model.id]: cloneModel(model) },
          options: {
            apiKey: process.env.OPENCODE_RECORD_CONSOLE_TOKEN ?? "fixture-console-token",
            headers: { "x-org-id": process.env.OPENCODE_RECORD_ZEN_ORG_ID ?? "fixture-org" },
          },
        },
      },
    }),
  },
  anthropic: {
    providerID: ProviderID.anthropic,
    modelID: "claude-haiku-4-5-20251001",
    cassette: "session/native-anthropic-tool-loop",
    protocol: "anthropic-messages",
    tags: ["opencode", "native", "tool-loop"],
    canRecord: Boolean(process.env.OPENCODE_RECORD_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY),
    config: (model) => ({
      enabled_providers: ["anthropic"],
      provider: {
        anthropic: {
          name: "Anthropic",
          env: ["ANTHROPIC_API_KEY"],
          npm: "@ai-sdk/anthropic",
          api: "https://api.anthropic.com/v1",
          models: { [model.id]: cloneModel(model) },
          options: {
            apiKey:
              process.env.OPENCODE_RECORD_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "fixture-anthropic-key",
            baseURL: "https://api.anthropic.com/v1",
          },
        },
      },
    }),
  },
} satisfies Record<string, ProviderSpec>

const shouldRecord = process.env.RECORD === "true"

const canRun = (spec: ProviderSpec) =>
  shouldRecord ? spec.canRecord : HttpRecorder.hasCassetteSync(spec.cassette, { directory: FIXTURES_DIR })

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

function recordedNativeLLMLayer(spec: ProviderSpec) {
  // Only the HTTP client is recorded; RequestExecutor and the opencode LLM stack remain real.
  const recordedClient = LLMClient.layer.pipe(
    Layer.provide(Layer.mergeAll(RequestExecutor.layer, WebSocketExecutor.layer)),
    Layer.provide(
      HttpRecorder.recordingLayer(spec.cassette, {
        mode: shouldRecord ? "record" : "replay",
        metadata: { provider: spec.providerID, protocol: spec.protocol, route: spec.protocol, tags: spec.tags },
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
      }).pipe(Layer.provide(FetchHttpClient.layer)),
    ),
  )

  return Layer.mergeAll(
    Provider.defaultLayer.pipe(
      Layer.provide(Auth.defaultLayer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
    ),
    LLM.layer.pipe(
      Layer.provide(Auth.defaultLayer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(recordedClient),
      Layer.provide(
        HttpRecorder.Cassette.fileSystem({ directory: FIXTURES_DIR }).pipe(Layer.provide(NodeFileSystem.layer)),
      ),
      Layer.provide(RuntimeFlags.layer({ experimentalNativeLlm: true })),
    ),
  )
}

const writeConfig = (directory: string, spec: ProviderSpec, model: ModelsDev.Provider["models"][string]) =>
  Effect.promise(() =>
    Bun.write(
      path.join(directory, "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", ...spec.config(model) }),
    ),
  )

const collect = (input: LLM.StreamInput) =>
  Effect.gen(function* () {
    const llm = yield* LLM.Service
    return Array.from(yield* llm.stream(input).pipe(Stream.runCollect))
  })

const WEATHER_RESULT = { temperature: 22, condition: "sunny" } as const
const WEATHER_SYSTEM =
  "Use the get_weather tool exactly once to look up Paris, then reply with exactly: Paris is sunny."
const WEATHER_USER = "What is the weather in Paris?"

const weatherTool = tool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({ city: z.string() }),
  execute: async () => WEATHER_RESULT,
})

const toolRoundtrip = (
  call: { readonly id: string; readonly name: string; readonly input: unknown },
  result: JSONValue,
): ModelMessage[] => [
  { role: "assistant", content: [{ type: "tool-call", toolCallId: call.id, toolName: call.name, input: call.input }] },
  {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: call.id, toolName: call.name, output: { type: "json", value: result } },
    ],
  },
]

const driveToolLoop = (spec: ProviderSpec) =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const model = yield* Effect.promise(() => loadFixture(spec.providerID, spec.modelID))
    yield* writeConfig(test.directory, spec, model)

    const sessionID = SessionID.make(`session-recorded-${spec.providerID}-loop`)
    const modelID = ModelID.make(model.id)
    const agent = {
      name: "test",
      mode: "primary",
      prompt: "Answer using tools when appropriate.",
      options: {},
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      temperature: 0,
    } satisfies Agent.Info
    const provider = yield* Provider.Service
    const resolved = yield* provider.getModel(spec.providerID, modelID)

    const userMessage = { role: "user", content: WEATHER_USER } satisfies ModelMessage
    const base = {
      user: {
        id: MessageID.make(`msg_user-recorded-${spec.providerID}-loop`),
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: agent.name,
        model: { providerID: spec.providerID, modelID },
      } satisfies MessageV2.User,
      sessionID,
      model: resolved,
      agent,
      system: [WEATHER_SYSTEM],
      tools: { get_weather: weatherTool },
    }

    const turn1 = yield* collect({ ...base, messages: [userMessage] })
    const toolCall = turn1.find(LLMEvent.is.toolCall)
    expect(toolCall).toBeDefined()
    expect(turn1.find(LLMEvent.is.toolResult)).toBeDefined()
    expect(toolCall!.name).toBe("get_weather")
    expect(toolCall!.input).toMatchObject({ city: expect.stringMatching(/Paris/i) })
    expect(turn1.filter(LLMEvent.is.stepFinish)).toHaveLength(1)

    const turn2 = yield* collect({
      ...base,
      messages: [userMessage, ...toolRoundtrip(toolCall!, WEATHER_RESULT)],
    })

    expect(LLMResponse.text({ events: turn2 })).toMatch(/Paris is sunny/i)
    expect(turn2.filter(LLMEvent.is.finish)).toHaveLength(1)
    expect(turn2.filter(LLMEvent.is.toolCall)).toHaveLength(0)
  })

describe("session.llm native recorded", () => {
  for (const [name, spec] of Object.entries(PROVIDERS)) {
    const it = testEffect(recordedNativeLLMLayer(spec))
    const instance = canRun(spec) ? it.instance : it.instance.skip
    instance(`${name}: drives a tool loop to a final text answer`, () => driveToolLoop(spec))
  }
})
