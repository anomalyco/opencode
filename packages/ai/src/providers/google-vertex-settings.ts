import { ProviderConfigurationError, ProviderID } from "../schema/index.js"
import type { Settings } from "./google-vertex.js"

export function config({
  accessToken,
  apiKey,
  baseURL,
  body,
  headers,
  location,
  project,
  ...providerOptions
}: Settings = {}) {
  if (apiKey !== undefined && accessToken !== undefined)
    throw new ProviderConfigurationError({
      provider: ProviderID.make("google-vertex"),
      message: "Google Vertex apiKey cannot be combined with accessToken or auth",
    })
  return {
    ...(apiKey === undefined ? { accessToken: accessToken } : { apiKey: apiKey }),
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    location,
    project,
    providerOptions,
  }
}
