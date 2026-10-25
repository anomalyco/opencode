import type { AnyAuthClient, GoogleAuthOptions } from "google-auth-library"
import { Effect, Redacted } from "effect"
import { Auth, MissingCredentialError } from "../route/auth.js"
import { ProviderConfigurationError, ProviderID } from "../schema/index.js"

const SCOPE = "https://www.googleapis.com/auth/cloud-platform"
const id = ProviderID.make("google-vertex")

export const loadADCClient = async (project?: string) => {
  const { GoogleAuth } = await import("google-auth-library")
  // google-auth-library 10.5.0 ignores CLOUDSDK_CONFIG during ADC file discovery.
  // Fix this in shipped AI code: a repository-level Bun dependency patch would not
  // reach npm or Bun consumers of the published @opencode/ai package.
  // Override only the well-known-file lookup: keyFilename bypasses ADC's quota-project
  // preparation. Keep explicit credentials and metadata fallback in Google's ADC chain.
  class CloudSDKAuth extends GoogleAuth {
    override async _tryGetApplicationCredentialsFromWellKnownFile(options?: GoogleAuthOptions["clientOptions"]) {
      const config = process.env.CLOUDSDK_CONFIG
      if (!config) return super._tryGetApplicationCredentialsFromWellKnownFile(options)
      // Keep local filesystem helpers lazy for explicitly authenticated Worker callers;
      // this ADC-file lookup itself requires a Node-compatible filesystem.
      const { existsSync } = await import("node:fs")
      const { homedir } = await import("node:os")
      const { join } = await import("node:path")
      const directory = config === "~" ? homedir() : config.startsWith("~/") ? join(homedir(), config.slice(2)) : config
      const file = join(directory, "application_default_credentials.json")
      if (!existsSync(file)) return null
      return this._getApplicationCredentialsFromFilePath(file, options)
    }
  }
  return new CloudSDKAuth({ projectId: project, scopes: [SCOPE] }).getClient()
}

export type OAuthOptions =
  | { readonly accessToken?: string; readonly auth?: never }
  | { readonly accessToken?: never; readonly auth?: Auth.Definition }

export type ApiKeyOptions =
  | (OAuthOptions & { readonly apiKey?: never })
  | { readonly accessToken?: never; readonly apiKey?: string; readonly auth?: never }

export const project = (value?: string) =>
  value ??
  process.env.GOOGLE_VERTEX_PROJECT ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GCP_PROJECT ??
  process.env.GCLOUD_PROJECT

export const location = (value: string | undefined) =>
  value ??
  process.env.GOOGLE_VERTEX_LOCATION ??
  process.env.GOOGLE_CLOUD_LOCATION ??
  process.env.VERTEX_LOCATION ??
  "global"

export const host = (location: string) => {
  if (location === "global") return "aiplatform.googleapis.com"
  // Jurisdictional multi-regions use Regional Endpoint Platform domains.
  if (location === "eu" || location === "us") return `aiplatform.${location}.rep.googleapis.com`
  return `${location}-aiplatform.googleapis.com`
}

export const requireProject = (value: string | undefined) => {
  if (value) return value
  throw new ProviderConfigurationError({
    provider: id,
    message: "Google Vertex requires a project when baseURL is not configured",
  })
}

export const apiKey = (input: ApiKeyOptions & { readonly project?: string; readonly location?: string }) => {
  if (input.apiKey !== undefined && (input.accessToken !== undefined || input.auth !== undefined))
    throw new ProviderConfigurationError({
      provider: id,
      message: "Google Vertex apiKey cannot be combined with accessToken or auth",
    })
  if (input.accessToken !== undefined || input.auth !== undefined) return undefined
  if (input.apiKey !== undefined) return input.apiKey
  // Same precedence as Google's Gen AI SDK: an explicit project or location selects Google credentials,
  // so an ambient API key cannot replace them.
  if (input.project !== undefined || input.location !== undefined) return undefined
  return process.env.GOOGLE_VERTEX_API_KEY
}

const adc = (project?: string) => {
  let client: Promise<AnyAuthClient> | undefined
  const loadClient = () => {
    if (client) return client
    client = loadADCClient(project)
    return client
  }
  return Auth.effect(
    Effect.tryPromise({
      try: async () => {
        const token = await (await loadClient()).getAccessToken()
        if (!token.token) throw new Error("Google ADC returned an empty access token")
        return Redacted.make(token.token)
      },
      catch: () => new MissingCredentialError("Google Application Default Credentials"),
    }),
  ).bearer()
}

export const oauth = (input: OAuthOptions, project?: string) => {
  if (input.accessToken !== undefined && input.auth !== undefined)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Google Vertex accessToken cannot be combined with auth",
    })
  if (input.auth) return input.auth
  if (input.accessToken !== undefined) return Auth.bearer(input.accessToken)
  return adc(project)
}

export * as GoogleVertexShared from "./google-vertex-shared.js"
