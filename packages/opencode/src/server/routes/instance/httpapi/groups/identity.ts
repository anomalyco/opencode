import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"

const MeResponse = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  tenantId: Schema.NullOr(Schema.String),
  isAdmin: Schema.Boolean,
  balance: Schema.Number,
}).annotate({ identifier: "IdentityMe" })

export const IdentityPaths = {
  me: "/identity/me",
} as const

export const IdentityApi = HttpApi.make("identity").add(
  HttpApiGroup.make("identity")
    .add(
      HttpApiEndpoint.get("me", IdentityPaths.me, {
        success: described(MeResponse, "Current user identity with token balance"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "identity.me",
          summary: "Get current user",
          description:
            "Retrieve the currently authenticated user's identity information and token balance. Returns 401 when no session is active.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "identity",
        description: "User identity and session information.",
      }),
    )
    .middleware(Authorization),
)
