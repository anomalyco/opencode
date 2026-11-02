import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Sandbox } from "@opencode/core/sandbox"
import { InvalidRequestError, UnknownError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Global } from "@opencode/util/global"
import { HeapSnapshot } from "@opencode/util/heap-snapshot"
import { Cause, Effect, Option, RcMap } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import path from "node:path"
import { Api } from "../api"
import { requestRef, locationErrors } from "../location"

export const DebugHandler = HttpApiBuilder.group(Api, "server.debug", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    return handlers
      .handle(
        "debug.heapDump",
        Effect.fn("server.debug.heapDump")(function* (ctx) {
          const directory = ctx.query.directory
          if (directory !== undefined && !path.isAbsolute(directory))
            return yield* new InvalidRequestError({ message: "directory must be an absolute path", field: "directory" })
          return yield* HeapSnapshot.write(directory ?? global.log).pipe(
            Effect.catch((cause) => {
              const ref = `err_${crypto.randomUUID().slice(0, 8)}`
              return Effect.logError("failed to write heap snapshot", { cause }).pipe(
                Effect.annotateLogs({ ref }),
                Effect.andThen(
                  // The reason (a missing permission, a file where the directory should be) is usually the caller's to fix.
                  Effect.fail(
                    new UnknownError({
                      message: `Failed to write heap snapshot: ${cause.cause instanceof Error ? cause.cause.message : cause.message}`,
                      ref,
                    }),
                  ),
                ),
              )
            }),
          )
        }),
      )
      .handle(
        "debug.location",
        Effect.fn(function* () {
          const locations = Option.getOrThrow(yield* Effect.serviceOption(LocationServiceMap.Service))
          return Array.from(yield* RcMap.keys(locations.rcMap))
        }),
      )
      .handle(
        "debug.location.evict",
        Effect.fn(function* (ctx) {
          const locations = Option.getOrThrow(yield* Effect.serviceOption(LocationServiceMap.Service))
          // Resolve through requestRef so the key matches the shape the location
          // middleware cached the services under.
          yield* locations.invalidate(requestRef(ctx.request))
        }),
      )
  }),
)

export const SandboxHandler = HttpApiBuilder.group(Api, "server.sandbox", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return handlers
      .handle("sandbox.status", (ctx) =>
        Effect.gen(function* () {
          const sandbox = yield* Sandbox.Service
          return yield* sandbox.status()
        }).pipe(
          Effect.provide(locations.get(requestRef(ctx.request))),
          locationErrors,
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)))
              : Effect.fail(new ServiceUnavailableError({ message: Cause.pretty(cause), service: "sandbox" })),
          ),
        ),
      )
  }),
)
