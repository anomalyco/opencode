import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { HttpRecorder, Redactor } from "@opencode-ai/http-recorder"
import { describe, expect, test } from "bun:test"
import { tool, type ModelMessage, type JSONValue } from "ai"
import { Effect, Layer, Option, Schema, Stream } from "effect"
import path from "node:path"
import z from "zod"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"

import { Filesystem } from "@/util/filesystem"
import { LLMEvent, LLMResponse } from "@opencode-ai/llm"
import { LLMClient, RequestExecutor, WebSocketExecutor } from "@opencode-ai/llm/route"
import { Env } from "@/env"
import { RuntimeFlags } from "@/effect/runtime-flags"
import type { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, SessionID } from "../../src/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures/recordings")

const zenURL = (connection: string) => `https://console.opencode.ai/proxy/connections/${connection}/v1`

const replayOpenAIOAuth = {
  type: "oauth",
  refresh: "fixture-refresh-token",
  access: "fixture-access-token",
  expires: Date.now() + 60 * 60 * 1000,
  accountId: "fixture-account",
} satisfies Auth.Info

type RecordedScenario = {
  readonly id: string
  readonly name: string
  readonly providerID: ProviderV2.ID
  readonly modelID: string
  readonly cassette: string
  readonly protocol: string
  readonly tags: ReadonlyArray<string>
  readonly canRecord: () => boolean
  readonly recordAuth?: () => Auth.Info | undefined
  readonly replayAuth?: Auth.Info
  readonly stableID?: string
  readonly config: (model: ModelsDev.Provider["models"][string]) => Partial<ConfigV1.Info>
}

const cloneModel = (model: ModelsDev.Provider["models"][string]) => {
  const cloned = structuredClone(model)
  const { experimental, ...rest } = cloned
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- The config schema accepts the same model shape except object-valued experimental metadata.
  if (typeof experimental === "boolean")
    return cloned as NonNullable<NonNullable<ConfigV1.Info["provider"]>[string]["models"]>[string]
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Dropping non-boolean experimental metadata makes the fixture model match config input.
  return rest as NonNullable<NonNullable<ConfigV1.Info["provider"]>[string]["models"]>[string]
}

const envValue = (...names: string[]) => names.map((name) => process.env[name]).find(Boolean)
const decodeAuth = Schema.decodeUnknownOption(Auth.Info)
const recordOpenAIOAuth = (() => {
  let loaded = false
  let auth: Auth.Info | undefined
  return () => {
    if (loaded) return auth
    loaded = true
    auth = decodeRecordOpenAIOAuth()
    return auth
  }
})()

function decodeRecordOpenAIOAuth() {
  const value = process.env.OPENCODE_RECORD_OPENAI_AUTH
  if (!value) return undefined
  try {
    const auth = Option.getOrUndefined(decodeAuth(JSON.parse(value)))
    return auth?.type === "oauth" ? auth : undefined
  } catch {
    return undefined
  }
}

const providerConfig = (input: {
  readonly providerID: ProviderV2.ID
  readonly name: string
  readonly env: string[]
  readonly npm: string
  readonly api: string
  readonly model: ModelsDev.Provider["models"][string]
  readonly options: Record<string, unknown>
}): Partial<ConfigV1.Info> => ({
  enabled_providers: [input.providerID],
  provider: {
    [input.providerID]: {
      name: input.name,
      env: input.env,
      npm: input.npm,
      api: input.api,
      models: { [input.model.id]: cloneModel(input.model) },
      options: input.options,
    },
  },
})

