import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Voice } from "@opencode/core/voice"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { serveRoutes } from "./fixture/routes"

const voice = makeLocationNode({
  service: Voice.Service,
  layer: Layer.succeed(
    Voice.Service,
    Voice.Service.of({
      connect: (input) => {
        if (input.model.id === "invalid")
          return Effect.fail(new Voice.InvalidRequestError({ message: "Variant unavailable" }))
        if (input.model.id === "missing")
          return Effect.fail(
            new Voice.ModelNotFoundError({
              providerID: input.model.providerID,
              modelID: input.model.id,
              message: "Model not found: openai/missing",
            }),
          )
        if (input.model.id === "chat")
          return Effect.fail(
            new Voice.UnsupportedModelError({
              providerID: input.model.providerID,
              modelID: input.model.id,
              message: "openai/chat is a chat model, not a realtime model",
            }),
          )
        if (input.model.id === "unavailable")
          return Effect.fail(new Voice.UnavailableError({ message: "OpenAI API key is required", service: "openai" }))
        return Effect.succeed(
          input.transport.type === "webrtc"
            ? {
                type: "webrtc" as const,
                sdp: `answer:${input.model.providerID}/${input.model.id}:${input.transport.sdp}`,
              }
            : {
                type: "websocket" as const,
                url: `wss://api.x.ai/v1/realtime?model=${input.model.id}`,
                token: "ek_test",
                expiresAt: 1760000000,
              },
        )
      },
    }),
  ),
  deps: [],
})

it.live("routes the voice connect endpoint and the deprecated voice endpoints", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-voice-endpoint-")))
    const global = path.join(tmp.path, "global")
    yield* Effect.promise(() => fs.mkdir(global))
    const server = yield* serveRoutes(
      {
        database: { path: ":memory:" },
        config: { directory: global },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      [Voice.node.replace(voice)],
    )
    yield* server.pluginsLoaded(global)
    const post = (route: string, body: unknown) =>
      Effect.promise(() =>
        server.fetch(`http://opencode.local/api/experimental/voice/${route}?location[directory]=${global}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      )

    const rtcRes = yield* post("connect", {
      model: { id: "gpt-live-1", providerID: "opencode" },
      session: { voice: "marin" },
      transport: { type: "webrtc", sdp: "v=0", dcid: 4 },
    })
    expect(rtcRes.status).toBe(200)
    expect(yield* Effect.promise(() => rtcRes.json())).toMatchObject({
      location: { directory: global },
      data: { type: "webrtc", sdp: "answer:opencode/gpt-live-1:v=0" },
    })

    const wsRes = yield* post("connect", {
      model: { id: "grok-voice-3.0", providerID: "xai" },
      transport: { type: "websocket" },
    })
    expect(wsRes.status).toBe(200)
    expect(yield* Effect.promise(() => wsRes.json())).toMatchObject({
      data: {
        type: "websocket",
        url: "wss://api.x.ai/v1/realtime?model=grok-voice-3.0",
        token: "ek_test",
        expiresAt: 1760000000,
      },
    })

    const connect = (id: string) =>
      post("connect", { model: { id, providerID: "openai" }, transport: { type: "websocket" } })
    expect((yield* connect("invalid")).status).toBe(400)
    expect((yield* connect("missing")).status).toBe(404)
    expect((yield* connect("chat")).status).toBe(422)
    expect((yield* connect("unavailable")).status).toBe(503)

    // The deprecated endpoints read the real catalog, where nothing is connected.
    const modelsRes = yield* Effect.promise(() => server.fetch("http://opencode.local/api/experimental/voice/models"))
    expect(modelsRes.status).toBe(200)
    const models = yield* Effect.promise(() => modelsRes.json())
    expect(models.data.default).toBeUndefined()
    expect(models.data.models).toContainEqual({
      model: "gpt-live-1",
      provider: "openai",
      transports: ["webrtc"],
      available: false,
    })
    const legacy = yield* post("session", { model: "gpt-live-1", transport: { type: "websocket" } })
    expect(legacy.status).toBe(503)
  }),
)
