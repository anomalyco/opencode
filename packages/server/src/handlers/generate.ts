import { Generate } from "@opencode-ai/core/generate"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const GenerateHandler = HttpApiBuilder.group(Api, "server.generate", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "generate.text",
      Effect.fn("server.generate.text")(function* (request) {
        const generate = yield* Generate.Service
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
