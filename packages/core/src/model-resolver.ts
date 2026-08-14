export * as ModelResolver from "./model-resolver.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { LanguageModel } from "@opencode-ai/ai"
// ast-grep-ignore: no-star-import
import * as AnthropicMessages from "@opencode-ai/ai/protocols/anthropic-messages"
// ast-grep-ignore: no-star-import
import * as OpenAICompatibleChat from "@opencode-ai/ai/protocols/openai-compatible-chat"
// ast-grep-ignore: no-star-import
import * as OpenAIResponses from "@opencode-ai/ai/protocols/openai-responses"
import { Auth, type AnyRoute } from "@opencode-ai/ai/route"
import { Context, Effect, Layer, Schema } from "effect"
import { produce } from "immer"
import { AISDK } from "./aisdk.js"
import { AISDKNative } from "./aisdk-native.js"
import { Catalog } from "./catalog.js"
import { Credential } from "./credential.js"
import { Integration } from "./integration.js"
import { Capabilities, ID, Info, Ref, VariantID } from "./model.js"
import { Npm } from "@opencode-ai/util/npm"
import { Provider } from "./provider.js"

export class VariantUnavailableError extends Schema.TaggedErrorClass<VariantUnavailableError>()(
  "SessionRunnerModel.VariantUnavailableError",
  {
    providerID: Provider.ID,
    modelID: ID,
    variant: VariantID,
  },
) {
  override get message() {
    return `Variant unavailable for ${this.providerID}/${this.modelID}: ${this.variant}`
  }
}

export class UnsupportedPackageError extends Schema.TaggedErrorClass<UnsupportedPackageError>()(
  "SessionRunnerModel.UnsupportedPackageError",
  {
    providerID: Provider.ID,
    modelID: ID,
    package: Schema.String,
  },
) {
  override get message() {
    return `Unsupported package for ${this.providerID}/${this.modelID}: ${this.package}`
  }
}

export class UnresolvedProviderVariablesError extends Schema.TaggedErrorClass<UnresolvedProviderVariablesError>()(
  "SessionRunnerModel.UnresolvedProviderVariablesError",
  {
    providerID: Provider.ID,
    modelID: ID,
    variables: Schema.Array(Schema.String),
  },
) {
  override get message() {
    return `Cannot initialize ${this.providerID}/${this.modelID}: ${this.variables.join(", ")} ${this.variables.length === 1 ? "is" : "are"} required to resolve the provider endpoint`
  }
}

export type Error =
  | VariantUnavailableError
  | UnsupportedPackageError
  | UnresolvedProviderVariablesError
  | Integration.AuthorizationError

export interface Resolved {
  /** Route-level model for provider requests; its id is the provider API model id, which may differ from the catalog id. */
  readonly model: LanguageModel
  /** Selected catalog identity. Durable records and displays must use this, never the API model id. */
  readonly ref: Ref
  /** Catalog capabilities used to shape requests before provider lowering. */
  readonly capabilities: Capabilities
  /** Catalog pricing in dollars per million tokens. */
  readonly cost: Info["cost"]
}

