import { Gemini } from "./gemini"
import { Auth } from "../route/auth"
import { Route } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"

export const route = Route.make({
  id: "google-vertex-gemini",
  provider: "google-vertex",
  providerMetadataKey: "google",
  protocol: Gemini.protocol,
  endpoint: Endpoint.path(({ request }) => `/models/${request.model.id}:streamGenerateContent?alt=sse`),
  auth: Auth.none,
  framing: Framing.sse,
})

export * as GoogleVertexGemini from "./google-vertex-gemini"
