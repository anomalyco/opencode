import { expect } from "bun:test"
import { OpenCode } from "@opencode/client/effect"
import { ClientApi } from "@opencode/protocol/client"
import { Authorization } from "@opencode/protocol/middleware/authorization"
import { Event } from "@opencode/schema/event"
import { Session } from "@opencode/schema/session"
import { Cause, Effect, Exit, Layer, Stream } from "effect"
import { HttpClient, HttpClientResponse, HttpRouter, HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiGroup } from "effect/http-api"
import { it } from "../../core/test/lib/effect"
import { schemaErrorLayer } from "../src/middleware/schema-error"

// Serve the real protocol declaration for the session log stream, so the server encoder and the
// generated Effect client agree on the reserved SSE failure event for this Effect version.
const LogApi = HttpApi.make("log").add(
  HttpApiGroup.make("server.session").add(ClientApi.groups["server.session"].endpoints["session.log"]),
)
const synced = { type: "log.synced" as const, aggregateID: "ses_test", seq: Event.Seq.make(1) }

const handler = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(LogApi).pipe(
    Layer.provide(
      HttpApiBuilder.group(LogApi, "server.session", (handlers) =>
        handlers.handle("session.log", () =>
          Effect.succeed(Stream.make(synced).pipe(Stream.concat(Stream.die(new Error("log reader failed"))))),
        ),
      ),
    ),
    Layer.provide(schemaErrorLayer),
    Layer.provide(
      Layer.succeed(
        Authorization,
        Authorization.of((effect) => effect),
      ),
    ),
    Layer.provide(HttpServer.layerServices),
  ),
).handler

const fetchLog = (request: Request) => Effect.promise(() => handler(request))

it.live("encodes a mid-stream session log failure as the reserved SSE failure event", () =>
  Effect.gen(function* () {
    const response = yield* fetchLog(new Request("http://opencode.local/api/experimental/session/ses_test/log"))
    const body = yield* Effect.promise(() => response.text())
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(body).toContain("event: effect/http-api/stream/failure")
  }),
)

it.live("the generated Effect client fails the session log stream with the server's defect", () =>
  Effect.gen(function* () {
    const httpClient = HttpClient.make((request) =>
      fetchLog(new Request(request.url, { method: request.method })).pipe(
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      ),
    )
    const received: unknown[] = []
    const exit = yield* Effect.gen(function* () {
      const client = yield* OpenCode.make({ baseUrl: "http://opencode.local" })
      return yield* client.session
        .log({ sessionID: Session.ID.make("ses_test") })
        .pipe(Stream.runForEach((item) => Effect.sync(() => received.push(item))))
    }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.exit)

    expect(received).toEqual([synced])
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    if (Exit.isSuccess(exit)) return
    expect(Cause.squash(exit.cause)).toMatchObject({ message: "log reader failed" })
  }),
)