export interface Interface {
  readonly resolve: (requested?: Ref) => Effect.Effect<Resolved | undefined, Error>
  readonly resolveModel: (model: Info, variant?: VariantID) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelResolver") {}

const apiKey = (model: Info, credential?: Credential.Value) => {
  if (credential?.type === "key") return Auth.value(credential.key)
  if (credential?.type === "oauth") return Auth.value(credential.access)
  const value = model.settings?.apiKey
  if (typeof value === "string") return Auth.value(value)
  return undefined
}

const withDefaults = (model: Info, route: AnyRoute) =>
  route.with({
    provider: model.providerID,
    endpoint: typeof model.settings?.baseURL === "string" ? { baseURL: model.settings.baseURL } : undefined,
    headers: providerHeaders(model),
    providerOptions: providerOptions(model),
    http: model.body === undefined ? undefined : { body: model.body },
    limits: { context: model.limit.context, input: model.limit.input, output: model.limit.output },
  })

const providerHeaders = (model: Info) => {
  const packageName = Provider.packageName(model.package)
  const generated = new Map<string, string>()
  if (packageName === "@ai-sdk/openai" && typeof model.settings?.organization === "string")
    generated.set("OpenAI-Organization", model.settings.organization)
  if (packageName === "@ai-sdk/openai" && typeof model.settings?.project === "string")
    generated.set("OpenAI-Project", model.settings.project)
  if (packageName === "@ai-sdk/anthropic" && typeof model.settings?.authToken === "string")
    generated.set("Authorization", `Bearer ${model.settings.authToken}`)
  return Provider.mergeHeaders(generated.size === 0 ? undefined : Object.fromEntries(generated), model.headers)
}

const providerOptions = (model: Info): { readonly [key: string]: { readonly [key: string]: unknown } } | undefined => {
  if (!Provider.isAISDK(model.package) || model.settings === undefined) return undefined
  const { apiKey: _, baseURL: _baseURL, ...settings } = model.settings
  if (Object.keys(settings).length === 0) return undefined
  const packageName = Provider.packageName(model.package)
  if (packageName === "@ai-sdk/openai") return { openai: settings }
  if (packageName === "@ai-sdk/anthropic") return { anthropic: settings }
  if (packageName === "@ai-sdk/openai-compatible") return { openai: settings }
  return undefined
}

export const withVariant = (
  model: Info,
  variantID: VariantID | undefined,
): Effect.Effect<Info, VariantUnavailableError> => {
  const id = variantID === "default" ? undefined : variantID
  const variant = model.variants?.find((item) => item.id === id)
  if (!variant && variantID !== undefined && variantID !== "default")
    return Effect.fail(
      new VariantUnavailableError({
        providerID: model.providerID,
        modelID: model.id,
        variant: variantID,
      }),
    )
  return Effect.succeed(
    variant
      ? produce(model, (draft) => {
          draft.settings = Provider.mergeOverlay(draft.settings, variant.settings)
          draft.headers = Provider.mergeHeaders(draft.headers, variant.headers)
          draft.body = Provider.mergeOverlay(draft.body, variant.body)
        })
      : model,
  )
}

export interface Dependencies {
  readonly loadPackage?: (specifier: string) => Effect.Effect<Provider.ProviderPackage, Provider.LoadError>
  readonly loadAISDK?: (model: Info) => Effect.Effect<LanguageModel, AISDK.InitError>
}

export const fromCatalogModel = (
  model: Info,
  credential?: Credential.Value,
  dependencies?: Dependencies,
): Effect.Effect<LanguageModel, UnsupportedPackageError | UnresolvedProviderVariablesError> =>
  resolveCatalogModel(model, credential, dependencies).pipe(
    Effect.flatMap((resolved) => validateProviderVariables(model, resolved)),
  )

const resolveCatalogModel = Effect.fn("ModelResolver.resolveCatalogModel")(function* (
  model: Info,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) {
  const resolved = prepareRuntimeModel(model, credential)
  const packageName = Provider.packageName(resolved.package)
  const key = apiKey(resolved, credential)
  const configuration = credential?.type === "key" ? credential.configuration : undefined

  if (Provider.isAISDK(resolved.package) && packageName === "@ai-sdk/openai") {
    const runtime = yield* prepareProviderModel(resolved)
    return withDefaults(runtime, OpenAIResponses.route)
      .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
      .model({ id: runtime.modelID ?? runtime.id, compatibility: runtime.compatibility })
  }
  if (Provider.isAISDK(resolved.package) && packageName === "@ai-sdk/anthropic") {
    const runtime = yield* prepareProviderModel(resolved)
    return withDefaults(runtime, AnthropicMessages.route)
      .with({ auth: key === undefined ? Auth.none : Auth.header("x-api-key", key) })
      .model({ id: runtime.modelID ?? runtime.id, compatibility: runtime.compatibility })
  }
  if (
    Provider.isAISDK(resolved.package) &&
    packageName === "@ai-sdk/openai-compatible" &&
    typeof resolved.settings?.baseURL === "string"
  ) {
    const runtime = yield* prepareProviderModel(resolved)
    return withDefaults(runtime, OpenAICompatibleChat.route)
      .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
      .model({ id: runtime.modelID ?? runtime.id, compatibility: runtime.compatibility })
  }
  const configured = { ...resolved.settings, ...credential?.metadata, ...configuration }
  const mapping = Provider.isAISDK(resolved.package)
    ? AISDKNative.map({
        packageName,
        settings: configured,
        modelID: resolved.modelID ?? resolved.id,
      })
    : undefined
  const native = mapping?.package ?? resolved.package
  if (Provider.isAISDK(resolved.package) && !mapping) {
    const loadAISDK = dependencies?.loadAISDK
    if (!loadAISDK) return yield* unsupported(resolved)
    const settings = yield* prepareProviderSettings(
      resolved,
      Provider.mergeOverlay(resolved.settings, {
        ...nativeCredentialSettings(resolved.package ?? "", credential),
        ...credential?.metadata,
        ...configuration,
      }) ?? {},
    )
    const runtime = produce(resolved, (draft) => {
      draft.settings = settings
    })
    return yield* loadAISDK(runtime).pipe(Effect.mapError(() => unsupported(resolved)))
  }
  if (!native) return yield* unsupported(resolved)

  const specifier = native
  const mapped = yield* prepareProviderSettings(resolved, mapping?.settings ?? configured)
  const module = yield* (dependencies?.loadPackage ?? Provider.loadPackage)(specifier).pipe(
    Effect.mapError(() => unsupported(resolved)),
  )
  const settings = {
    ...(credential ? withoutNativeAuthSettings(mapped) : mapped),
    ...nativeCredentialSettings(specifier, credential),
    headers: Provider.mergeHeaders(mapping?.headers, resolved.headers),
    body: Provider.mergeOverlay(mapping?.body, resolved.body),
    limits: { context: resolved.limit.context, input: resolved.limit.input, output: resolved.limit.output },
  }
  return yield* Effect.try({
    try: () => {
      const runtime = module.model(resolved.modelID ?? resolved.id, settings)
      return LanguageModel.update(runtime, {
        provider: resolved.providerID,
        compatibility: resolved.compatibility
          ? Object.assign({}, runtime.compatibility, resolved.compatibility)
          : runtime.compatibility,
      })
    },
    catch: () => unsupported(resolved),
  })
})

function prepareRuntimeModel(model: Info, credential: Credential.Value | undefined) {
  if (model.settings?.apiKey !== "" && (credential?.type !== "key" || credential.metadata === undefined)) return model
  return produce(model, (draft) => {
    if (draft.settings?.apiKey === "") delete draft.settings.apiKey
    if (credential?.type === "key" && credential.metadata !== undefined)
      draft.body = Provider.mergeOverlay(draft.body, credential.metadata)
  })
}

function validateProviderVariables(
  model: Info,
  resolved: LanguageModel,
): Effect.Effect<LanguageModel, UnresolvedProviderVariablesError> {
  const baseURL = resolved.route.endpoint.baseURL
  if (typeof baseURL !== "string") return Effect.succeed(resolved)
  const failure = unresolvedProviderVariables(model, baseURL)
  return failure ? Effect.fail(failure) : Effect.succeed(resolved)
}

function prepareProviderModel(model: Info): Effect.Effect<Info, UnresolvedProviderVariablesError> {
  if (!model.settings) return Effect.succeed(model)
  return prepareProviderSettings(model, model.settings).pipe(
    Effect.map((settings) =>
      settings === model.settings
        ? model
        : produce(model, (draft) => {
            draft.settings = settings
          }),
    ),
  )
}

function prepareProviderSettings(
  model: Info,
  settings: Readonly<Record<string, unknown>>,
): Effect.Effect<Readonly<Record<string, unknown>>, UnresolvedProviderVariablesError> {
  const baseURL = settings.baseURL
  if (typeof baseURL !== "string") return Effect.succeed(settings)
  return prepareProviderURL(model, baseURL).pipe(
    Effect.map((prepared) => (prepared === baseURL ? settings : { ...settings, baseURL: prepared })),
  )
}

function prepareProviderURL(model: Info, baseURL: string): Effect.Effect<string, UnresolvedProviderVariablesError> {
  if (!baseURL.includes("${")) return Effect.succeed(baseURL)
  const prepared = baseURL.replace(/\$\{([^}]+)\}/g, (placeholder, name: string) => process.env[name] ?? placeholder)
  const failure = unresolvedProviderVariables(model, prepared)
  return failure ? Effect.fail(failure) : Effect.succeed(prepared)
}

