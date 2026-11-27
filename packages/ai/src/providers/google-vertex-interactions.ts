import type { ProviderPackage } from "../provider-package.js"
import { GoogleInteractions } from "../protocols/google-interactions.js"
import { Provider } from "../provider.js"
import { Auth } from "../route/auth.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"

export type GoogleInteractionsOptionsInput = GoogleInteractions.OptionsInput

export type Settings = ProviderPackage.Settings &
  GoogleInteractions.ProviderOptionsInput &
  (
    | { readonly accessToken?: string; readonly apiKey?: never }
    | { readonly accessToken?: never; readonly apiKey?: string }
  ) & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

export const interactions = GoogleInteractions.api
  .extend({ id: "google-vertex-interactions", headers: GoogleVertexShared.serviceTierHeader })
  .configure({ metadataKey: "vertex", query: { alt: "sse" } })

export const googleVertexInteractions = Provider.make({
  ...GoogleVertexShared.shared,
  apis: [interactions],
  settings: {
    keys: GoogleVertexShared.connectionKeys,
    patch: (values: GoogleVertexShared.ConnectionSettings): Provider.Patch => {
      const apiKey = GoogleVertexShared.apiKey(values)
      const location = GoogleVertexShared.location(values.location)
      const project = GoogleVertexShared.project(values.project)
      return {
        baseURL:
          values.baseURL ??
          `https://${GoogleVertexShared.host(location)}/v1beta1/${apiKey === undefined ? `projects/${GoogleVertexShared.requireProject(project)}/` : ""}locations/${location}`,
        auth: apiKey === undefined ? GoogleVertexShared.oauth(values, project) : Auth.header("x-goog-api-key", apiKey),
      }
    },
  },
})

export const model = Provider.entrypoint<Settings, GoogleInteractions.ProviderOptionsInput>(googleVertexInteractions)
