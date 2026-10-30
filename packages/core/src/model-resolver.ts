export * as ModelResolver from "./model-resolver.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import {
  DecisionModel,
  DecisionModelCompatibility,
  DecisionModelSchema,
  HttpOptions,
  ImageModel,
  ImageModelSchema,
  LanguageModel,
  ProviderConfigurationError,
} from "@opencode/ai/effect"
import { Auth, mergeHttpOptions } from "@opencode/ai/route"
import { Context, Effect, Layer, Schema, Struct } from "effect"
import { AISDK } from "./aisdk.js"
import { Credential } from "./credential.js"
import { Integration } from "./integration.js"
import { Capabilities, ID, Info, Model, Ref, VariantID } from "./model.js"
import type { RuntimeInfo } from "./model.js"
import { Npm } from "@opencode/util/npm"
import { Provider } from "./provider.js"

export class VariantUnavailableError extends Schema.TaggedError<VariantUnavailableError>()(
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

export class UnsupportedPackageError extends Schema.TaggedError<UnsupportedPackageError>()(
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

export const InitializationPhase = Schema.Literals(["load", "init", "construct"])
export type InitializationPhase = typeof InitializationPhase.Type

/** Provider settings are missing, conflicting, or unsupported; the provider's own message tells the user what to fix. */
export class ModelConfigurationError extends Schema.TaggedError<ModelConfigurationError>()(
  "SessionRunnerModel.ModelConfigurationError",
  {
    providerID: Provider.ID,
    modelID: ID,
    package: Schema.String,
    detail: Schema.String,
  },
) {
  override get message() {
    return `Cannot initialize ${this.providerID}/${this.modelID}: ${this.detail}`
  }
}

/** A supported package failed unexpectedly while loading or constructing the model. */
export class ModelInitializationError extends Schema.TaggedError<ModelInitializationError>()(
  "SessionRunnerModel.ModelInitializationError",
  {
    providerID: Provider.ID,
    modelID: ID,
    package: Schema.String,
    phase: InitializationPhase,
    detail: Schema.String,
  },
) {
  override get message() {
    return `Cannot initialize ${this.providerID}/${this.modelID}: ${this.detail}`
  }
}

export class UnresolvedProviderVariablesError extends Schema.TaggedError<UnresolvedProviderVariablesError>()(
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

export class UnsupportedCompactionError extends Schema.TaggedError<UnsupportedCompactionError>()(
  "SessionRunnerModel.UnsupportedCompactionError",
  {
    providerID: Provider.ID,
    modelID: ID,
    route: Schema.String,
  },
) {
  override get message() {
    return `Provider compaction is not supported by ${this.providerID}/${this.modelID} (${this.route})`
  }
}

export type Error =
  | VariantUnavailableError
  | UnsupportedPackageError
  | ModelConfigurationError
  | ModelInitializationError
  | UnresolvedProviderVariablesError
  | UnsupportedCompactionError
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
  /** Catalog token limits used by Core for context management. */
  readonly limit: Info["limit"]
  /** Model policy overrides the provider policy; omitted means summary compaction. */
  readonly compaction?: Provider.Compaction
  /** Prompt-cache settings from the provider, model and variant; omitted keeps the provider defaults. */
  readonly cache?: Provider.Cache
  /** Provider transport policy; omitted means HTTP. */
  readonly transport?: Provider.Transport
  /** Milliseconds without streamed data before a WebSocket exchange fails; `false` disables the limit. */
  readonly chunkTimeout?: number | false
}

export type MediaError =
  | VariantUnavailableError
  | UnsupportedPackageError
  | ModelConfigurationError
  | ModelInitializationError
  | UnresolvedProviderVariablesError
  | Integration.AuthorizationError

export interface Interface {
  readonly resolve: (requested?: Ref) => Effect.Effect<Resolved | undefined, Error>
  readonly resolveModel: (model: Info, variant?: VariantID) => Effect.Effect<Resolved, Error>
  /** An enabled image model by ref, or undefined when no image model has that ref. */
  readonly resolveImage: (ref: Ref) => Effect.Effect<ImageModel | undefined, MediaError>
  /** An enabled decision model by ref, or undefined when no decision model has that ref. */
  readonly resolveDecision: (ref: Ref) => Effect.Effect<DecisionModel | undefined, MediaError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelResolver") {}

// Variant resolution adds request-local overlays without changing the committed model snapshot.
export const withVariant = (
  model: Info,
  variantID: VariantID | undefined,
): Effect.Effect<Info, VariantUnavailableError> => {
  const id = variantID === "default" ? undefined : variantID
  const variant = model.variants?.find((item) => item.id === id)
  if (!variant && id !== undefined)
    return Effect.fail(
      new VariantUnavailableError({
        providerID: model.providerID,
        modelID: model.id,
        variant: id,
      }),
    )
  return Effect.succeed(
    variant
      ? {
          ...model,
          // Config accepts unknown variant keys, so drop `cache` here too; a variant can't change the prompt cache.
          settings: Provider.mergeOverlay(
            model.settings,
            Provider.modelSettings(variant.settings && Struct.omit(variant.settings, ["cache"])),
          ),
          headers: Provider.mergeHeaders(model.headers, variant.headers),
          body: Provider.mergeOverlay(model.body, variant.body),
        }
      : model,
  )
}

export interface Dependencies {
  readonly loadPackage?: (specifier: string) => Effect.Effect<Provider.ProviderPackage, Provider.LoadError>
  readonly loadAISDK?: (model: RuntimeInfo) => Effect.Effect<LanguageModel, AISDK.InitError>
}

export const fromCatalogModel = (
  model: RuntimeInfo,
  credential?: Credential.Value,
  dependencies?: Dependencies,
): Effect.Effect<
  LanguageModel,
  | UnsupportedPackageError
  | ModelConfigurationError
  | ModelInitializationError
  | UnresolvedProviderVariablesError
  | UnsupportedCompactionError
> =>
  resolveCatalogModel(model, credential, dependencies).pipe(
    Effect.flatMap((resolved) => validateProviderVariables(model, resolved)),
    Effect.flatMap((resolved) => {
      // Reject provider compaction policies up front so the misconfiguration surfaces before any step runs.
      if (
        model.settings?.compaction?.type !== "native" ||
        resolved.route.compact?.trigger ||
        resolved.route.compact?.endpoint
      )
        return Effect.succeed(resolved)
      return Effect.fail(
        new UnsupportedCompactionError({ providerID: model.providerID, modelID: model.id, route: resolved.route.id }),
      )
    }),
  )

const resolveCatalogModel = Effect.fn("ModelResolver.resolveCatalogModel")(function* (
  model: RuntimeInfo,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) {
  if (Provider.isAISDK(model.package)) {
    const resolved = prepareRuntimeModel(model)
    const loadAISDK = dependencies?.loadAISDK
    if (!loadAISDK) return yield* unsupported(resolved)
    const settings = yield* prepareProviderSettings(
      resolved,
      Provider.mergeOverlay(
        resolved.settings,
        nativeCredentialSettings(resolved, resolved.package ?? "", credential),
      ) ?? {},
    )
    return yield* loadAISDK({ ...resolved, settings }).pipe(
      Effect.mapError((error) => initialization(resolved, "init", error.cause)),
    )
  }
  const { resolved, configured, module, settings } = yield* loadCatalogPackage(model, credential, dependencies)
  return yield* Effect.try({
    try: () => {
      const runtime = module.model(resolved.modelID ?? resolved.id, settings)
      return LanguageModel.update(runtime, {
        provider: resolved.canonical ?? resolved.providerID,
        compatibility: resolved.compatibility
          ? Object.assign({}, runtime.compatibility, resolved.compatibility)
          : runtime.compatibility,
        // Timeouts and body encoding are transport policy, so they land on the route's HTTP defaults instead of package settings.
        defaults: {
          ...runtime.defaults,
          http: mergeHttpOptions(
            runtime.defaults?.http,
            new HttpOptions({ ...Provider.timeouts(configured), encoding: Provider.encoding(configured) }),
          ),
        },
      })
    },
    catch: (cause) => constructionError(resolved, cause),
  })
})

/** Settings and package loading shared by every model type: credentials, variables, canonical provider, overlays. */
const loadCatalogPackage = Effect.fn("ModelResolver.loadCatalogPackage")(function* (
  model: RuntimeInfo,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) {
  const resolved = prepareRuntimeModel(model)
  const configured = resolved.settings ?? {}
  const specifier = Provider.packageName(resolved.package)
  if (!specifier || Provider.isAISDK(specifier)) return yield* unsupported(resolved)
  const mapped = yield* prepareProviderSettings(resolved, Provider.nativeSettings(configured))
  const module = yield* (dependencies?.loadPackage ?? Provider.loadPackage)(specifier).pipe(
    Effect.mapError((error) => initialization(resolved, "load", error.cause)),
  )
  const settings = {
    ...(credential ? Struct.omit(mapped, ["accessToken", "apiKey", "authToken"]) : mapped),
    ...(resolved.canonical === undefined ? {} : { provider: resolved.canonical }),
    ...nativeCredentialSettings(resolved, specifier, credential),
    headers: resolved.headers,
    body: resolved.body,
  }
  return { resolved, configured, module, settings }
})

/**
 * Builds an image or decision model from its catalog package. The entrypoint (`providers/<P>/images`) exports the
 * same `model(modelID, settings)` as chat; a package that returns another kind of model cannot serve this type.
 */
const fromCatalogMedia = Effect.fn("ModelResolver.fromCatalogMedia")(function* <Runtime>(
  model: RuntimeInfo,
  is: (value: unknown) => value is Runtime,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) {
  const { resolved, module, settings } = yield* loadCatalogPackage(model, credential, dependencies)
  const runtime: unknown = yield* Effect.try({
    try: () => module.model(resolved.modelID ?? resolved.id, settings),
    catch: (cause) => constructionError(resolved, cause),
  })
  // Catalog and config compatibility tell a decision route how its host takes media, as chat does above.
  const mediaInput = resolved.compatibility?.mediaInput
  const adapted =
    runtime instanceof DecisionModel && mediaInput !== undefined
      ? new DecisionModel({
          ...runtime,
          compatibility: DecisionModelCompatibility.make({ ...runtime.compatibility, mediaInput }),
        })
      : runtime
  if (!is(adapted)) return yield* unsupported(resolved)
  return adapted
})

const constructionError = (model: RuntimeInfo, cause: unknown) =>
  cause instanceof ProviderConfigurationError
    ? new ModelConfigurationError({
        providerID: model.providerID,
        modelID: model.id,
        package: model.package ?? "unknown",
        detail: cause.message,
      })
    : initialization(model, "construct", cause)

const isImageModel = Schema.is(ImageModelSchema)
const isDecisionModel = Schema.is(DecisionModelSchema)

function prepareRuntimeModel(model: RuntimeInfo) {
  if (model.settings?.apiKey !== "") return model
  return { ...model, settings: Struct.omit(model.settings, ["apiKey"]) }
}

function validateProviderVariables(
  model: RuntimeInfo,
  resolved: LanguageModel,
): Effect.Effect<LanguageModel, UnresolvedProviderVariablesError> {
  const baseURL = resolved.route.endpoint.baseURL
  if (typeof baseURL !== "string") return Effect.succeed(resolved)
  const failure = unresolvedProviderVariables(model, baseURL)
  return failure ? Effect.fail(failure) : Effect.succeed(resolved)
}

function prepareProviderSettings(
  model: RuntimeInfo,
  settings: Readonly<Record<string, unknown>>,
): Effect.Effect<Readonly<Record<string, unknown>>, UnresolvedProviderVariablesError> {
  const baseURL = settings.baseURL
  if (typeof baseURL !== "string") return Effect.succeed(settings)
  return prepareProviderURL(model, baseURL, settings).pipe(
    Effect.map((prepared) => (prepared === baseURL ? settings : { ...settings, baseURL: prepared })),
  )
}

function prepareProviderURL(
  model: RuntimeInfo,
  baseURL: string,
  settings: Readonly<Record<string, unknown>>,
): Effect.Effect<string, UnresolvedProviderVariablesError> {
  if (!baseURL.includes("${")) return Effect.succeed(baseURL)
  // Catalog Bedrock URLs are model settings while `region` is a provider setting, so they only meet here.
  const prepared = baseURL.replace(
    /\$\{([^}]+)\}/g,
    (placeholder, name: string) =>
      (name === "AWS_REGION" && typeof settings.region === "string" ? settings.region : process.env[name]) ?? placeholder,
  )
  const failure = unresolvedProviderVariables(model, prepared)
  return failure ? Effect.fail(failure) : Effect.succeed(prepared)
}

function unresolvedProviderVariables(model: RuntimeInfo, baseURL: string) {
  const variables = new Set(Array.from(baseURL.matchAll(/\$\{([^}]+)\}/g), (match) => match[1]))
  if (variables.size === 0) return
  return new UnresolvedProviderVariablesError({
    providerID: model.providerID,
    modelID: model.id,
    variables: Array.from(variables),
  })
}

const nativeCredentialSettings = (model: RuntimeInfo, specifier: string, credential: Credential.Value | undefined) => {
  if (!credential) return {}
  if (credential.type === "key") return { apiKey: credential.key }
  if (credential.type === "oauth") return tokenSettings(specifier, credential.access)
  // The Bedrock plugin projects the saved profile into settings; SigV4 keeps an ambient bearer token from taking over.
  if (specifier.startsWith("@opencode/ai/providers/amazon-bedrock")) return { auth: "sigv4" }
  // The Azure plugin's request hooks replace this with an Entra ID token from the Azure CLI; it only gets the
  // request past the package's own credential check.
  if (model.providerID === Provider.ID.azure) return tokenSettings(specifier, "azure-cli")
  return {}
}

const tokenSettings = (specifier: string, token: string) => {
  if (specifier === "@opencode/ai/providers/anthropic" || specifier === "@opencode/ai/providers/anthropic-compatible")
    return { authToken: token }
  if (
    specifier === "@opencode/ai/providers/google-vertex" ||
    specifier.startsWith("@opencode/ai/providers/google-vertex/")
  )
    return { accessToken: token }
  return { apiKey: token }
}

const unsupported = (model: RuntimeInfo) =>
  new UnsupportedPackageError({
    providerID: model.providerID,
    modelID: model.id,
    package: model.package ?? "unknown",
  })

const initialization = (model: RuntimeInfo, phase: InitializationPhase, cause: unknown) =>
  new ModelInitializationError({
    providerID: model.providerID,
    modelID: model.id,
    package: model.package ?? "unknown",
    phase,
    detail: causeMessage(cause) ?? `${phase} failed for ${model.package ?? "unknown"}`,
  })

// Unexpected throws still carry the most useful diagnosis in their message; a stack or an unknown value does not.
const causeMessage = (cause: unknown): string | undefined => {
  if (typeof cause === "string") return cause.trim() || undefined
  if (!(cause instanceof globalThis.Error)) return undefined
  const message = cause.message.trim()
  if (message) return message
  return causeMessage(cause.cause)
}

export const resolveModel = (
  model: Info,
  variant: VariantID | undefined,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) => withVariant(model, variant).pipe(Effect.flatMap((model) => fromCatalogModel(model, credential, dependencies)))

export const hasPackage = (model: Info) => Boolean(model.package)

/** Resolves catalog selections into runtime models for the current Location. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const models = yield* Model.Service
    const integrations = yield* Integration.Service
    const npm = yield* Npm.Service
    const aisdk = yield* AISDK.Service
    const dependencies: Dependencies = {
      loadPackage: (specifier) => Provider.loadPackage(specifier, npm),
      loadAISDK: (model) => aisdk.model(model),
    }
    const prepare = Effect.fn("ModelResolver.prepare")(function* (selected: Info, variant?: VariantID) {
      const provider = yield* providers.get(selected.providerID)
      const connection = yield* integrations.connection.active(
        provider?.integrationID ?? Integration.ID.make(selected.providerID),
      )
      const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
      const selectedVariant = yield* withVariant(selected, variant)
      const runtimeInfo: RuntimeInfo = {
        ...selectedVariant,
        settings: Provider.mergeOverlay(provider?.settings, Provider.modelSettings(selectedVariant.settings)),
      }
      return { provider, credential, runtimeInfo }
    })
    const load = Effect.fn("ModelResolver.resolveModel")(function* (selected: Info, variant?: VariantID) {
      const { provider, credential, runtimeInfo } = yield* prepare(selected, variant)
      const model = yield* fromCatalogModel(runtimeInfo, credential, dependencies)
      const runtime =
        provider?.activation === "enabled" &&
        credential === undefined &&
        !hasConfiguredAuth(runtimeInfo) &&
        usesAPIKeyAuth(runtimeInfo.package)
          ? LanguageModel.update(model, { route: model.route.with({ auth: Auth.none }) })
          : model
      return {
        model: runtime,
        ref: Ref.make({
          id: selected.id,
          providerID: selected.providerID,
          ...(variant === undefined ? {} : { variant }),
        }),
        capabilities: selected.capabilities,
        cost: selected.cost,
        limit: selected.limit,
        compaction: runtimeInfo.settings?.compaction,
        cache: runtimeInfo.settings?.cache,
        transport: provider?.settings?.transport,
        chunkTimeout: Provider.timeout(provider?.settings?.chunkTimeout),
      }
    })
    const loadMedia = Effect.fnUntraced(function* <Runtime>(
      ref: Ref,
      type: Model.Type,
      is: (value: unknown) => value is Runtime,
    ) {
      const info = (yield* models.available([type])).find(
        (model) => model.providerID === ref.providerID && model.id === ref.id,
      )
      if (!info) return undefined
      const { credential, runtimeInfo } = yield* prepare(info, ref.variant)
      return yield* fromCatalogMedia(runtimeInfo, is, credential, dependencies)
    })
    return Service.of({
      resolve: Effect.fn("ModelResolver.resolve")(function* (requested) {
        const selected = requested
          ? yield* models.get(requested.providerID, requested.id)
          : yield* models
              .default()
              .pipe(
                Effect.flatMap((model) =>
                  model && hasPackage(model)
                    ? Effect.succeed(model)
                    : Effect.map(models.available(), (models) =>
                        models.find((model) => hasPackage(model) && Model.supportsText(model)),
                      ),
                ),
              )
        if (!selected) return undefined
        return yield* load(selected, requested?.variant)
      }),
      resolveModel: load,
      resolveImage: Effect.fn("ModelResolver.resolveImage")(function* (ref) {
        return yield* loadMedia(ref, "image", isImageModel)
      }),
      resolveDecision: Effect.fn("ModelResolver.resolveDecision")(function* (ref) {
        return yield* loadMedia(ref, "decision", isDecisionModel)
      }),
    })
  }),
)

function hasConfiguredAuth(model: RuntimeInfo) {
  return [model.settings?.apiKey, model.settings?.authToken, model.settings?.accessToken].some(
    (value) => typeof value === "string" && value !== "",
  )
}

function usesAPIKeyAuth(packageName: string | undefined) {
  const name = Provider.packageName(packageName)
  return (
    name === "@ai-sdk/openai" ||
    name === "@ai-sdk/anthropic" ||
    name === "@ai-sdk/cerebras" ||
    name === "@ai-sdk/deepinfra" ||
    name === "@ai-sdk/openai-compatible" ||
    name === "@ai-sdk/google" ||
    name === "@ai-sdk/groq" ||
    name === "@ai-sdk/mistral" ||
    name === "@ai-sdk/togetherai" ||
    name === "@ai-sdk/xai" ||
    name === "@openrouter/ai-sdk-provider" ||
    name === "@ai-sdk/azure" ||
    name === "@opencode/ai/providers/openai" ||
    name?.startsWith("@opencode/ai/providers/openai/") === true ||
    name === "@opencode/ai/providers/anthropic" ||
    name === "@opencode/ai/providers/anthropic-compatible" ||
    name === "@opencode/ai/providers/baseten" ||
    name === "@opencode/ai/providers/cerebras" ||
    name === "@opencode/ai/providers/cloudflare-ai-gateway" ||
    name === "@opencode/ai/providers/cloudflare-workers-ai" ||
    name === "@opencode/ai/providers/deepinfra" ||
    name === "@opencode/ai/providers/deepseek" ||
    name === "@opencode/ai/providers/fireworks" ||
    name === "@opencode/ai/providers/openai-compatible" ||
    name === "@opencode/ai/providers/google" ||
    name === "@opencode/ai/providers/google/interactions" ||
    name === "@opencode/ai/providers/groq" ||
    name === "@opencode/ai/providers/mistral" ||
    name === "@opencode/ai/providers/togetherai" ||
    name === "@opencode/ai/providers/vercel-ai-gateway" ||
    name === "@opencode/ai/providers/xai" ||
    name === "@opencode/ai/providers/openrouter" ||
    name === "@opencode/ai/providers/azure" ||
    name?.startsWith("@opencode/ai/providers/azure/") === true
  )
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Provider.node, Model.node, Integration.node, Npm.node, AISDK.node],
})
