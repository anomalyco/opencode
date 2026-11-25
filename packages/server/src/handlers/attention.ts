import { SessionAttention } from "@opencode/core/session/attention"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const AttentionHandler = HttpApiBuilder.group(Api, "server.attention", (handlers) =>
  handlers.handle(
    "attention.list",
    Effect.fn("server.attention.list")(function* () {
      const attention = yield* SessionAttention.Service
      return yield* response(attention.list())
    }),
  ),
)
