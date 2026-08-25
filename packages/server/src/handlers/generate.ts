import { Generate } from "@opencode-ai/core/generate"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Global } from "@opencode-ai/util/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const GenerateHandler = HttpApiBuilder.group(Api, "server.generate", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const services = locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))
    return handlers.handle(
      "generate.text",
      Effect.fn("server.generate.text")(function* (request) {
        const generate = yield* Generate.Service.pipe(Effect.provide(services))
        const text = yield* generate
          .text(request.payload)
          .pipe(
            Effect.mapError((error) =>
              error._tag === "Generate.ModelSelectionError"
                ? new InvalidRequestError({ message: error.message })
                : new ServiceUnavailableError({ message: error.message, service: error.service }),
            ),
          )
        return { data: { text } }
      }),
    )
  }),
)
