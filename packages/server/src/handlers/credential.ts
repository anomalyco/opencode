import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.update",
      Effect.fn(function* (ctx) {
        const integration = yield* Integration.Service
        yield* integration.connection.update(ctx.params.credentialID, { label: ctx.payload.label })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn(function* (ctx) {
        const integration = yield* Integration.Service
        yield* integration.connection.remove(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
