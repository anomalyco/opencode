import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

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

function authFetch(fetchWithRuntimeOptions?: unknown) {
  // Native Vertex SDKs handle ADC internally. OpenAI-compatible Vertex endpoints
  // do not, so inject a Google access token into their fetch path.
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const { GoogleAuth } = await import("google-auth-library")
    const auth = new GoogleAuth()
    const client = await auth.getApplicationDefault()
    const token = await client.credential.getAccessToken()
    const headers = new Headers(init?.headers)
    headers.set("Authorization", `Bearer ${token.token}`)
    return typeof fetchWithRuntimeOptions === "function"
      ? fetchWithRuntimeOptions(input, { ...init, headers })
      : fetch(input, { ...init, headers })
  }
}

export const GoogleVertexPlugin = PluginV2.define({
  id: PluginV2.ID.make("google-vertex"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.data) {
          if (item.provider.endpoint.type !== "aisdk") continue
          if (
            item.provider.endpoint.package !== "@ai-sdk/google-vertex" &&
            !item.provider.endpoint.package.includes("@ai-sdk/openai-compatible")
          )
            continue
          const project = resolveProject(item.provider.options.aisdk.provider)
          const location = String(resolveLocation(item.provider.options.aisdk.provider))
          evt.provider.update(item.provider.id, (provider) => {
            if (project) provider.options.aisdk.provider.project = project
            provider.options.aisdk.provider.location = location
            if (provider.endpoint.type === "aisdk" && provider.endpoint.url) {
              provider.endpoint.url = replaceVertexVars(provider.endpoint.url, project, location)
            }
            if (provider.endpoint.type === "aisdk" && provider.endpoint.package.includes("@ai-sdk/openai-compatible")) {
              provider.options.aisdk.provider.fetch = authFetch(provider.options.aisdk.provider.fetch)
            }
          })
        }
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.model.providerID === ProviderV2.ID.googleVertex && evt.package.includes("@ai-sdk/openai-compatible")) {
          evt.options.fetch = authFetch(evt.options.fetch)
          return
        }
        if (evt.package !== "@ai-sdk/google-vertex") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/google-vertex"))
        const project = resolveProject(evt.options)
        const location = resolveLocation(evt.options)
        const options = { ...evt.options }
        delete options.fetch
        evt.sdk = mod.createVertex({
          ...options,
          project,
          location,
        })
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.googleVertex) return
        evt.language = evt.sdk.languageModel(String(evt.model.apiID).trim())
      }),
    }
  }),
})

export const GoogleVertexAnthropicPlugin = PluginV2.define({
  id: PluginV2.ID.make("google-vertex-anthropic"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.data) {
          if (item.provider.endpoint.type !== "aisdk") continue
          if (item.provider.endpoint.package !== "@ai-sdk/google-vertex/anthropic") continue
          const project =
            item.provider.options.aisdk.provider.project ??
            process.env.GOOGLE_CLOUD_PROJECT ??
            process.env.GCP_PROJECT ??
            process.env.GCLOUD_PROJECT
          const location =
            item.provider.options.aisdk.provider.location ??
            process.env.GOOGLE_CLOUD_LOCATION ??
            process.env.VERTEX_LOCATION ??
            "global"
          evt.provider.update(item.provider.id, (provider) => {
            if (project) provider.options.aisdk.provider.project = project
            provider.options.aisdk.provider.location = location
          })
        }
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/google-vertex/anthropic") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/google-vertex/anthropic"))
        const project =
          typeof evt.options.project === "string"
            ? evt.options.project
            : (process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT ?? process.env.GCLOUD_PROJECT)
        const location =
          typeof evt.options.location === "string"
            ? evt.options.location
            : (process.env.GOOGLE_CLOUD_LOCATION ?? process.env.VERTEX_LOCATION ?? "global")
        evt.sdk = mod.createVertexAnthropic({
          ...evt.options,
          project,
          location,
          // Continental multi-regions (eu, us) require Regional Endpoint Platform
          // domains; the default {region}-aiplatform.googleapis.com does not resolve.
          ...((location === "eu" || location === "us") && project && !evt.options.baseURL
            ? {
                baseURL: `https://aiplatform.${location}.rep.googleapis.com/v1/projects/${project}/locations/${location}/publishers/anthropic/models`,
              }
            : {}),
        })
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("google-vertex-anthropic")) return
        evt.language = evt.sdk.languageModel(String(evt.model.apiID).trim())
      }),
    }
  }),
})
