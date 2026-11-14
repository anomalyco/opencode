import { expect } from "bun:test"
import { Clock, Deferred, Effect, Fiber } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { App } from "@opencode/core/app"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { CopilotOAuth } from "@opencode/core/github-copilot/oauth"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Credential.node, Integration.node])))
const integrationID = Integration.ID.make("github-copilot")

const fixture = Effect.fn(function* (respond: (request: Request) => Effect.Effect<Response>) {
  const credentials = yield* Credential.Service
  const integrations = yield* Integration.Service
  const http = HttpClient.make((request) =>
    HttpClientRequest.toWeb(request).pipe(
      Effect.orDie,
      Effect.flatMap(respond),
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
    ),
  )
  yield* integrations.transform((editor) => {
    editor.method.update(CopilotOAuth.method(App.make(), http, Effect.succeed(false)))
  })
  const value = Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make("device"),
    access: "old-access",
    refresh: "old-refresh",
    expires: 1,
    metadata: { refreshable: true, apiEndpoint: "https://api.business.githubcopilot.com" },
  })
  const saved = yield* credentials.create({ integrationID, value })
  const connection = yield* integrations.connection.active(integrationID)
  if (!connection) return yield* Effect.die(new Error("Expected an active Copilot connection"))
  return { credentials, integrations, saved, connection }
})

it.effect("refreshes and persists one rotating token pair for concurrent connection resolutions", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const requests: Request[] = []
    const test = yield* fixture((request) =>
      Effect.gen(function* () {
        requests.push(request)
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(finish)
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
        })
      }),
    )
    const resolutions = yield* Effect.all(
      Array.from({ length: 3 }, () => test.integrations.connection.resolve(test.connection)),
      { concurrency: "unbounded" },
    ).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(started)
    yield* Deferred.succeed(finish, undefined)
    const values = yield* Fiber.join(resolutions)
    expect(requests).toHaveLength(1)
    expect(values.every((value) => value?.type === "oauth" && value.access === "new-access")).toBe(true)
    const persisted = yield* test.credentials.get(test.saved.id)
    expect(persisted?.value).toEqual(
      Credential.OAuth.make({
        ...test.saved.value,
        type: "oauth",
        methodID: Integration.MethodID.make("device"),
        access: "new-access",
        refresh: "new-refresh",
        expires: (yield* Clock.currentTimeMillis) + 28800000,
        metadata: {
          refreshable: true,
          apiEndpoint: "https://api.business.githubcopilot.com",
          refreshExpires: (yield* Clock.currentTimeMillis) + 15897600000,
        },
      }),
    )
    yield* test.integrations.connection.resolve(test.connection)
    expect(requests).toHaveLength(1)
  }),
)

for (const status of [200, 503])
  it.effect(`preserves stored credentials on a failed refresh (${status})`, () =>
    Effect.gen(function* () {
      const test = yield* fixture(() => Effect.succeed(Response.json({ error: "invalid_grant" }, { status })))
      const failure = yield* test.integrations.connection.resolve(test.connection).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(Integration.AuthorizationError)
      expect((yield* test.credentials.get(test.saved.id))?.value).toEqual(test.saved.value)
    }),
  )
