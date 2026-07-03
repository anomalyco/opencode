import { Vcs } from "@opencode-ai/core/vcs"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const VcsHandler = HttpApiBuilder.group(Api, "server.vcs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("vcs.status", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.status()
          }),
        ),
      )
      .handle("vcs.diff", (ctx) =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.diff(ctx.query.mode, { context: ctx.query.context })
          }),
        ),
      )
  }),
)
