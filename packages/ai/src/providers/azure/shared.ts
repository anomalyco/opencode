import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"
import { Auth } from "../../route/auth.js"
import { AuthOptions, type AtLeastOne, type ProviderAuthOption } from "../../route/auth-options.js"
import type { CompactionOperations } from "../../route/client.js"
import { Endpoint } from "../../route/endpoint.js"
import { ProviderConfigurationError, ProviderID, type LanguageModel, type ProviderOptions } from "../../schema/index.js"
import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import type { OpenAIProviderOptionsInput } from "../openai-options.js"

export const id = ProviderID.make("azure")

// Azure needs the customer's resource URL; supply either `resourceName`
// (helper builds the URL) or `baseURL` directly.
type AzureURL = AtLeastOne<{ readonly resourceName: string; readonly baseURL: string }>

/** Where an Azure resource is and how to reach it. */
export type Connection = AzureURL &
  ProviderAuthOption<"optional"> & {
    readonly apiVersion?: string
    readonly queryParams?: Record<string, string>
    readonly useDeploymentBasedUrls?: boolean
  }

export type Settings<Options = OpenAIProviderOptionsInput> = ProviderPackage.Settings &
  Options &
  AzureURL & {
    readonly apiKey?: string | false
    readonly apiVersion?: string
    readonly queryParams?: Readonly<Record<string, string>>
    readonly useDeploymentBasedUrls?: boolean
  }

export type MessagesSettings = Settings<AnthropicMessages.ProviderOptionsInput>

export interface Target {
  readonly baseURL: string
  readonly query?: Record<string, string>
}

/** The resource key from `apiKey` or `AZURE_OPENAI_API_KEY`, sent as `header` instead of `Authorization`. */
export const auth = (input: ProviderAuthOption<"optional">, header = "api-key") => {
  if ("auth" in input && input.auth) return input.auth
  return Auth.remove("authorization").andThen(AuthOptions.apiKey(input, "AZURE_OPENAI_API_KEY", Auth.header(header)))
}

/** The same auth as `auth` with no settings, for providers built without an entrypoint. */
export const authentication = (header = "api-key") =>
  Provider.apiKey("AZURE_OPENAI_API_KEY", (credential) =>
    Auth.remove("authorization").andThen(credential.header(header)),
  )

/** The Azure OpenAI v1 URL, a deployment URL, or a non-Azure `baseURL` as is. */
export const endpoint = (input: Connection, modelID: string): Target => {
  const baseURL = Endpoint.trimBaseUrl(input.baseURL ?? `https://${input.resourceName!.trim()}.openai.azure.com/openai`)
  const query = { "api-version": input.apiVersion ?? "v1", ...input.queryParams }

  if (input.useDeploymentBasedUrls) return { baseURL: `${baseURL}/deployments/${modelID}`, query }
  if (input.baseURL !== undefined && !new URL(input.baseURL).hostname.endsWith(".openai.azure.com")) {
    return { baseURL, query: input.queryParams }
  }
  return { baseURL: `${baseURL}/v1`, query }
}

/** Splits flat settings into the resource connection and everything else. */
export const connection = <Options>({
  apiKey,
  apiVersion,
  baseURL,
  queryParams,
  resourceName,
  useDeploymentBasedUrls,
  ...rest
}: Settings<Options>) => {
  const common = { apiKey, apiVersion, queryParams, useDeploymentBasedUrls }
  if (baseURL !== undefined) return { input: { ...common, baseURL } satisfies Connection, rest }
  if (resourceName !== undefined) return { input: { ...common, resourceName } satisfies Connection, rest }
  throw new ProviderConfigurationError({ provider: id, message: "Azure requires resourceName or baseURL" })
}

/**
 * The `model(modelID, settings)` entrypoint for one Azure API. The URL depends on the deployment, so the connection
 * resolves per model instead of through the provider's settings hook.
 */
export const entrypoint =
  <
    Options extends ProviderOptions,
    Compact extends CompactionOperations | undefined = CompactionOperations | undefined,
  >(
    provider: Provider.AnyProvider,
    target: (input: Connection, modelID: string) => Target,
    header?: string,
  ) =>
  (modelID: string, settings: Settings<Options>): LanguageModel<Options, Compact> => {
    const resolved = connection(settings)
    return Provider.entrypoint<ProviderPackage.Settings, Options, Compact>(
      provider.with({ ...target(resolved.input, modelID), auth: auth(resolved.input, header) }),
    )(modelID, resolved.rest)
  }
