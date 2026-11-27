import { expect } from "bun:test"
import { RequestExecutor } from "@opencode/ai/route"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { ModelsDev } from "@opencode/core/models-dev"
import { Provider } from "@opencode/core/provider"
import { Voice } from "@opencode/core/voice"
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

const voice = (id: string, name: string, api: string, releaseDate: string) => ({ id, name, api, releaseDate })

const modelsDev = Layer.mock(ModelsDev.Service, {
  get: () =>
    Effect.succeed(
      Object.entries({
        openai: [
          voice("gpt-live-1", "GPT-Live 1", "live", "2026-09-10"),
          voice("gpt-realtime-2.1", "GPT-Realtime-2.1", "realtime", "2026-07-06"),
          voice("gpt-live-1.1", "GPT-Live 1.1", "live", "2026-11-19"),
        ],
        xai: [voice("grok-voice-3.0", "Grok Voice 3.0", "realtime", "2026-10-14")],
        google: [voice("gemini-3.8-live", "Gemini 3.8 Live", "bidi-generate-content", "2026-09-15")],
        opencode: [voice("gpt-live-1", "GPT-Live 1", "live", "2026-09-10")],
      }).map(([id, voices]) => ({
        info: {
          id: Provider.ID.make(id),
          name: id,
          activation: "auto" as const,
          package: "@opencode/ai/providers/openai",
        },
        models: [],
        voices,
        environment: [],
      })),
    ),
})

// A realtime model the model service lists, as models.dev or config leaves it on.
const realtime = (provider: string, id: string, name: string, baseURL = "https://opencode.ai/inference/openai/v1") => ({
  ...Model.Info.default(Provider.ID.make(provider), Model.ID.make(id)),
  type: "realtime",
  name,
  settings: { baseURL },
})

// Newest first, as the model service sorts each type.
const onModels = [
  realtime("openai", "gpt-live-1.1", "GPT-Live 1.1"),
  realtime("openai", "gpt-live-1", "GPT-Live 1"),
  realtime("openai", "gpt-realtime-2.1", "GPT-Realtime-2.1"),
  realtime("xai", "grok-voice-3.0", "Grok Voice 3.0"),
  realtime("google", "gemini-3.8-live", "Gemini 3.8 Live"),
  realtime("opencode", "gpt-live-1", "GPT-Live 1"),
]

const mockModels = (models: readonly Model.Info[] = onModels) =>
  Layer.mock(Model.Service, {
    available: (types) => Effect.succeed(models.filter((model) => types?.includes(model.type ?? "chat"))),
  })

