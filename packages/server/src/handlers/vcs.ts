import { Vcs } from "@opencode-ai/core/vcs"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { pluginReadiness } from "./plugin-readiness"

const flushPlugins = pluginReadiness(
  () => new ServiceUnavailableError({ service: "vcs", message: "VCS initialization timed out" }),
)

export const VcsHandler = HttpApiBuilder.group(Api, "server.vcs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("vcs.get", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.info()
          }),
        ),
      )
      .handle("vcs.base", () =>
        response(
          Effect.gen(function* () {
            yield* flushPlugins
            const vcs = yield* Vcs.Service
            return yield* vcs
              .base()
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
      .handle("vcs.status", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.status()
          }),
        ),
      )
      .handle("vcs.branches", (ctx) =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.branches({ search: ctx.query.search, limit: Math.min(ctx.query.limit ?? 50, 100) })
          }),
        ),
      )
      .handle("vcs.diff", (ctx) =>
        response(
          Effect.gen(function* () {
            yield* flushPlugins
            const vcs = yield* Vcs.Service
            return yield* vcs
              .diff(ctx.query.mode, { context: ctx.query.context, base: ctx.query.base })
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
  }),
)
