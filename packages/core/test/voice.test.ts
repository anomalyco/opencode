import { expect } from "bun:test"
import { Realtime } from "@opencode/ai/experimental"
import { RequestExecutor } from "@opencode/ai/route"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { ID, Info, Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Voice } from "@opencode/core/voice"
import { VoiceLegacy } from "@opencode/core/voice-legacy"
import { Effect, Layer } from "effect"
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const credential = (id: string, method: "key" | "oauth") => ({
  type: "credential" as const,
  id: Credential.ID.make(id),
  label: id,
  method,
})

const keys: Record<string, string> = {
  active: "sk-active",
  stored: "sk-stored",
  XAI_API_KEY: "xai-env-key",
  GEMINI_API_KEY: "gemini-env-key",
  OPENCODE_API_KEY: "opencode-env-key",
}

// An OpenCode Console sign-in can start GPT-Live.
const resolveCredential: Integration.Interface["connection"]["resolve"] = (connection) => {
  if (connection.type === "env") return Effect.succeed(Credential.Key.make({ type: "key", key: keys[connection.name] }))
  if (connection.id === "console")
    return Effect.succeed(
      Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("device"),
        access: "console-access",
        refresh: "console-refresh",
        expires: 1,
        metadata: { orgID: "wrk_console" },
      }),
    )
  return Effect.succeed(Credential.Key.make({ type: "key", key: keys[connection.id] }))
}

const unused = () => Effect.die("unused")

// A realtime catalog model with the voice protocol that speaks to it.
const voice = (provider: string, id: string, protocol: string) =>
  Info.make({
    ...Info.default(Provider.ID.make(provider), ID.make(id)),
    type: "realtime",
    realtime: { protocol, transports: Realtime.engines.find((engine) => engine.id === protocol)?.transports ?? [] },
  })

// What Model lists with every provider connected, newest first.
const everything = [
  voice("openai", "gpt-live-1.1", "openai-live"),
  voice("xai", "grok-voice-3.0", "xai-realtime"),
  voice("google", "gemini-3.8-live", "gemini-live"),
  voice("openai", "gpt-live-1", "openai-live"),
  voice("opencode", "gpt-live-1", "openai-live"),
  voice("openai", "gpt-realtime-2.1", "openai-realtime"),
]

// Without an OpenAI key, or with a ChatGPT sign-in, OpenAI's voice models aren't listed.
const hosted = everything.filter((model) => model.providerID !== "openai")

const catalog = (listed: readonly Model.Info[]) =>
  Layer.mock(Model.Service, {
    available: (types) =>
      Effect.succeed(
        types?.includes("realtime") ? listed : [Info.make(Info.default(Provider.ID.make("openai"), ID.make("gpt-6")))],
      ),
  })

// xAI has a key in its provider settings, as `opencode.json` can set. Every provider knows its voice models.
const providers = Layer.mock(Provider.Service, {
  get: (id) =>
    Effect.succeed(
      id === "xai" ? { ...Provider.Info.empty(id), settings: { apiKey: "xai-config-key" } } : Provider.Info.empty(id),
    ),
  snapshot: () => {
    const records = new Map<Provider.ID, Provider.Definition>()
    for (const model of everything) {
      const models = new Map(records.get(model.providerID)?.models)
      models.set(model.id, model)
      records.set(model.providerID, { provider: Provider.Info.empty(model.providerID), models })
    }
    return Effect.succeed({ records, available: [], providers: [] })
  },
})

const mockIntegration = (
  connections: (id: Integration.ID) => Integration.Info["connections"],
  resolve: Integration.Interface["connection"]["resolve"] = () => Effect.die("Voice.models resolved a credential"),
) =>
  Layer.mock(Integration.Service, {
    revision: () => 0,
    get: (id) => Effect.succeed({ id, name: id, methods: [], connections: connections(id) }),
    connection: {
      active: (id) => Effect.succeed(connections(id)[0]),
      resolve,
      key: unused,
      external: unused,
      activate: unused,
      update: unused,
      remove: unused,
      status: unused,
    },
    oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
    command: { connect: unused, status: unused, cancel: unused },
  })

