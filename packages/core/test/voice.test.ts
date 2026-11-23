import { expect } from "bun:test"
import { RequestExecutor } from "@opencode/ai/route"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { ID, Info, Model } from "@opencode/core/model"
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

// A realtime catalog model whose package names the voice engine that speaks to it.
const voice = (provider: string, id: string, engine: string) =>
  Info.make({ ...Info.default(Provider.ID.make(provider), ID.make(id)), type: "realtime", package: engine })

// What Model lists with every provider connected, newest first.
const everything = [
  voice("openai", "gpt-live-1.1", "openai-live"),
  voice("xai", "grok-voice-3.0", "xai-realtime"),
  voice("google", "gemini-3.8-live", "gemini-live"),
  voice("openai", "gpt-live-1", "openai-live"),
  voice("opencode", "gpt-live-1", "openai-live"),
  voice("openai", "gpt-realtime-2.1", "openai-realtime"),
]

// Without an OpenAI key, OpenAI's GPT-Live models aren't listed, but OpenCode's are with a Console connection.
const hosted = everything.filter((model) => model.providerID !== "openai" || model.package !== "openai-live")

const catalog = (listed: readonly Model.Info[]) =>
  Layer.mock(Model.Service, {
    available: (types) => Effect.succeed(types?.includes("realtime") ? listed : []),
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
  listed: readonly Model.Info[] = everything,
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
            catalog(listed),
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

      yield* start("gpt-live-1", { openai: [credential("chatgpt", "oauth")], ...opencode }, requests, hosted)
      yield* start("gpt-live-1", { opencode: [{ type: "env", name: "OPENCODE_API_KEY" }] }, requests, hosted)
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

      const realtime = yield* start("gpt-realtime-2.1", opencode, requests, hosted).pipe(Effect.flip)
      expect(realtime).toMatchObject({ _tag: "Voice.UnavailableError", service: "openai" })

      const unlisted = yield* start("gpt-live-1.1", opencode, requests, hosted).pipe(Effect.flip)
      expect(unlisted).toMatchObject({ _tag: "Voice.InvalidRequestError" })
      expect(unlisted.message).toBe(
        "Unsupported voice model: gpt-live-1.1. This server lists gpt-live-1, gpt-realtime-2.1, grok-voice-3.0, gemini-3.8-live.",
      )
      expect(requests).toHaveLength(3)
    }),
)

it.effect("lists the catalog's voice models with their transports, preferring a provider's own GPT-Live", () =>
  Effect.gen(function* () {
    const list = (listed: readonly Model.Info[]) =>
      Effect.flatMap(Voice.Service, (voice) => voice.models()).pipe(
        Effect.provide(
          Voice.layer.pipe(
            Layer.provide(
              Layer.mergeAll(catalog(listed), mockIntegration(() => []), Layer.mock(RequestExecutor.Service, {})),
            ),
          ),
        ),
      )

    expect(yield* list(everything)).toEqual({
      models: [
        { model: "gpt-live-1.1", provider: "openai", transports: ["webrtc"], available: true },
        { model: "gpt-live-1", provider: "openai", transports: ["webrtc"], available: true },
        { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: true },
        { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: true },
        { model: "gemini-3.8-live", provider: "google", transports: ["websocket"], available: true },
      ],
      default: "gpt-live-1.1",
    })

    const opencode = yield* list(hosted)
    expect(opencode.models.map((item) => [item.model, item.provider])).toEqual([
      ["gpt-live-1", "opencode"],
      ["gpt-realtime-2.1", "openai"],
      ["grok-voice-3.0", "xai"],
      ["gemini-3.8-live", "google"],
    ])
    expect(opencode.default).toBe("gpt-live-1")

    expect(yield* list([])).toEqual({ models: [] })
  }),
)
