import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Provider } from "../../provider.js"

function resolveProject(options: Record<string, any>) {
  // models.dev advertises GOOGLE_VERTEX_PROJECT for Vertex, while Google SDKs
  // and ADC examples commonly use the broader Google Cloud project aliases.
  return (
    options.project ??
    process.env.GOOGLE_VERTEX_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCP_PROJECT ??
    process.env.GCLOUD_PROJECT
  )
}

function resolveLocation(options: Record<string, any>) {
  return (
    options.location ??
    process.env.GOOGLE_VERTEX_LOCATION ??
    process.env.GOOGLE_CLOUD_LOCATION ??
    process.env.VERTEX_LOCATION ??
    "us-central1"
  )
}

function vertexEndpoint(location: string) {
  if (location === "global") return "aiplatform.googleapis.com"
  return `${location}-aiplatform.googleapis.com`
}

function replaceVertexVars(value: string, project: string | undefined, location: string) {
  // Vertex OpenAI-compatible endpoints are stored as templates in the catalog;
  // expand them after provider config/env project and location have been resolved.
  return value
    .replaceAll("${GOOGLE_VERTEX_PROJECT}", project ?? "${GOOGLE_VERTEX_PROJECT}")
    .replaceAll("${GOOGLE_VERTEX_LOCATION}", location)
    .replaceAll("${GOOGLE_VERTEX_ENDPOINT}", vertexEndpoint(location))
}

export const GoogleVertexPlugin = define({
  id: "opencode.provider.google.vertex",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (
          !item.provider.package.startsWith("@opencode/ai/providers/google-vertex") &&
          !(
            item.provider.id === Provider.ID.googleVertex &&
            item.provider.package === "@opencode/ai/providers/openai-compatible"
          )
        )
          continue
        const project = resolveProject(item.provider.settings ?? {})
        const location = String(resolveLocation(item.provider.settings ?? {}))
        evt.update(item.provider.id, (provider) => {
          // Vertex authenticates through ADC rather than a key credential, so a
          // resolvable project is what makes the provider usable.
          if (project && provider.activation === "auto") provider.activation = "enabled"
          provider.settings = {
            ...provider.settings,
            ...(project ? { project } : {}),
            location,
            ...(typeof provider.settings?.baseURL === "string"
              ? { baseURL: replaceVertexVars(provider.settings.baseURL, project, location) }
              : {}),
          }
        })
      }
    })
    yield* ctx.model.transform((models) => {
      for (const item of models.provider.list()) {
        if (
          !item.provider.package.startsWith("@opencode/ai/providers/google-vertex") &&
          !(
            item.provider.id === Provider.ID.googleVertex &&
            item.provider.package === "@opencode/ai/providers/openai-compatible"
          )
        )
          continue
        const project = resolveProject(item.provider.settings ?? {})
        const location = String(resolveLocation(item.provider.settings ?? {}))
        for (const model of models.list(item.provider.id)) {
          if (typeof model.settings?.baseURL !== "string") continue
          models.update(item.provider.id, model.id, (draft) => {
            draft.settings = {
              ...draft.settings,
              baseURL: replaceVertexVars(String(draft.settings?.baseURL), project, location),
            }
          })
        }
      }
    })
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.googleVertex) return
        evt.language = evt.sdk.languageModel(String(evt.model.modelID ?? evt.model.id).trim())
      }),
    )
  }),
})
