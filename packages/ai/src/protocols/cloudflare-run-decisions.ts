import { Effect, Schema } from "effect"
import { DecisionRoute } from "../route/decision.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { SystemOne } from "./system-one.js"

const ID = "cloudflare-run-decisions"
const NAME = "Cloudflare Run"

// Workers AI models answer with the System One response; third-party models such as TypeSafe Jev wrap it in a
// completed run record.
const Envelope = Schema.Struct({
  result: Schema.Union([
    SystemOne.Response,
    Schema.Struct({ state: Schema.Literal("Completed"), result: SystemOne.Response }),
  ]),
})

const decodeEnvelope = MediaProtocol.identity({ id: ID, name: NAME, provider: "cloudflare-workers-ai" }).decodeJson(
  Envelope,
)

/** Posts `{ model, input }` to Cloudflare's `/ai/run` with the System One body as `input`; media defaults to Clef's top-level lists. */
export const protocol = DecisionRoute.protocol({
  id: ID,
  name: NAME,
  inlineMedia: true,
  body: {
    from: (request) =>
      SystemOne.encodeBody(request, "images").pipe(Effect.map((input) => ({ model: request.model.id, input }))),
  },
  response: {
    decode: (response, context) =>
      decodeEnvelope(response).pipe(
        Effect.flatMap((output) =>
          SystemOne.toResponse(
            "answers" in output.value.result ? output.value.result : output.value.result.result,
            context.request,
            context.providerMetadataKey,
            output.invalid,
          ),
        ),
      ),
  },
})

/** Providers set the Run API base, `.../client/v4/accounts/{account}/ai/run`, with `route.with(...)`. */
export const route = DecisionRoute.make({
  id: ID,
  provider: "cloudflare-workers-ai",
  protocol,
  endpoint: Endpoint.path(""),
})

export const CloudflareRunDecisions = { protocol, route } as const
