import { NodeStream } from "@effect/platform-node"
import { Event } from "@opencode/schema/event"
import { EventConnectionNotFoundError } from "@opencode/protocol/errors"
import { Effect, Option, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { constants, createBrotliCompress, createGzip } from "node:zlib"
import { Api } from "../api"
import { EventFeed } from "../event-feed"

export type EventEncoding = "gzip" | "br"

const supportedEncodings: ReadonlyArray<EventEncoding> = ["gzip", "br"]
const acceptEncodingMember = /^([a-z0-9!#$%&'*+.^_`|~-]+)(?:;q=(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?))?$/

const proxyHeaderNames = [
  "x-forwarded-for",
  "forwarded",
  "x-real-ip",
  "x-forwarded-host",
  "x-forwarded-proto",
  "tailscale-user-login",
  "tailscale-user-name",
  "cf-connecting-ip",
] as const

const sseHeaders = {
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff",
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const feed = yield* EventFeed.Service
    return handlers
      .handleRaw("event.subscribe", (ctx) =>
        Effect.gen(function* () {
          const connected = {
            id: Event.ID.create(),
            type: "server.connected",
            data: {},
          } as const
          const output = Stream.unwrap(
            feed
              .subscribe(ctx.query.types)
              .pipe(Effect.map((live) => Stream.make(EventFeed.frame(connected)).pipe(Stream.concat(live)))),
          )
          const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
          return HttpServerResponse.stream(
            output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
            {
              contentType: "text/event-stream",
              headers: sseHeaders,
            },
          )
        }),
      )
      .handleRaw("event.experimental.subscribe", (ctx) =>
        Effect.gen(function* () {
          const output = Stream.unwrap(
            feed.connect({ detail: ctx.query.detail }).pipe(
              Effect.map((connection) => {
                const connected = {
                  id: Event.ID.create(),
                  type: "server.connected",
                  data: { connection: connection.id },
                } as const
                return Stream.make(EventFeed.frame(connected)).pipe(Stream.concat(connection.stream))
              }),
            ),
          )
          const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
          const encoded = output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText)
          const encoding = negotiateEventEncoding(ctx.request)

          if (!encoding) {
            return HttpServerResponse.stream(encoded, {
              contentType: "text/event-stream",
              headers: {
                ...sseHeaders,
                Vary: "Accept-Encoding",
              },
            })
          }

          return HttpServerResponse.stream(compressEventStream(encoded, encoding), {
            contentType: "text/event-stream",
            headers: {
              ...sseHeaders,
              "Content-Encoding": encoding,
              Vary: "Accept-Encoding",
            },
          })
        }),
      )
      .handle(
        "event.experimental.sessions",
        Effect.fn(function* (ctx) {
          const updated = yield* feed.setSessions(ctx.params.connection, ctx.payload.sessions)
          if (!updated)
            return yield* new EventConnectionNotFoundError({
              connection: ctx.params.connection,
              message: `Event stream connection not found: ${ctx.params.connection}`,
            })
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)

function isLoopbackAddress(address: string) {
  const normalized = address.trim().toLowerCase()
  return (
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "localhost" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  )
}

export function isLocalEventClient(request: HttpServerRequest.HttpServerRequest) {
  if (Option.isNone(request.remoteAddress) || !isLoopbackAddress(request.remoteAddress.value)) return false
  return !proxyHeaderNames.some((name) => Boolean(request.headers[name]?.trim()))
}

export function negotiateEventEncoding(request: HttpServerRequest.HttpServerRequest): EventEncoding | undefined {
  if (isLocalEventClient(request)) return undefined

  const header = request.headers["accept-encoding"]
  if (!header) return undefined

  const trimmed = header.trim()
  if (!trimmed) return undefined

  const members = trimmed.split(",").map((part) => {
    const normalized = part.trim().toLowerCase().replace(/[ \t]*;[ \t]*/g, ";")
    const match = acceptEncodingMember.exec(normalized)
    if (!match) return undefined
    return [match[1], match[2] === undefined ? 1 : Number(match[2])] as const
  })
  if (members.some((member) => member === undefined)) return undefined

  const accepted = new Map(members.filter((member): member is readonly [string, number] => member !== undefined))

  const candidates = supportedEncodings
    .map((encoding) => ({ encoding, quality: accepted.get(encoding) ?? accepted.get("*") ?? 0 }))
    .filter((candidate) => candidate.quality > 0)
    .sort((left, right) => right.quality - left.quality)

  return candidates[0]?.encoding
}

function compressEventStream<E>(stream: Stream.Stream<Uint8Array, E>, encoding: EventEncoding) {
  return NodeStream.pipeThroughDuplex(stream, {
    evaluate: () =>
      encoding === "gzip"
        ? createGzip({
            level: 6,
            flush: constants.Z_SYNC_FLUSH,
          })
        : createBrotliCompress({
            params: {
              [constants.BROTLI_PARAM_QUALITY]: 4,
            },
            flush: constants.BROTLI_OPERATION_FLUSH,
          }),
  })
}
