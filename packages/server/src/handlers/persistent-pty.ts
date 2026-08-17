import { Group, PersistentPty } from "@opencode-ai/core/persistent-pty"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import {
  ForbiddenError,
  InvalidRequestError,
  PtyNotFoundError,
  ServiceUnavailableError,
} from "@opencode-ai/protocol/errors"
import {
  PTY_CONNECT_TICKET_QUERY,
  PTY_CONNECT_TOKEN_HEADER,
  PTY_CONNECT_TOKEN_HEADER_VALUE,
} from "@opencode-ai/protocol/groups/persistent-pty"
import { Effect, Queue } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Socket } from "effect/unstable/socket"
import { Api } from "../api"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"

export const PersistentPtyHandler = HttpApiBuilder.group(Api, "server.persistentPty", (handlers) =>
  Effect.gen(function* () {
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig
    const groups = yield* Group.Service
    const pty = yield* PersistentPty.Service

    return handlers
      .handle(
        "persistentPty.group.list",
        Effect.fn(function* () {
          return { data: yield* groups.list() }
        }),
      )
      .handle(
        "persistentPty.group.create",
        Effect.fn(function* (ctx) {
          return { data: yield* groups.create(ctx.payload.items) }
        }),
      )
      .handle(
        "persistentPty.group.get",
        Effect.fn(function* (ctx) {
          const group = yield* groups.get(ctx.params.groupID)
          if (!group)
            return yield* new InvalidRequestError({
              message: `Group not found: ${ctx.params.groupID}`,
              field: "groupID",
            })
          return { data: group }
        }),
      )
      .handle(
        "persistentPty.group.set",
        Effect.fn(function* (ctx) {
          const group = Group.Info.make({ id: ctx.params.groupID, items: ctx.payload.items })
          yield* groups.set(group)
          return { data: group }
        }),
      )
      .handle(
        "persistentPty.group.remove",
        Effect.fn(function* (ctx) {
          yield* groups.remove(ctx.params.groupID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "persistentPty.list",
        Effect.fn(function* (ctx) {
          return { data: yield* pty.list(ctx.params.groupID).pipe(mapUnavailable) }
        }),
      )
      .handle(
        "persistentPty.create",
        Effect.fn(function* (ctx) {
          return {
            data: yield* pty
              .create(ctx.params.groupID, {
                command: ctx.payload.command,
                args: ctx.payload.args,
                cwd: ctx.payload.cwd,
                title: ctx.payload.title,
                env: ctx.payload.env,
                cols: ctx.payload.size?.cols,
                rows: ctx.payload.size?.rows,
              })
              .pipe(
                Effect.catchTags({
                  "PersistentPty.GroupNotFoundError": () =>
                    new InvalidRequestError({
                      message: `Group not found: ${ctx.params.groupID}`,
                      field: "groupID",
                    }),
                  "PersistentPty.UnavailableError": unavailable,
                }),
              ),
          }
        }),
      )
      .handle(
        "persistentPty.shutdown",
        Effect.fn(function* () {
          yield* pty.shutdown().pipe(mapUnavailable)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "persistentPty.get",
        Effect.fn(function* (ctx) {
          return { data: yield* pty.get(ctx.params.ptyID).pipe(mapTerminalError) }
        }),
      )
      .handle(
        "persistentPty.update",
        Effect.fn(function* (ctx) {
          yield* pty
            .resize(
              ctx.params.ptyID,
              ctx.payload.size.cols,
              ctx.payload.size.rows,
              ctx.payload.attachmentID,
            )
            .pipe(mapTerminalError)
          return { data: yield* pty.get(ctx.params.ptyID).pipe(mapTerminalError) }
        }),
      )
      .handle(
        "persistentPty.snapshot",
        Effect.fn(function* (ctx) {
          return { data: yield* pty.snapshot(ctx.params.ptyID).pipe(mapTerminalError) }
        }),
      )
      .handle(
        "persistentPty.remove",
        Effect.fn(function* (ctx) {
          yield* pty.remove(ctx.params.ptyID).pipe(mapTerminalError)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "persistentPty.connectToken",
        Effect.fn(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          if (
            request.headers[PTY_CONNECT_TOKEN_HEADER] !== PTY_CONNECT_TOKEN_HEADER_VALUE ||
            !isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors)
          )
            return yield* new ForbiddenError({ message: "Invalid persistent PTY connect token request" })
          yield* pty.get(ctx.params.ptyID).pipe(mapTerminalError)
          return { data: yield* tickets.issue({ ptyID: ctx.params.ptyID }) }
        }),
      )
      .handleRaw(
        "persistentPty.connect",
        Effect.fn("PersistentPtyHandler.connect")(function* (ctx) {
          const exists = yield* pty.get(ctx.params.ptyID).pipe(
            Effect.as(true),
            Effect.catchTag("PersistentPty.NotFoundError", () => Effect.succeed(false)),
            Effect.catchTag("PersistentPty.UnavailableError", () => Effect.succeed(false)),
          )
          if (!exists) return HttpServerResponse.empty({ status: 404 })

          const url = new URL(ctx.request.url, "http://localhost")
          const ticket = url.searchParams.get(PTY_CONNECT_TICKET_QUERY)
          if (ticket) {
            const valid = isAllowedRequestOrigin(ctx.request.headers.origin, ctx.request.headers.host, cors)
              ? yield* tickets.consume({ ticket, ptyID: ctx.params.ptyID })
              : false
            if (!valid) return HttpServerResponse.empty({ status: 403 })
          }

          const cursor = Number(url.searchParams.get("cursor") ?? "0")
          const role = url.searchParams.get("role") === "observer" ? "observer" : "controller"
          const framedInput = url.searchParams.get("input_protocol") === "1"
          const attachmentID = url.searchParams.get("attachment_id") ?? crypto.randomUUID()
          if (!Number.isSafeInteger(cursor) || cursor < 0) return HttpServerResponse.empty({ status: 400 })

          const socket = yield* Effect.orDie(ctx.request.upgrade)
          const write = yield* socket.writer
          const outbox = yield* Queue.unbounded<string | Uint8Array | Socket.CloseEvent>()
          const attachment = yield* pty
            .attach(ctx.params.ptyID, {
              cursor,
              attachmentID,
              role,
              takeover: url.searchParams.get("takeover") === "true",
              onEvent: (event) => {
                if (event.type === "output") Queue.offerUnsafe(outbox, event.data)
                if (event.type === "resized")
                  Queue.offerUnsafe(
                    outbox,
                    JSON.stringify({ ...event, checkpoint: Buffer.from(event.checkpoint).toString("base64") }),
                  )
                if (event.type !== "output" && event.type !== "resized")
                  Queue.offerUnsafe(outbox, JSON.stringify(event))
              },
              onEnd: () => Queue.offerUnsafe(outbox, new Socket.CloseEvent(1000)),
            })
            .pipe(
              Effect.catchTags({
                "PersistentPty.NotFoundError": () => Effect.succeed(undefined),
                "PersistentPty.UnavailableError": () => Effect.succeed(undefined),
              }),
            )
          if (!attachment) return HttpServerResponse.empty({ status: 404 })

          Queue.offerUnsafe(
            outbox,
            JSON.stringify({
              type: "attached",
              attachmentID,
              inputProtocol: framedInput ? 1 : 0,
              info: attachment.info,
              role: attachment.role,
              generation: attachment.generation,
              replay: {
                requestedOffset: attachment.replay.requestedOffset,
                availableOffset: attachment.replay.availableOffset,
                endOffset: attachment.replay.endOffset,
                truncated: attachment.replay.truncated,
              },
            }),
          )
          if (attachment.replay.data.length > 0) Queue.offerUnsafe(outbox, attachment.replay.data)
          Queue.offerUnsafe(
            outbox,
            JSON.stringify({ type: "replay_complete", endOffset: attachment.replay.endOffset }),
          )
          attachment.activate()

          const drain = Effect.gen(function* () {
            while (true) {
              const item = yield* Queue.take(outbox)
              yield* write(item)
              if (item instanceof Socket.CloseEvent) return
            }
          })

          yield* Effect.race(
            drain,
            socket.runRaw((message) => {
              if (role !== "controller") return Effect.void
              const data = typeof message === "string" ? Buffer.from(message) : message
              if (!framedInput)
                return pty
                  .input(
                    ctx.params.ptyID,
                    attachmentID,
                    attachment.info.size.cols,
                    attachment.info.size.rows,
                    data,
                  )
                  .pipe(Effect.ignore)
              if (data.byteLength < 5) return Effect.void
              const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
              const type = data[0]
              const cols = view.getUint16(1)
              const rows = view.getUint16(3)
              if ((type !== 0 && type !== 1) || cols === 0 || rows === 0) return Effect.void
              if (type === 0) return pty.control(ctx.params.ptyID, attachmentID, cols, rows).pipe(Effect.ignore)
              return pty.input(ctx.params.ptyID, attachmentID, cols, rows, data.subarray(5)).pipe(Effect.ignore)
            }),
          ).pipe(
            Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
            Effect.ensuring(Effect.sync(() => attachment.detach())),
            Effect.orDie,
          )
          return HttpServerResponse.empty()
        }),
      )
  }),
)

const mapUnavailable = <A>(effect: Effect.Effect<A, PersistentPty.UnavailableError>) =>
  effect.pipe(Effect.catchTag("PersistentPty.UnavailableError", unavailable))

const mapTerminalError = <A>(
  effect: Effect.Effect<A, PersistentPty.NotFoundError | PersistentPty.UnavailableError>,
) =>
  effect.pipe(
    Effect.catchTags({
      "PersistentPty.NotFoundError": (error) =>
        new PtyNotFoundError({ ptyID: error.ptyID, message: `PTY session not found: ${error.ptyID}` }),
      "PersistentPty.UnavailableError": unavailable,
    }),
  )

const unavailable = (error: PersistentPty.UnavailableError) =>
  new ServiceUnavailableError({ message: error.message, service: "opencode-pty" })
