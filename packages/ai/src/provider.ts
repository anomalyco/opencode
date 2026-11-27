import { Api, type Binding, type CapabilitiesOf, type CompactOf } from "./api.js"
import { Capabilities } from "./capabilities.js"
import type { ProviderPackage } from "./provider-package.js"
import { Auth } from "./route/auth.js"
import { AuthOptions, type ApiKey } from "./route/auth-options.js"
import type { CompactionOperations } from "./route/client.js"
import {
  LanguageModel,
  mergeProviderOptions,
  mergeRequestOptions,
  ProviderID,
  type ProviderOptions,
  type RequestOptions,
} from "./schema/index.js"

/** How a provider authenticates. The kind tells hosts whether an API key applies. */
export type Authentication =
  | {
      readonly kind: "api-key"
      /** Environment variables tried in order when no key is passed. */
      readonly env: ReadonlyArray<string>
      readonly apply: (credential: Auth.Credential) => Auth.Definition
    }
  | { readonly kind: "none" }
  | { readonly kind: "custom"; readonly definition: Auth.Definition }

/** An API key read from `env` unless one is passed, sent as `Authorization: Bearer` unless `apply` says otherwise. */
export const apiKey = (
  env: string | ReadonlyArray<string>,
  apply: (credential: Auth.Credential) => Auth.Definition = (credential) => credential.bearer(),
): Authentication => ({ kind: "api-key", env: typeof env === "string" ? [env] : env, apply })

export const keyless: Authentication = { kind: "none" }

export const custom = (definition: Auth.Definition): Authentication => ({ kind: "custom", definition })

/** Connection settings applied over a provider. Later patches win; headers, query and body merge by key. */
export interface Patch {
  readonly apiKey?: ApiKey
  readonly auth?: Auth.Definition
  /** Replaces the base URL of every API the provider serves. */
  readonly baseURL?: string
  readonly query?: Record<string, string>
  readonly headers?: Record<string, string>
  readonly body?: Record<string, unknown>
  readonly providerOptions?: ProviderOptions
  readonly options?: RequestOptions
}

/** Extra flat `model(id, settings)` keys a provider reads as connection settings rather than provider options. */
export interface SettingsHook {
  readonly keys: ReadonlyArray<string>
  readonly patch: (values: Readonly<Record<string, unknown>>) => Patch
}

export interface Input<Apis extends Record<string, Binding>> {
  readonly id: string
  readonly auth: Authentication
  /** The APIs this provider serves. The first one is the default. */
  readonly apis: Apis
  readonly settings?: SettingsHook
}

export interface ModelOptions<A extends Binding> {
  readonly capabilities?: CapabilitiesOf<A["api"]>
  readonly options?: RequestOptions
}

export interface Definition<Apis extends Record<string, Binding> = Record<string, Binding>> {
  readonly id: ProviderID
  readonly auth: Authentication
  readonly apis: Apis
  readonly settings?: SettingsHook
  /** A model on one of the provider's APIs: `api` when given, otherwise the first one listed. */
  readonly model: <const Name extends keyof Apis & string = keyof Apis & string>(
    modelID: string,
    options?: ModelOptions<Apis[Name]> & { readonly api?: Name },
  ) => LanguageModel<ProviderOptions, CompactOf<Apis[Name]["api"]>>
  readonly with: (patch: Patch) => Definition<Apis>
}

// Entrypoints take any provider; the model they return is typed by the entrypoint instead.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyProvider = Definition<any>

export const make = <const Apis extends Record<string, Binding>>(input: Input<Apis>): Definition<Apis> =>
  build(input, {})

const build = <Apis extends Record<string, Binding>>(input: Input<Apis>, connection: Patch): Definition<Apis> => ({
  id: ProviderID.make(input.id),
  auth: input.auth,
  apis: input.apis,
  settings: input.settings,
  model: (modelID, options = {}) => {
    const name = options.api ?? Object.keys(input.apis)[0]
    const binding = input.apis[name]
    if (binding === undefined) throw new Error(`Provider ${input.id} does not serve a ${name} API`)
    const guess = binding.guess?.(modelID)
    const capabilities = Capabilities.merge(
      binding.api.capabilities,
      guess?.capabilities,
      binding.capabilities,
      options.capabilities,
    )
    return Api.route(binding, {
      provider: input.id,
      baseURL: connection.baseURL,
      query: connection.query,
      auth: authentication(input.auth, connection),
      options: mergeRequestOptions(guess?.options, requestOptions(connection)),
    }).model({ id: modelID, ...Capabilities.project(capabilities), options: options.options })
  },
  with: (patch) => build(input, mergePatch(connection, patch)),
})

/**
 * The `model(modelID, settings)` function a per-API package entrypoint exports. Settings are flat: `apiKey`,
 * `baseURL`, `headers` and `body` are connection settings, as are the provider's own `settings.keys`; every other
 * key is a provider option.
 */
export const entrypoint =
  <
    Settings extends ProviderPackage.Settings = ProviderPackage.Settings,
    Options extends ProviderOptions = ProviderOptions,
    Compact extends CompactionOperations | undefined = CompactionOperations | undefined,
  >(
    provider: AnyProvider,
    api?: string,
  ): ProviderPackage.Model<Settings, Options, Compact> =>
  (modelID, ...rest) =>
    provider.with(fromSettings(provider, rest[0] ?? {})).model(modelID, { api }) as LanguageModel<Options, Compact>

const fromSettings = (provider: AnyProvider, settings: ProviderPackage.Settings): Patch => {
  const own = new Set(provider.settings?.keys)
  const entries = Object.entries(settings)
  const pick = (keep: (key: string) => boolean) => Object.fromEntries(entries.filter(([key]) => keep(key)))
  const connection = new Set(["apiKey", "baseURL", "headers", "body"])
  const hooked = own.size === 0 ? {} : provider.settings!.patch(pick((key) => own.has(key)))
  return mergePatch(hooked, {
    apiKey: settings.apiKey as ApiKey | undefined,
    baseURL: settings.baseURL,
    headers: settings.headers,
    body: settings.body,
    providerOptions: pick((key) => !connection.has(key) && !own.has(key)),
  })
}

const mergePatch = (base: Patch, next: Patch): Patch => ({
  apiKey: next.apiKey ?? base.apiKey,
  auth: next.auth ?? base.auth,
  baseURL: next.baseURL ?? base.baseURL,
  query: merged(base.query, next.query),
  headers: merged(base.headers, next.headers),
  body: merged(base.body, next.body),
  providerOptions: mergeProviderOptions(base.providerOptions, next.providerOptions),
  options: mergeRequestOptions(base.options, next.options),
})

const merged = <A extends object>(base: A | undefined, next: A | undefined) =>
  base === undefined ? next : next === undefined ? base : { ...base, ...next }

const requestOptions = (patch: Patch): RequestOptions | undefined =>
  mergeRequestOptions(
    {
      headers: patch.headers,
      http: patch.body === undefined ? undefined : { body: patch.body },
      providerOptions: patch.providerOptions,
    },
    patch.options,
  )

const authentication = (auth: Authentication, patch: Patch): Auth.Definition => {
  if (patch.auth) return patch.auth
  if (auth.kind === "none") return Auth.none
  if (auth.kind === "custom") return auth.definition
  return AuthOptions.apiKey({ apiKey: patch.apiKey }, auth.env, auth.apply)
}

export * as Provider from "./provider.js"