const RECORDED_SCENARIOS = [
  {
    id: "openai-api-key",
    name: "OpenAI API key",
    providerID: ProviderV2.ID.openai,
    modelID: "gpt-4.1-mini",
    cassette: "session/native-openai-tool-loop",
    protocol: "openai-responses",
    tags: ["opencode", "native", "tool-loop"],
    canRecord: () => Boolean(envValue("OPENCODE_RECORD_OPENAI_API_KEY", "OPENAI_API_KEY")),
    config: (model) =>
      providerConfig({
        providerID: ProviderV2.ID.openai,
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        npm: "@ai-sdk/openai",
        api: "https://api.openai.com/v1",
        model,
        options: {
          apiKey: envValue("OPENCODE_RECORD_OPENAI_API_KEY", "OPENAI_API_KEY") ?? "fixture-openai-key",
          baseURL: "https://api.openai.com/v1",
        },
      }),
  },
  {
    id: "openai-oauth",
    name: "OpenAI OAuth",
    providerID: ProviderV2.ID.openai,
    modelID: "gpt-5.5",
    cassette: "session/native-openai-oauth-tool-loop",
    protocol: "openai-responses",
    tags: ["opencode", "native", "oauth", "tool-loop"],
    canRecord: () => recordOpenAIOAuth() !== undefined,
    recordAuth: recordOpenAIOAuth,
    replayAuth: replayOpenAIOAuth,
    stableID: "openai-oauth",
    config: (model) =>
      providerConfig({
        providerID: ProviderV2.ID.openai,
        name: "OpenAI",
        env: ["OPENAI_API_KEY"],
        npm: "@ai-sdk/openai",
        api: "https://api.openai.com/v1",
        model,
        options: { baseURL: "https://api.openai.com/v1" },
      }),
  },
  {
    id: "opencode-proxy",
    name: "OpenCode proxy",
    providerID: ProviderV2.ID.opencode,
    modelID: "gpt-5.2-codex",
    cassette: "session/native-zen-tool-loop",
    protocol: "openai-responses",
    tags: ["opencode", "zen", "native", "tool-loop"],
    canRecord: () => Boolean(process.env.OPENCODE_RECORD_CONSOLE_TOKEN && process.env.OPENCODE_RECORD_ZEN_ORG_ID),
    config: (model) =>
      providerConfig({
        providerID: ProviderV2.ID.opencode,
        name: "OpenCode Zen",
        env: ["OPENCODE_CONSOLE_TOKEN"],
        npm: "@ai-sdk/openai-compatible",
        api: zenURL(process.env.OPENCODE_RECORD_ZEN_CONNECTION ?? "fixture"),
        model,
        options: {
          apiKey: process.env.OPENCODE_RECORD_CONSOLE_TOKEN ?? "fixture-console-token",
          headers: { "x-org-id": process.env.OPENCODE_RECORD_ZEN_ORG_ID ?? "fixture-org" },
        },
      }),
  },
  {
    id: "anthropic-api-key",
    name: "Anthropic API key",
    providerID: ProviderV2.ID.anthropic,
    modelID: "claude-haiku-4-5-20251001",
    cassette: "session/native-anthropic-tool-loop",
    protocol: "anthropic-messages",
    tags: ["opencode", "native", "tool-loop"],
    canRecord: () => Boolean(envValue("OPENCODE_RECORD_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")),
    config: (model) =>
      providerConfig({
        providerID: ProviderV2.ID.anthropic,
        name: "Anthropic",
        env: ["ANTHROPIC_API_KEY"],
        npm: "@ai-sdk/anthropic",
        api: "https://api.anthropic.com/v1",
        model,
        options: {
          apiKey: envValue("OPENCODE_RECORD_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY") ?? "fixture-anthropic-key",
          baseURL: "https://api.anthropic.com/v1",
        },
      }),
  },
] satisfies ReadonlyArray<RecordedScenario>

