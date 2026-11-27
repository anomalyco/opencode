import type { ProviderPackage } from "../provider-package.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { Provider } from "../provider.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export type Settings = ProviderPackage.Settings &
  OpenResponsesProviderOptionsInput & {
    readonly accessToken?: string
    readonly apiKey?: never
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

export const responses = OpenResponses.statelessApi
  .extend({ id: "google-vertex-responses" })
  .configure({ metadataKey: "vertex" })

export const googleVertexResponses = Provider.make({
  ...GoogleVertexShared.shared,
  apis: [responses],
  settings: GoogleVertexShared.oauthSettings(
    "Responses",
    (project, location) =>
      `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/endpoints/openapi`,
  ),
})

export const model = Provider.entrypoint<Settings, OpenResponsesProviderOptionsInput>(googleVertexResponses)
