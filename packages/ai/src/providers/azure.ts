import { Auth } from "../route/auth"
import { type AtLeastOne, type ProviderAuthOption } from "../route/auth-options"
import type { Route as RouteDef, RouteDefaultsInput } from "../route/client"
import type { ProviderPackage } from "../provider-package"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { ProviderShared } from "../protocols/shared"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export const id = ProviderID.make("azure")
const routeAuth = Auth.remove("authorization")

// Azure needs the customer's resource URL; supply either `resourceName`
// (helper builds the URL) or `baseURL` directly.
type AzureURL = AtLeastOne<{ readonly resourceName: string; readonly baseURL: string }>

export type LanguageModelOptions = AzureURL &
  RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly apiVersion?: string
    readonly queryParams?: Record<string, string>
    readonly useDeploymentBasedUrls?: boolean
    readonly providerOptions?: OpenAIProviderOptionsInput
  }
export type Config = LanguageModelOptions

export type Settings = ProviderPackage.Settings &
  AzureURL & {
    readonly apiKey?: string
    readonly apiVersion?: string
    readonly queryParams?: Readonly<Record<string, string>>
    readonly useDeploymentBasedUrls?: boolean
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

const resourceBaseURL = (resourceName: string) => `https://${resourceName.trim()}.openai.azure.com/openai`

const responsesRoute = OpenAIResponses.route.with({
  id: "azure-openai-responses",
  provider: id,
  auth: routeAuth,
})

const chatRoute = OpenAIChat.route.with({
  id: "azure-openai-chat",
  provider: id,
  auth: routeAuth,
})

export const routes = [responsesRoute, chatRoute]

const defaults = (input: Config) => {
  const {
    apiKey: _,
    apiVersion: _apiVersion,
    resourceName: _resourceName,
    useDeploymentBasedUrls: _useDeploymentBasedUrls,
    baseURL: _baseURL,
    queryParams: _queryParams,
    ...rest
  } = input
  if ("auth" in rest) {
    const { auth: _, ...withoutAuth } = rest
    return withoutAuth
  }
  return rest
}

const auth = (input: Config) => {
  if ("auth" in input && input.auth) return input.auth
  return Auth.remove("authorization").andThen(
    Auth.optional("apiKey" in input ? input.apiKey : undefined, "apiKey")
      .orElse(Auth.config("AZURE_OPENAI_API_KEY"))
      .pipe(Auth.header("api-key")),
  )
}

const configuredRoute = <Body, Prepared>(route: RouteDef<Body, Prepared>, input: Config, modelID: string | ModelID) =>
  route.with({
    auth: auth(input),
    endpoint: endpoint(input, modelID),
  })

function endpoint(input: Config, modelID: string | ModelID) {
  const baseURL = ProviderShared.trimBaseUrl(input.baseURL ?? resourceBaseURL(input.resourceName!))
  const query = { "api-version": input.apiVersion ?? "v1", ...input.queryParams }

  if (input.useDeploymentBasedUrls) return { baseURL: `${baseURL}/deployments/${modelID}`, query }
  if (input.baseURL !== undefined && !new URL(input.baseURL).hostname.endsWith(".openai.azure.com")) {
    return { baseURL, query: input.queryParams }
  }
  return { baseURL: `${baseURL}/v1`, query }
}

export const configure = (input: Config) => {
  const modelDefaults = defaults(input)

  const responses = (modelID: string | ModelID) =>
    configuredRoute(responsesRoute, input, modelID)
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID })

  const chat = (modelID: string | ModelID) =>
    configuredRoute(chatRoute, input, modelID)
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID })

  return {
    id,
    model: responses,
    responses,
    chat,
    configure,
  }
}

export const provider = {
  id,
  configure,
}

const config = (settings: Settings): Config => {
  const common = {
    apiKey: settings.apiKey,
    apiVersion: settings.apiVersion,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    providerOptions: settings.providerOptions,
    queryParams: settings.queryParams === undefined ? undefined : { ...settings.queryParams },
    useDeploymentBasedUrls: settings.useDeploymentBasedUrls,
  }
  if (settings.baseURL !== undefined) return { ...common, baseURL: settings.baseURL }
  if (settings.resourceName !== undefined) return { ...common, resourceName: settings.resourceName }
  throw new Error("Azure requires resourceName or baseURL")
}

export const responsesModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => configure(config(settings)).responses(modelID)
export const chatModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => configure(config(settings)).chat(modelID)
export const model = responsesModel
