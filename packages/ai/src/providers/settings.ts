import type { ProviderPackage } from "../provider-package.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { Auth } from "../route/auth.js"

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

type BearerInput = ProviderAuthOption<"optional"> & { readonly baseURL?: string }

/**
 * Turns provider config into route defaults with `Authorization: Bearer` auth. The endpoint falls back to
 * `baseURL` when given, otherwise it is left to the route.
 */
export function bearerRouteDefaults<Input extends BearerInput>(
  input: Input,
  envVar: string | ReadonlyArray<string>,
  baseURL: string,
): Omit<Input, "apiKey" | "auth" | "baseURL"> & { endpoint: { baseURL: string }; auth: Auth.Definition }
export function bearerRouteDefaults<Input extends BearerInput>(
  input: Input,
  envVar: string | ReadonlyArray<string>,
): Omit<Input, "apiKey" | "auth" | "baseURL"> & { endpoint: { baseURL: string } | undefined; auth: Auth.Definition }
export function bearerRouteDefaults(input: BearerInput, envVar: string | ReadonlyArray<string>, baseURL?: string) {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const resolved = endpoint ?? baseURL
  return {
    ...defaults,
    endpoint: resolved === undefined ? undefined : { baseURL: resolved },
    auth: AuthOptions.bearer(input, envVar),
  }
}
