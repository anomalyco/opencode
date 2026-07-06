import type { RouteDefaultsInput } from "../route/client"
import { Auth } from "../route/auth"
import type { ProviderPackage } from "../provider-package"
import { ProviderID, type ModelID } from "../schema"
import * as BedrockConverse from "../protocols/bedrock-converse"
import type { BedrockCredentials } from "../protocols/bedrock-converse"

export const id = ProviderID.make("amazon-bedrock")

export type Config = RouteDefaultsInput & {
  readonly apiKey?: string
  readonly headers?: Record<string, string>
  readonly credentials?: BedrockCredentials
  /** AWS region. Defaults to `us-east-1` when neither this nor `credentials.region` is set. */
  readonly region?: string
  /** Override the computed `https://bedrock-runtime.<region>.amazonaws.com` URL. */
  readonly baseURL?: string
}

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly auth?: "bearer" | "sigv4"
  readonly baseURL?: string
  readonly credentials?: BedrockCredentials
  readonly region?: string
  readonly topP?: number
}
export const routes = [BedrockConverse.route]

const bedrockBaseURL = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com`

const configuredRoute = (input: Config) => {
  const { apiKey, credentials, region, baseURL, ...rest } = input
  const resolvedRegion = region ?? credentials?.region ?? "us-east-1"
  return BedrockConverse.route.with({
    ...rest,
    provider: id,
    endpoint: { baseURL: baseURL ?? bedrockBaseURL(resolvedRegion) },
    auth: apiKey === undefined ? BedrockConverse.sigV4Auth(credentials) : Auth.bearer(apiKey),
  })
}

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) => {
  if (settings.auth === "bearer" && settings.apiKey === undefined)
    throw new Error("Amazon Bedrock bearer auth requires apiKey")
  if (settings.auth === "sigv4" && settings.apiKey !== undefined)
    throw new Error("Amazon Bedrock SigV4 auth does not accept apiKey")
  return configure({
    apiKey: settings.auth === "sigv4" ? undefined : settings.apiKey,
    baseURL: settings.baseURL,
    credentials: settings.credentials,
    generation: settings.topP === undefined ? undefined : { topP: settings.topP },
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    region: settings.region,
  }).model(modelID)
}