// Runs a voice effect with each integration's connections, recording the requests it sends upstream.
const run = <A, E>(
  effect: Effect.Effect<A, E, Voice.Service | Model.Service | Provider.Service>,
  connections: Partial<Record<string, Integration.Info["connections"]>>,
  requests: HttpClientRequest.HttpClientRequest[],
  listed: readonly Model.Info[],
) =>
  effect.pipe(
    Effect.provide(
      Voice.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            catalog(listed),
            providers,
            mockIntegration((id) => connections[id] ?? [], resolveCredential),
            RequestExecutor.layer.pipe(
              Layer.provide(
                Layer.succeed(
                  HttpClient.HttpClient,
                  HttpClient.make((req: HttpClientRequest.HttpClientRequest) =>
                    Effect.sync(() => {
                      requests.push(req)
                      return HttpClientResponse.fromWeb(
                        req,
                        req.url.includes("x.ai")
                          ? Response.json({ value: "ek_xai", expires_at: 1760000999 })
                          : req.url.includes("googleapis")
                            ? Response.json({ name: "auth_tokens/ek_gemini" })
                            : Response.json({ transport: { sdp: "v=0\r\no=answer\r\n" } }),
                      )
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )

const transport = (model: string) =>
  model.startsWith("grok-") || model.startsWith("gemini-")
    ? { type: "websocket" as const }
    : { type: "webrtc" as const, sdp: "v=0" }

// Connects the exact catalog model.
const start = (
  provider: string,
  model: string,
  connections: Partial<Record<string, Integration.Info["connections"]>>,
  requests: HttpClientRequest.HttpClientRequest[],
  listed: readonly Model.Info[] = everything,
  variant?: string,
) =>
  run(
    Effect.flatMap(Voice.Service, (voice) =>
      voice.connect({
        model: {
          id: ID.make(model),
          providerID: Provider.ID.make(provider),
          variant: variant ? Model.VariantID.make(variant) : undefined,
        },
        transport: transport(model),
      }),
    ),
    connections,
    requests,
    listed,
  )

it.effect("uses the provider's active connection or configured key, as chat models do", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1760000000_000)
    const requests: HttpClientRequest.HttpClientRequest[] = []
    yield* start(
      "openai",
      "gpt-live-1",
      { openai: [credential("active", "key"), credential("stored", "key")] },
      requests,
    )
    const grok = yield* start("xai", "grok-voice-3.0", { xai: [{ type: "env", name: "XAI_API_KEY" }] }, requests)
    yield* start("xai", "grok-voice-3.0", {}, requests)
    const gemini = yield* start(
      "google",
      "gemini-3.8-live",
      { google: [{ type: "env", name: "GEMINI_API_KEY" }] },
      requests,
    )
    expect(requests.map((req) => req.headers.authorization ?? req.headers["x-goog-api-key"])).toEqual([
      "Bearer sk-active",
      "Bearer xai-env-key",
      "Bearer xai-config-key",
      "gemini-env-key",
    ])
    expect(grok).toEqual({
      type: "websocket",
      url: "wss://api.x.ai/v1/realtime?model=grok-voice-3.0",
      token: "ek_xai",
      expiresAt: 1760000999,
    })
    expect(gemini).toEqual({
      type: "websocket",
      url: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
      token: "auth_tokens/ek_gemini",
      expiresAt: 1760000060,
    })

    const missingGoogle = yield* start("google", "gemini-3.8-live", {}, requests).pipe(Effect.flip)
    expect(missingGoogle).toMatchObject({ _tag: "Voice.UnavailableError", service: "google" })
    expect(missingGoogle.message).toContain("API key")

    const unlisted = yield* start("openai", "gpt-live-1", {}, requests, []).pipe(Effect.flip)
    expect(unlisted).toMatchObject({ _tag: "Voice.ModelNotFoundError", providerID: "openai", modelID: "gpt-live-1" })
    expect(unlisted.message).toBe("Model not found: openai/gpt-live-1")
    const chat = yield* start("openai", "gpt-6", {}, requests).pipe(Effect.flip)
    expect(chat).toMatchObject({
      _tag: "Voice.UnsupportedModelError",
      message: "openai/gpt-6 is a chat model, not a realtime model",
    })
    const variant = yield* start("openai", "gpt-live-1", {}, requests, everything, "high").pipe(Effect.flip)
    expect(variant).toMatchObject({ _tag: "Voice.InvalidRequestError", field: "model.variant" })
    expect(requests).toHaveLength(4)
  }),
)

it.effect("starts OpenCode's GPT-Live on OpenCode's hosted endpoint", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const both = { openai: [credential("active", "key")], opencode: [credential("console", "oauth")] }

    yield* start("opencode", "gpt-live-1", both, requests)
    yield* start("opencode", "gpt-live-1", { opencode: [{ type: "env", name: "OPENCODE_API_KEY" }] }, requests, hosted)
    yield* start("openai", "gpt-live-1", both, requests)
    expect(
      requests.map((req): (string | undefined)[] => [
        req.url,
        req.headers.authorization,
        req.headers["x-opencode-org-id"],
      ]),
    ).toEqual([
      ["https://opencode.ai/inference/openai/v1/live/sessions", "Bearer console-access", "wrk_console"],
      ["https://opencode.ai/inference/openai/v1/live/sessions", "Bearer opencode-env-key", undefined],
      ["https://api.openai.com/v1/live/sessions", "Bearer sk-active", undefined],
    ])
  }),
)

it.effect("keeps the deprecated voice endpoints' shape, with known models that can't start listed as unavailable", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const opencode = { opencode: [credential("console", "oauth")] }
    const list = (listed: readonly Model.Info[]) => run(VoiceLegacy.models(), {}, requests, listed)
    const session = (model: string, connections: typeof opencode | {}, listed: readonly Model.Info[]) =>
      run(VoiceLegacy.session({ model, transport: transport(model) }), connections, requests, listed)

    expect(yield* list(everything)).toEqual({
      models: [
        { model: "gpt-live-1.1", provider: "openai", transports: ["webrtc"], available: true },
        { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: true },
        { model: "gemini-3.8-live", provider: "google", transports: ["websocket"], available: true },
        { model: "gpt-live-1", provider: "openai", transports: ["webrtc"], available: true },
        { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: true },
      ],
      default: "gpt-live-1.1",
    })

    const hostedList = yield* list(hosted)
    expect(hostedList.models.map((item) => [item.model, item.provider, item.available])).toEqual([
      ["grok-voice-3.0", "xai", true],
      ["gemini-3.8-live", "google", true],
      ["gpt-live-1", "opencode", true],
      ["gpt-live-1.1", "openai", false],
      ["gpt-realtime-2.1", "openai", false],
    ])
    expect(hostedList.default).toBe("grok-voice-3.0")

    const none = yield* list([])
    expect(none.default).toBeUndefined()
    expect(none.models.every((item) => !item.available)).toBe(true)
    expect(none.models.map((item) => item.model)).toContain("gpt-live-1")

    // A bare ID starts on the model's own provider first, then OpenCode's.
    yield* session("gpt-live-1", opencode, hosted)
    expect(requests.map((req) => req.url)).toEqual(["https://opencode.ai/inference/openai/v1/live/sessions"])
    for (const model of ["gpt-live-1", "gpt-realtime-2.1", "gemini-3.8-live"]) {
      const error = yield* session(model, {}, []).pipe(Effect.flip)
      expect(error._tag).toBe("Voice.UnavailableError")
      expect(error.message).toContain("API key")
    }
    const unknown = yield* session("gpt-4o-realtime", opencode, hosted).pipe(Effect.flip)
    expect(unknown._tag).toBe("Voice.InvalidRequestError")
    expect(unknown.message).toContain("Unsupported voice model: gpt-4o-realtime")
    expect(requests).toHaveLength(1)
  }),
)
