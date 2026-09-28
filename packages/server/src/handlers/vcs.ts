import { Plugin } from "@opencode/core/plugin"
import { Vcs } from "@opencode/core/vcs"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

// A cold location registers its VCS provider during plugin activation.
const service = Plugin.awaitActivation.pipe(Effect.andThen(Vcs.Service))

export const VcsHandler = HttpApiBuilder.group(Api, "server.vcs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("vcs.get", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs.info()
          }),
        ),
      )
      .handle("vcs.base", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs
              .base()
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
      .handle("vcs.status", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs.status()
          }),
        ),
      )
      .handle("vcs.branch.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs.branches({ search: ctx.query.search, limit: Math.min(ctx.query.limit ?? 50, 100) })
          }),
        ),
      )
      .handle("vcs.diff", (ctx) =>
        response(
          Effect.gen(function* () {
            const vcs = yield* service
            return yield* vcs
              .diff(ctx.query.mode, { context: ctx.query.context, base: ctx.query.base })
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
  }),
)
