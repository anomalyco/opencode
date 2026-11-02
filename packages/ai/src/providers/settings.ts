import type { ProviderPackage } from "../provider-package.js"

type Connection = "apiKey" | "baseURL" | "body" | "headers"

/**
 * Splits flat provider settings into connection config, treating every other key as a provider option.
 * The overload keeps each provider's option keys; a generic rest would type them as `Omit`, which collapses
 * to the `Settings` index signature.
 */
export function toConfig<Settings extends ProviderPackage.Settings>(
  settings?: Settings,
): {
  apiKey: Settings["apiKey"]
  baseURL: Settings["baseURL"]
  headers: Settings["headers"]
  http: { body: NonNullable<Settings["body"]> } | undefined
  providerOptions: { [Key in keyof Settings as Key extends Connection ? never : Key]: Settings[Key] }
}
export function toConfig({ apiKey, baseURL, body, headers, ...providerOptions }: ProviderPackage.Settings = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}