function unresolvedProviderVariables(model: Info, baseURL: string) {
  const variables = new Set(Array.from(baseURL.matchAll(/\$\{([^}]+)\}/g), (match) => match[1]))
  if (variables.size === 0) return
  return new UnresolvedProviderVariablesError({
    providerID: model.providerID,
    modelID: model.id,
    variables: Array.from(variables),
  })
}

const nativeCredentialSettings = (specifier: string, credential: Credential.Value | undefined) => {
  if (!credential) return {}
  if (credential.type === "key") return { apiKey: credential.key }
  if (
    specifier === "@opencode-ai/ai/providers/anthropic" ||
    specifier === "@opencode-ai/ai/providers/anthropic-compatible"
  )
    return { authToken: credential.access }
  if (
    specifier === "@opencode-ai/ai/providers/google-vertex" ||
    specifier.startsWith("@opencode-ai/ai/providers/google-vertex/")
  )
    return { accessToken: credential.access }
  return { apiKey: credential.access }
}

const withoutNativeAuthSettings = (settings: Record<string, unknown>) => {
  const { accessToken: _accessToken, apiKey: _apiKey, authToken: _authToken, ...rest } = settings
  return rest
}

const unsupported = (model: Info) =>
  new UnsupportedPackageError({
    providerID: model.providerID,
    modelID: model.id,
    package: model.package ?? "unknown",
  })