const shouldRecord = process.env.RECORD === "true"
const selectedScenarios = new Set(
  (envValue("OPENCODE_RECORDED_SCENARIO", "RECORDED_PROVIDER") ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
)

function isSelected(scenario: RecordedScenario) {
  if (selectedScenarios.size === 0) return true
  return [scenario.id, scenario.name, scenario.providerID, scenario.cassette, ...scenario.tags]
    .map((item) => item.toLowerCase())
    .some((item) => selectedScenarios.has(item))
}

const canRun = (scenario: RecordedScenario) =>
  shouldRecord ? scenario.canRecord() : HttpRecorder.hasCassetteSync(scenario.cassette, { directory: FIXTURES_DIR })

const recordError = (scenario: RecordedScenario) =>
  scenario.id === "openai-oauth"
    ? "Set OPENCODE_RECORD_OPENAI_AUTH to an OAuth auth JSON object in the recording environment."
    : `Missing recording credentials for ${scenario.name}.`

const redactRecordedBody = (body: string) =>
  body
    .replace(/wrk_[A-Z0-9]+/g, "wrk_redacted")
    .replace(/"safety_identifier"\s*:\s*"user-[^"]+"/g, '"safety_identifier":"user_redacted"')
    .replace(/"(access|access_token|refresh|refresh_token|accountId|account_id)"\s*:\s*"[^"]+"/g, '"$1":"redacted"')

const recordingRedactor = Redactor.compose(
  Redactor.defaults({
    url: {
      transform: (url) => url.replace(/\/proxy\/connections\/[^/]+\/v1/, "/proxy/connections/{connection}/v1"),
    },
  }),
  {
    request: (snapshot) => ({ ...snapshot, body: redactRecordedBody(snapshot.body) }),
    response: (snapshot) => ({ ...snapshot, body: redactRecordedBody(snapshot.body) }),
  },
)

function authLayer(scenario: RecordedScenario) {
  const replayAuth = shouldRecord ? scenario.recordAuth?.() : scenario.replayAuth
  if (!replayAuth) return Auth.defaultLayer
  return Layer.mock(Auth.Service)({
    get: (providerID) => Effect.succeed(providerID === scenario.providerID ? replayAuth : undefined),
    all: () => Effect.succeed({ [scenario.providerID]: replayAuth }),
  })
}

async function loadFixture(providerID: string, modelID: string) {
  const data = await modelsFixture
  const provider = data[providerID]
  if (!provider) throw new Error(`Missing provider in fixture: ${providerID}`)
  const model = provider.models[modelID]
  if (!model) throw new Error(`Missing model in fixture: ${modelID}`)
  return model
}

const modelsFixture = Filesystem.readJson<Record<string, ModelsDev.Provider>>(
  path.join(import.meta.dir, "../tool/fixtures/models-api.json"),
)

function recordedNativeLLMLayer(scenario: RecordedScenario) {
  const auth = authLayer(scenario)
  const provider = Provider.layer.pipe(
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Env.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(auth),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(ModelsDev.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
  )
  // Only the HTTP client is recorded; RequestExecutor and the opencode LLM stack remain real.
  const recordedHttp = HttpRecorder.cassetteLayer(scenario.cassette, {
    directory: FIXTURES_DIR,
    mode: shouldRecord ? "record" : "replay",
    metadata: {
      provider: scenario.providerID,
      protocol: scenario.protocol,
      route: scenario.protocol,
      tags: scenario.tags,
    },
    redactor: recordingRedactor,
  })
  const recordedClient = LLMClient.layer.pipe(
    Layer.provide(Layer.mergeAll(RequestExecutor.layer.pipe(Layer.provide(recordedHttp)), WebSocketExecutor.layer)),
  )

  return Layer.mergeAll(
    provider,
    LLM.layer.pipe(
      Layer.provide(auth),
      Layer.provide(Config.defaultLayer),
      Layer.provide(provider),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(recordedClient),
      Layer.provide(RuntimeFlags.layer({ experimentalNativeLlm: true })),
    ),
  )
}

const writeConfig = (directory: string, scenario: RecordedScenario, model: ModelsDev.Provider["models"][string]) =>
  Effect.promise(() =>
    Bun.write(
      path.join(directory, "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", ...scenario.config(model) }),
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
  events: ReadonlyArray<LLMEvent>,
  call: { readonly id: string; readonly name: string; readonly input: unknown },
  result: JSONValue,
): ModelMessage[] => [
  {
    role: "assistant",
    content: [
      ...events.filter(LLMEvent.is.reasoningEnd).map((part) => ({
        type: "reasoning" as const,
        text: events
          .filter(LLMEvent.is.reasoningDelta)
          .filter((event) => event.id === part.id)
          .map((event) => event.text)
          .join(""),
        providerMetadata: part.providerMetadata,
      })),
      { type: "tool-call", toolCallId: call.id, toolName: call.name, input: call.input },
    ],
  },
  {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: call.id, toolName: call.name, output: { type: "json", value: result } },
    ],
  },
]

const driveToolLoop = (scenario: RecordedScenario) =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const model = yield* Effect.promise(() => loadFixture(scenario.providerID, scenario.modelID))
    yield* writeConfig(test.directory, scenario, model)

    const stableID = scenario.stableID ?? scenario.providerID
    const sessionID = SessionID.make(`session-recorded-${stableID}-loop`)
    const modelID = ProviderV2.ModelID.make(model.id)
    const agent = {
      name: "test",
      mode: "primary",
      prompt: "Answer using tools when appropriate.",
      options: {},
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      temperature: 0,
    } satisfies Agent.Info
    const provider = yield* Provider.Service
    const resolved = yield* provider.getModel(scenario.providerID, modelID)

    const userMessage = { role: "user", content: WEATHER_USER } satisfies ModelMessage
    const base = {
      user: {
        id: MessageID.make(`msg_user-recorded-${stableID}-loop`),
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: agent.name,
        model: { providerID: scenario.providerID, modelID },
      } satisfies SessionV1.User,
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
      messages: [userMessage, ...toolRoundtrip(turn1, toolCall!, WEATHER_RESULT)],
    })

    expect(LLMResponse.text({ events: turn2 })).toMatch(/Paris is sunny/i)
    expect(turn2.filter(LLMEvent.is.finish)).toHaveLength(1)
    expect(turn2.filter(LLMEvent.is.toolCall)).toHaveLength(0)
  })

describe("session.llm native recorded", () => {
  for (const scenario of RECORDED_SCENARIOS.filter(isSelected)) {
    if (!canRun(scenario)) {
      if (shouldRecord && scenario.recordAuth && selectedScenarios.size > 0) {
        test(`${scenario.name}: drives a tool loop to a final text answer`, () => {
          throw new Error(recordError(scenario))
        })
        continue
      }
      test.skip(`${scenario.name}: drives a tool loop to a final text answer`, () => {})
      continue
    }
    const it = testEffect(recordedNativeLLMLayer(scenario))
    it.instance(`${scenario.name}: drives a tool loop to a final text answer`, () => driveToolLoop(scenario))
  }
})
