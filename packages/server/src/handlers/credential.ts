import { Credential } from "@opencode-ai/core/credential"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.update",
      Effect.fn(function* (ctx) {
        yield* (yield* Credential.Service).update(ctx.params.credentialID, { label: ctx.payload.label })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn(function* (ctx) {
        yield* (yield* Credential.Service).remove(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
