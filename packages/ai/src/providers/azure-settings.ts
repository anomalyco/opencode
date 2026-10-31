import { ProviderConfigurationError, ProviderID } from "../schema/index.js"
import type { Config, Settings } from "./azure.js"

export const config = ({
  apiKey,
  apiVersion,
  baseURL,
  body,
  headers,
  queryParams,
  resourceName,
  useDeploymentBasedUrls,
  ...providerOptions
}: Settings<Config["providerOptions"]>): Config => {
  const common = {
    apiKey,
    apiVersion,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
    queryParams,
    useDeploymentBasedUrls,
  }
  if (baseURL !== undefined) return { ...common, baseURL }
  if (resourceName !== undefined) return { ...common, resourceName }
  throw new ProviderConfigurationError({
    provider: ProviderID.make("azure"),
    message: "Azure requires resourceName or baseURL",
  })
}
