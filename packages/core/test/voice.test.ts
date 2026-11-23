import { expect } from "bun:test"
import { Realtime } from "@opencode/ai/experimental"
import { RequestExecutor } from "@opencode/ai/route"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { ID, Info, Model } from "@opencode/core/model"
import { ModelsDev } from "@opencode/core/models-dev"
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

// A ChatGPT sign-in can't start voice sessions, so resolving one fails the test; an OpenCode Console sign-in can.
const resolveCredential: Integration.Interface["connection"]["resolve"] = (connection) => {
  if (connection.type === "env") return Effect.succeed(Credential.Key.make({ type: "key", key: keys[connection.name] }))
  if (connection.id === "chatgpt") return Effect.die("a ChatGPT sign-in was resolved")
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
const voice = (provider: string, id: string, protocol: string, released: string) =>
  Info.make({
    ...Info.default(Provider.ID.make(provider), ID.make(id)),
    type: "realtime",
    realtime: { protocol, transports: Realtime.engines.find((engine) => engine.id === protocol)?.transports ?? [] },
    time: { released: Date.parse(released) },
  })

// What Model lists with every provider connected, newest first.
const everything = [
  voice("openai", "gpt-live-1.1", "openai-live", "2026-11-19"),
  voice("xai", "grok-voice-3.0", "xai-realtime", "2026-10-14"),
  voice("google", "gemini-3.8-live", "gemini-live", "2026-09-15"),
  voice("openai", "gpt-live-1", "openai-live", "2026-09-10"),
  voice("opencode", "gpt-live-1", "openai-live", "2026-09-10"),
  voice("openai", "gpt-realtime-2.1", "openai-realtime", "2026-07-06"),
  // Configured as realtime, with no voice protocol this server speaks.
  Info.make({ ...Info.default(Provider.ID.make("openai"), ID.make("custom-voice")), type: "realtime" }),
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

// xAI has a key in its provider settings, as `opencode.json` can set.
const providers = Layer.mock(Provider.Service, {
  get: (id) =>
    Effect.succeed(
      id === "xai" ? { ...Provider.Info.empty(id), settings: { apiKey: "xai-config-key" } } : Provider.Info.empty(id),
    ),
})

// The models.dev catalog the deprecated endpoints read: every voice model, whatever is connected.
const modelsDev = Layer.mock(ModelsDev.Service, {
  get: () =>
    Effect.succeed(
      ["openai", "xai", "google", "opencode"].map((id) => ({
        info: Provider.Info.empty(Provider.ID.make(id)),
        models: everything.filter((model) => model.providerID === id),
        environment: [],
      })),
    ),
})

const mockIntegration = (
  connections: (id: Integration.ID) => Integration.Info["connections"],
  resolve: Integration.Interface["connection"]["resolve"],
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
  effect: Effect.Effect<
    A,
    E,
    Voice.Service | Model.Service | Provider.Service | ModelsDev.Service | Integration.Service
  >,
  connections: Partial<Record<string, Integration.Info["connections"]>>,
  requests: HttpClientRequest.HttpClientRequest[],
  listed: readonly Model.Info[] = everything,
) =>
  effect.pipe(
    Effect.provide(
      Voice.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            catalog(listed),
            providers,
            modelsDev,
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
    const noProtocol = yield* start("openai", "custom-voice", {}, requests).pipe(Effect.flip)
    expect(noProtocol).toMatchObject({
      _tag: "Voice.UnsupportedModelError",
      message: "openai/custom-voice has no voice protocol opencode can call",
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

// The deprecated endpoints keep their own model lookup and credential search, so released apps see what they always did.
const legacy = (
  model: string,
  connections: Partial<Record<string, Integration.Info["connections"]>>,
  requests: HttpClientRequest.HttpClientRequest[],
) => run(VoiceLegacy.session({ model, transport: transport(model) }), connections, requests)

it.effect("deprecated session uses the first key or env connection Integration lists and never a ChatGPT sign-in", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1760000000_000)
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const call = (model: string, connections: Partial<Record<string, Integration.Info["connections"]>>) =>
      legacy(model, connections, requests)

    yield* call("gpt-live-1", { openai: [credential("active", "key"), credential("stored", "key")] })
    yield* call("gpt-live-1", { openai: [credential("chatgpt", "oauth"), credential("stored", "key")] })
    yield* call("grok-voice-3.0", { xai: [{ type: "env", name: "XAI_API_KEY" }] })
    yield* call("gemini-3.8-live", { google: [{ type: "env", name: "GEMINI_API_KEY" }] })
    expect(requests.map((req) => req.headers.authorization ?? req.headers["x-goog-api-key"])).toEqual([
      "Bearer sk-active",
      "Bearer sk-stored",
      "Bearer xai-env-key",
      "gemini-env-key",
    ])

    const signInOnly = yield* call("gpt-live-1", { openai: [credential("chatgpt", "oauth")] }).pipe(Effect.flip)
    expect(signInOnly._tag).toBe("Voice.UnavailableError")
    expect(signInOnly.message).toContain("OpenAI API key")

    const missingGoogle = yield* call("gemini-3.8-live", {}).pipe(Effect.flip)
    expect(missingGoogle).toMatchObject({ _tag: "Voice.UnavailableError", service: "google" })
    expect(missingGoogle.message).toContain("GEMINI_API_KEY")
  }),
)

it.effect(
  "deprecated session starts GPT-Live on OpenCode's hosted endpoint with an OpenCode Console connection only without an OpenAI key",
  () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = []
      const opencode = { opencode: [credential("console", "oauth")] }

      yield* legacy("gpt-live-1", { openai: [credential("chatgpt", "oauth")], ...opencode }, requests)
      yield* legacy("gpt-live-1", { opencode: [{ type: "env", name: "OPENCODE_API_KEY" }] }, requests)
      yield* legacy("gpt-live-1", { openai: [credential("active", "key")], ...opencode }, requests)
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

      const realtime = yield* legacy("gpt-realtime-2.1", opencode, requests).pipe(Effect.flip)
      expect(realtime).toMatchObject({ _tag: "Voice.UnavailableError", service: "openai" })

      const unlisted = yield* legacy("gpt-live-1.1", opencode, requests).pipe(Effect.flip)
      expect(unlisted).toMatchObject({ _tag: "Voice.InvalidRequestError" })
      expect(unlisted.message).toBe(
        "Unsupported voice model: gpt-live-1.1. This server lists gpt-live-1, gpt-realtime-2.1, grok-voice-3.0, gemini-3.8-live.",
      )
      expect(requests).toHaveLength(3)
    }),
)

it.effect("deprecated list shows voice models with availability and default", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const list = (connections: Partial<Record<string, Integration.Info["connections"]>>) =>
      run(VoiceLegacy.models(), connections, requests)

    // Each model's provider and availability, and the default, for one set of connections.
    const summary = (connections: Partial<Record<string, Integration.Info["connections"]>>) =>
      list(connections).pipe(
        Effect.map((result) => ({
          models: result.models.map((item) => [item.model, item.provider, item.available]),
          default: result.default,
        })),
      )

    expect(yield* list({ openai: [credential("active", "key")] })).toEqual({
      models: [
        { model: "gpt-live-1.1", provider: "openai", transports: ["webrtc"], available: true },
        { model: "gpt-live-1", provider: "openai", transports: ["webrtc"], available: true },
        { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: true },
        { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: false },
        { model: "gemini-3.8-live", provider: "google", transports: ["websocket"], available: false },
      ],
      default: "gpt-live-1.1",
    })

    expect(
      yield* summary({
        openai: [credential("chatgpt", "oauth")],
        xai: [{ type: "env", name: "XAI_API_KEY" }],
        google: [credential("gemini", "key")],
      }),
    ).toEqual({
      models: [
        ["gpt-live-1.1", "openai", false],
        ["gpt-live-1", "openai", false],
        ["gpt-realtime-2.1", "openai", false],
        ["grok-voice-3.0", "xai", true],
        ["gemini-3.8-live", "google", true],
      ],
      default: "grok-voice-3.0",
    })

    expect(
      yield* summary({ openai: [credential("chatgpt", "oauth")], opencode: [credential("console", "oauth")] }),
    ).toEqual({
      models: [
        ["gpt-live-1", "opencode", true],
        ["gpt-realtime-2.1", "openai", false],
        ["grok-voice-3.0", "xai", false],
        ["gemini-3.8-live", "google", false],
      ],
      default: "gpt-live-1",
    })

    expect(yield* summary({ openai: [credential("chatgpt", "oauth")] })).toEqual({
      models: [
        ["gpt-live-1.1", "openai", false],
        ["gpt-live-1", "openai", false],
        ["gpt-realtime-2.1", "openai", false],
        ["grok-voice-3.0", "xai", false],
        ["gemini-3.8-live", "google", false],
      ],
      default: undefined,
    })
    expect(requests).toHaveLength(0)
  }),
)
