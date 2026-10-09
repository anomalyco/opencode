import { Formatter } from "@opencode/core/formatter"
import { Plugin } from "@opencode/core/plugin"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const FormatterHandler = HttpApiBuilder.group(Api, "server.formatter", (handlers) =>
  handlers.handle(
    "formatter.status",
    Effect.fn(function* () {
      // Formatters are registered by the config plugin, so a cold location must finish activation first.
      yield* Plugin.awaitActivation
      const formatter = yield* Formatter.Service
      return yield* response(formatter.status())
    }),
  ),
)
