export * as ModelResolver from "./model-resolver"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Model } from "@opencode-ai/ai"
// ast-grep-ignore: no-star-import
import * as AnthropicMessages from "@opencode-ai/ai/protocols/anthropic-messages"
// ast-grep-ignore: no-star-import
import * as OpenAICompatibleChat from "@opencode-ai/ai/protocols/openai-compatible-chat"
// ast-grep-ignore: no-star-import
import * as OpenAIResponses from "@opencode-ai/ai/protocols/openai-responses"
import { Auth, type AnyRoute } from "@opencode-ai/ai/route"
import { Context, Effect, Layer, Schema } from "effect"
import { produce } from "immer"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { Credential } from "./credential"
import { Integration } from "./integration"
import { Capabilities, ID, Info, Ref, VariantID } from "./model"
import { Npm } from "@opencode-ai/util/npm"
import { OpenAICodex } from "./plugin/provider/openai-codex"
import { Provider } from "./provider"

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

export type Error = VariantUnavailableError | UnsupportedPackageError | Integration.AuthorizationError

export interface Resolved {
  /** Route-level model for provider requests; its id is the provider API model id, which may differ from the catalog id. */
  readonly model: Model
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
    limits: { context: model.limit.context, output: model.limit.output },
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

const providerOptions = (
  model: Info,
): { readonly [key: string]: { readonly [key: string]: unknown } } | undefined => {
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
  readonly loadAISDK?: (model: Info) => Effect.Effect<Model, AISDK.InitError>
}

export const fromCatalogModel = (
  model: Info,
  credential?: Credential.Value,
  dependencies?: Dependencies,
): Effect.Effect<Model, UnsupportedPackageError> => {
  const resolved = produce(model, (draft) => {
    if (draft.settings?.apiKey === "") delete draft.settings.apiKey
    if (credential?.type === "key" && credential.metadata !== undefined)
      draft.body = Provider.mergeOverlay(draft.body, credential.metadata)
  })
  const packageName = Provider.packageName(resolved.package)
  const key = apiKey(resolved, credential)

  if (OpenAICodex.isChatGPT(credential) && !Provider.isAISDK(resolved.package) && isNativeOpenAI(resolved.package)) {
    return Effect.succeed(codexModel(resolved, credential, key))
  }

  if (Provider.isAISDK(resolved.package) && packageName === "@ai-sdk/openai") {
    if (OpenAICodex.isChatGPT(credential)) return Effect.succeed(codexModel(resolved, credential, key))
    return Effect.succeed(
      withDefaults(resolved, OpenAIResponses.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: resolved.modelID ?? resolved.id, compatibility: resolved.compatibility }),
    )
  }
  if (Provider.isAISDK(resolved.package) && packageName === "@ai-sdk/anthropic") {
    return Effect.succeed(
      withDefaults(resolved, AnthropicMessages.route)
        .with({ auth: key === undefined ? Auth.none : Auth.header("x-api-key", key) })
        .model({ id: resolved.modelID ?? resolved.id, compatibility: resolved.compatibility }),
    )
  }
  if (
    Provider.isAISDK(resolved.package) &&
    packageName === "@ai-sdk/openai-compatible" &&
    typeof resolved.settings?.baseURL === "string"
  ) {
    return Effect.succeed(
      withDefaults(resolved, OpenAICompatibleChat.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: resolved.modelID ?? resolved.id, compatibility: resolved.compatibility }),
    )
  }
  const native = Provider.isAISDK(resolved.package) ? nativePackage(packageName) : resolved.package
  if (Provider.isAISDK(resolved.package) && !native) {
    if (!dependencies?.loadAISDK) return Effect.fail(unsupported(resolved))
    const runtime = produce(resolved, (draft) => {
      draft.settings = Provider.mergeOverlay(draft.settings, {
        ...(credential?.type === "key" ? { apiKey: credential.key } : {}),
        ...(credential?.type === "oauth" ? { apiKey: credential.access } : {}),
        ...credential?.metadata,
      })
    })
    return dependencies.loadAISDK(runtime).pipe(Effect.mapError(() => unsupported(resolved)))
  }
  if (!native) return Effect.fail(unsupported(resolved))

  const specifier = native
  return Effect.gen(function* () {
    const module = yield* (dependencies?.loadPackage ?? Provider.loadPackage)(specifier).pipe(
      Effect.mapError(() => unsupported(resolved)),
    )
    const configured = { ...resolved.settings, ...credential?.metadata }
    const providerOptions = nativeProviderOptions(packageName, configured)
    const settings = {
      ...(credential ? withoutNativeAuthSettings(configured) : configured),
      ...nativeCredentialSettings(specifier, credential),
      headers: resolved.headers,
      body: resolved.body,
      limits: { context: resolved.limit.context, output: resolved.limit.output },
      ...(providerOptions ? { providerOptions } : {}),
    }
    return yield* Effect.try({
      try: () => {
        const runtime = module.model(resolved.modelID ?? resolved.id, settings)
        return Model.update(runtime, {
          provider: resolved.providerID,
          compatibility: resolved.compatibility
            ? Object.assign({}, runtime.compatibility, resolved.compatibility)
            : runtime.compatibility,
        })
      },
      catch: () => unsupported(resolved),
    })
  })
}

const nativePackage = (packageName: string | undefined) => {
  if (packageName === "@ai-sdk/google") return "@opencode-ai/ai/providers/google"
  if (packageName === "@openrouter/ai-sdk-provider") return "@opencode-ai/ai/providers/openrouter"
  if (packageName === "@ai-sdk/xai") return "@opencode-ai/ai/providers/xai"
  return undefined
}

const nativeProviderOptions = (packageName: string | undefined, settings: Readonly<Record<string, unknown>>) => {
  const values = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !["apiKey", "authToken", "baseURL", "chunkTimeout", "fetch", "timeout"].includes(key),
    ),
  )
  if (Object.keys(values).length === 0) return undefined
  if (packageName === "@ai-sdk/google") return { gemini: values }
  if (packageName === "@openrouter/ai-sdk-provider") return { openrouter: values }
  if (packageName === "@ai-sdk/xai") return { xai: values }
  return undefined
}

const isNativeOpenAI = (packageName: string | undefined) =>
  packageName === "@opencode-ai/ai/providers/openai" ||
  packageName?.startsWith("@opencode-ai/ai/providers/openai/") === true

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

const codexModel = (
  model: Info,
  credential: Credential.Value | undefined,
  key: ReturnType<typeof Auth.value> | undefined,
) => {
  const account = OpenAICodex.accountID(credential)
  return withDefaults(model, OpenAIResponses.route)
    .with({
      endpoint: { baseURL: OpenAICodex.baseURL },
      auth: (key === undefined ? Auth.none : Auth.bearer(key)).andThen(
        account === undefined ? Auth.none : Auth.headers({ "chatgpt-account-id": account }),
      ),
    })
    .model({ id: model.modelID ?? model.id, compatibility: model.compatibility })
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
    const load = Effect.fn("ModelResolver.resolveModel")(function* (
      selected: Info,
      variant?: VariantID,
    ) {
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
