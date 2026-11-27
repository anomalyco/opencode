import { Flag } from "@opencode/core/flag"
import { ConfigFlag } from "@opencode/schema/config/flag"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const FlagHandler = HttpApiBuilder.group(Api, "server.flag", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "experimental.flag.get",
      Effect.fn("server.flag.get")(function* () {
        const flags = yield* Flag.Service
        return yield* response(
          flags.all.pipe(Effect.map((all) => Object.fromEntries(ConfigFlag.ui.map((key) => [key, all[key].enabled])))),
        )
      }),
    )
  }),
)