export const resolveModel = (
  model: Info,
  variant: VariantID | undefined,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) => withVariant(model, variant).pipe(Effect.flatMap((model) => fromCatalogModel(model, credential, dependencies)))

export const supported = (model: Info) => Boolean(model.package)

/** Resolves catalog selections into runtime models for the current Location. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service
    const npm = yield* Npm.Service
    const aisdk = yield* AISDK.Service
    const load = Effect.fn("ModelResolver.resolveModel")(function* (selected: Info, variant?: VariantID) {
      const provider = yield* catalog.provider.get(selected.providerID)
      const connection = yield* integrations.connection.active(
        provider?.integrationID ?? Integration.ID.make(selected.providerID),
      )
      const model = yield* resolveModel(
        selected,
        variant,
        connection ? yield* integrations.connection.resolve(connection) : undefined,
        {
          loadPackage: (specifier) => Provider.loadPackage(specifier, npm),
          loadAISDK: (model) => aisdk.model(model),
        },
      )
      return {
        model,
        ref: Ref.make({
          id: selected.id,
          providerID: selected.providerID,
          ...(variant === undefined ? {} : { variant }),
        }),
        capabilities: selected.capabilities,
        cost: selected.cost,
      }
    })
    return Service.of({
      resolve: Effect.fn("ModelResolver.resolve")(function* (requested) {
        const selected = requested
          ? yield* catalog.model.get(requested.providerID, requested.id)
          : yield* catalog.model
              .default()
              .pipe(
                Effect.flatMap((model) =>
                  model && supported(model)
                    ? Effect.succeed(model)
                    : Effect.map(catalog.model.available(), (models) => models.find(supported)),
                ),
              )
        if (!selected) return undefined
        return yield* load(selected, requested?.variant)
      }),
      resolveModel: load,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Catalog.node, Integration.node, Npm.node, AISDK.node],
})
