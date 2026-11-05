import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Voice } from "@opencode/core/voice"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const voice = makeLocationNode({
  service: Voice.Service,
  layer: Layer.succeed(
    Voice.Service,
    Voice.Service.of({
      models: () =>
        Effect.succeed({
          models: [
            { model: "gpt-live-1", provider: "openai", transports: ["webrtc"], available: true },
            { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: true },
            { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: false },
            { model: "gemini-3.8-live", provider: "google", transports: ["websocket"], available: false },
          ],
          default: "gpt-live-1",
        }),
      session: (input) => {
        if (input.model === "invalid")
          return Effect.fail(new Voice.InvalidRequestError({ message: "Unsupported voice model" }))
        if (input.model === "unavailable")
          return Effect.fail(new Voice.UnavailableError({ message: "OpenAI API key is required", service: "openai" }))
        return Effect.succeed(
          input.transport.type === "webrtc"
            ? { type: "webrtc" as const, sdp: `answer:${input.model}:${input.transport.sdp}` }
            : {
                type: "websocket" as const,
                url: `wss://api.x.ai/v1/realtime?model=${input.model}`,
                token: "ek_test",
                expiresAt: 1760000000,
              },
        )
      },
    }),
  ),
  deps: [],
})

it.live("routes experimental voice models and session endpoints", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-voice-endpoint-")))
    const global = path.join(tmp.path, "global")
    yield* Effect.promise(() => fs.mkdir(global))
    const handler = yield* ServerFetch.make(
      {
        database: { path: ":memory:" },
        config: { directory: global },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      { overrides: [Voice.node.replace(voice)] },
    )
    const modelsRes = yield* Effect.promise(() =>
      handler(new Request("http://opencode.local/api/experimental/voice/models")),
    )
    expect(modelsRes.status).toBe(200)
    expect(yield* Effect.promise(() => modelsRes.json())).toEqual({
      data: {
        models: [
          { model: "gpt-live-1", provider: "openai", transports: ["webrtc"], available: true },
          { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: true },
          { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: false },
          { model: "gemini-3.8-live", provider: "google", transports: ["websocket"], available: false },
        ],
        default: "gpt-live-1",
      },
    })

    const post = (body: unknown) =>
      Effect.promise(() =>
        handler(
          new Request("http://opencode.local/api/experimental/voice/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      )

    const rtcRes = yield* post({
      model: "gpt-live-1",
      session: { voice: "marin" },
      transport: { type: "webrtc", sdp: "v=0", dcid: 4 },
    })
    expect(rtcRes.status).toBe(200)
    expect(yield* Effect.promise(() => rtcRes.json())).toEqual({
      data: { transport: { type: "webrtc", sdp: "answer:gpt-live-1:v=0" } },
    })

    const wsRes = yield* post({ model: "grok-voice-3.0", transport: { type: "websocket" } })
    expect(wsRes.status).toBe(200)
    expect(yield* Effect.promise(() => wsRes.json())).toEqual({
      data: {
        transport: {
          type: "websocket",
          url: "wss://api.x.ai/v1/realtime?model=grok-voice-3.0",
          token: "ek_test",
          expiresAt: 1760000000,
        },
      },
    })

    expect((yield* post({ model: "invalid", transport: { type: "websocket" } })).status).toBe(400)
    expect((yield* post({ model: "unavailable", transport: { type: "websocket" } })).status).toBe(503)
  }),
)