const mockIntegration = (
  connections: (id: Integration.ID) => Integration.Info["connections"],
  resolve: Integration.Interface["connection"]["resolve"] = () => Effect.die("Voice.models resolved a credential"),
) =>
  Layer.mock(Integration.Service, {
    revision: () => 0,
    get: (id) => Effect.succeed({ id, name: id, methods: [], connections: connections(id) }),
    connection: {
      active: unused,
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

// Starts a session with each integration's connections, recording the requests it sends upstream.
const start = (
  model: string,
  connections: Partial<Record<string, Integration.Info["connections"]>>,
  requests: HttpClientRequest.HttpClientRequest[],
  models: readonly Model.Info[] = onModels,
) =>
  Effect.flatMap(Voice.Service, (voice) =>
    voice.session({
      model,
      transport:
        model.startsWith("grok-") || model.startsWith("gemini-")
          ? { type: "websocket" }
          : { type: "webrtc", sdp: "v=0" },
    }),
  ).pipe(
    Effect.provide(
      Voice.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            modelsDev,
            mockModels(models),
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
                        model.startsWith("gemini-")
                          ? Response.json({ name: "auth_tokens/ek_gemini" })
                          : model.startsWith("grok-")
                            ? Response.json({ value: "ek_xai", expires_at: 1760000999 })
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

it.effect("uses the first key or env connection Integration lists and never a ChatGPT sign-in", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1760000000_000)
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const call = (model: string, connections: Partial<Record<string, Integration.Info["connections"]>>) =>
      start(model, connections, requests)

    yield* call("gpt-live-1", { openai: [credential("active", "key"), credential("stored", "key")] })
    yield* call("gpt-live-1", { openai: [credential("chatgpt", "oauth"), credential("stored", "key")] })
    const grok = yield* call("grok-voice-3.0", { xai: [{ type: "env", name: "XAI_API_KEY" }] })
    const gemini = yield* call("gemini-3.8-live", { google: [{ type: "env", name: "GEMINI_API_KEY" }] })
    expect(requests.map((req) => req.headers.authorization ?? req.headers["x-goog-api-key"])).toEqual([
      "Bearer sk-active",
      "Bearer sk-stored",
      "Bearer xai-env-key",
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

    const signInOnly = yield* call("gpt-live-1", { openai: [credential("chatgpt", "oauth")] }).pipe(Effect.flip)
    expect(signInOnly._tag).toBe("Voice.UnavailableError")
    expect(signInOnly.message).toContain("OpenAI API key")

    const missingGoogle = yield* call("gemini-3.8-live", {}).pipe(Effect.flip)
    expect(missingGoogle).toMatchObject({ _tag: "Voice.UnavailableError", service: "google" })
    expect(missingGoogle.message).toContain("GEMINI_API_KEY")
  }),
)

it.effect(
  "starts GPT-Live on OpenCode's hosted endpoint with an OpenCode Console connection only without an OpenAI key",
  () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = []
      const opencode = { opencode: [credential("console", "oauth")] }

      yield* start("gpt-live-1", { openai: [credential("chatgpt", "oauth")], ...opencode }, requests)
      yield* start("gpt-live-1", { opencode: [{ type: "env", name: "OPENCODE_API_KEY" }] }, requests)
      yield* start("gpt-live-1", { openai: [credential("active", "key")], ...opencode }, requests)
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

      const realtime = yield* start("gpt-realtime-2.1", opencode, requests).pipe(Effect.flip)
      expect(realtime).toMatchObject({ _tag: "Voice.UnavailableError", service: "openai" })

      const unlisted = yield* start("gpt-live-1.1", opencode, requests).pipe(Effect.flip)
      expect(unlisted).toMatchObject({ _tag: "Voice.InvalidRequestError" })
      expect(unlisted.message).toBe(
        "Unsupported voice model: gpt-live-1.1. This server lists gpt-live-1, gpt-realtime-2.1, grok-voice-3.0, gemini-3.8-live.",
      )
      expect(requests).toHaveLength(3)
    }),
)

it.effect("lists voice models with availability and default without resolving credentials", () =>
  Effect.gen(function* () {
    const list = (connections: Partial<Record<string, Integration.Info["connections"]>>) =>
      Effect.flatMap(Voice.Service, (voice) => voice.models()).pipe(
        Effect.provide(
          Voice.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                modelsDev,
                mockModels(),
                mockIntegration((id) => connections[id] ?? []),
                Layer.mock(RequestExecutor.Service, {}),
              ),
            ),
          ),
        ),
      )

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
        {
          model: "gpt-live-1.1",
          name: "GPT-Live 1.1",
          engine: "openai-live",
          provider: "openai",
          transports: ["webrtc"],
          available: true,
        },
        {
          model: "gpt-live-1",
          name: "GPT-Live 1",
          engine: "openai-live",
          provider: "openai",
          transports: ["webrtc"],
          available: true,
        },
        {
          model: "gpt-realtime-2.1",
          name: "GPT-Realtime-2.1",
          engine: "openai-realtime",
          provider: "openai",
          transports: ["webrtc", "websocket"],
          available: true,
        },
        {
          model: "grok-voice-3.0",
          name: "Grok Voice 3.0",
          engine: "xai-realtime",
          provider: "xai",
          transports: ["websocket"],
          available: false,
        },
        {
          model: "gemini-3.8-live",
          name: "Gemini 3.8 Live",
          engine: "gemini-live",
          provider: "google",
          transports: ["websocket"],
          available: false,
        },
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
  }),
)

it.effect("offers hosted GPT-Live only while its config leaves it on, at the URL config gives it", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = []
    const opencode = { opencode: [credential("console", "oauth")] }
    const others = onModels.filter((model) => model.providerID !== "opencode")
    const list = (models: readonly Model.Info[]) =>
      Effect.flatMap(Voice.Service, (voice) => voice.models()).pipe(
        Effect.map((result) => result.models.filter((item) => item.provider === "opencode").map((item) => item.model)),
        Effect.provide(
          Voice.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                modelsDev,
                mockModels(models),
                mockIntegration((id) => (id === "opencode" ? opencode.opencode : [])),
                Layer.mock(RequestExecutor.Service, {}),
              ),
            ),
          ),
        ),
      )

    // A workspace that turned GPT-Live off sends it disabled, so the model service leaves it out.
    expect(yield* list(others)).toEqual([])
    const off = yield* start("gpt-live-1", opencode, requests, others).pipe(Effect.flip)
    expect(off).toMatchObject({ _tag: "Voice.InvalidRequestError" })

    const dev = realtime("opencode", "gpt-live-1", "GPT-Live 1", "https://console.dev.example/inference/openai/v1")
    expect(yield* list([...others, dev])).toEqual(["gpt-live-1"])
    yield* start("gpt-live-1", opencode, requests, [...others, dev])
    expect(requests.map((req) => req.url)).toEqual(["https://console.dev.example/inference/openai/v1/live/sessions"])
  }),
)
