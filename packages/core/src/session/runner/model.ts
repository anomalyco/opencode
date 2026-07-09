export * as SessionRunnerModel from "./model"

import { makeLocationNode } from "../../effect/app-node"
import { Model } from "@opencode-ai/llm"
// ast-grep-ignore: no-star-import
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
// ast-grep-ignore: no-star-import
import * as OpenAICompatibleChat from "@opencode-ai/llm/protocols/openai-compatible-chat"
// ast-grep-ignore: no-star-import
import * as OpenAIResponses from "@opencode-ai/llm/protocols/openai-responses"
import { Auth, type AnyRoute } from "@opencode-ai/llm/route"
import { Context, Effect, Layer, Schema } from "effect"
import { produce } from "immer"
import { AISDK } from "../../aisdk"
import { Catalog } from "../../catalog"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { Npm } from "../../npm"
import { OpenAICodex } from "../../plugin/provider/openai-codex"
import { ProviderV2 } from "../../provider"
import { SessionSchema } from "../schema"

export class ModelNotSelectedError extends Schema.TaggedErrorClass<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  {
    sessionID: SessionSchema.ID,
  },
) {
  override get message() {
    return `No model is available for session ${this.sessionID}`
  }
}

export class ModelUnavailableError extends Schema.TaggedErrorClass<ModelUnavailableError>()(
  "SessionRunnerModel.ModelUnavailableError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
  },
) {
  override get message() {
    return `Model unavailable: ${this.providerID}/${this.modelID}`
  }
}

export class VariantUnavailableError extends Schema.TaggedErrorClass<VariantUnavailableError>()(
  "SessionRunnerModel.VariantUnavailableError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    variant: ModelV2.VariantID,
  },
) {
  override get message() {
    return `Variant unavailable for ${this.providerID}/${this.modelID}: ${this.variant}`
  }
}

export class UnsupportedPackageError extends Schema.TaggedErrorClass<UnsupportedPackageError>()(
  "SessionRunnerModel.UnsupportedPackageError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    package: Schema.String,
  },
) {
  override get message() {
    return `Unsupported package for ${this.providerID}/${this.modelID}: ${this.package}`
  }
}

export type Error =
  | ModelNotSelectedError
  | ModelUnavailableError
  | VariantUnavailableError
  | UnsupportedPackageError
  | Integration.AuthorizationError

export interface Resolved {
  /** Route-level model for provider requests; its id is the provider API model id, which may differ from the catalog id. */
  readonly model: Model
  /** Selected catalog identity. Durable records and displays must use this, never the API model id. */
  readonly ref: ModelV2.Ref
  /** Catalog pricing in dollars per million tokens. */
  readonly cost: ModelV2.Info["cost"]
}

export interface Interface {
  readonly resolve: (session: SessionSchema.Info) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunnerModel") {}

/** Test or embedding seam for supplying a model resolver directly. */
export const layerWith = (resolve: Interface["resolve"]) => Layer.succeed(Service, Service.of({ resolve }))

/** Builds a Resolved whose catalog identity mirrors the route model. Test or embedding seam. */
export const resolved = (model: Model, variant?: ModelV2.VariantID, cost: ModelV2.Info["cost"] = []): Resolved => ({
  model,
  ref: ModelV2.Ref.make({
    id: ModelV2.ID.make(model.id),
    providerID: ProviderV2.ID.make(model.provider),
    ...(variant === undefined ? {} : { variant }),
  }),
  cost,
})

const apiKey = (model: ModelV2.Info, credential?: Credential.Value) => {
  if (credential?.type === "key") return Auth.value(credential.key)
  if (credential?.type === "oauth") return Auth.value(credential.access)
  const value = model.settings?.apiKey
  if (typeof value === "string") return Auth.value(value)
}

const withDefaults = (model: ModelV2.Info, route: AnyRoute) =>
  route.with({
    provider: model.providerID,
    endpoint: typeof model.settings?.baseURL === "string" ? { baseURL: model.settings.baseURL } : undefined,
    headers: providerHeaders(model),
    providerOptions: providerOptions(model),
    http: model.body === undefined ? undefined : { body: model.body },
    limits: { context: model.limit.context, output: model.limit.output },
  })

const providerHeaders = (model: ModelV2.Info) => {
  const packageName = ProviderV2.packageName(model.package)
  const generated = new Map<string, string>()
  if (packageName === "@ai-sdk/openai" && typeof model.settings?.organization === "string")
    generated.set("OpenAI-Organization", model.settings.organization)
  if (packageName === "@ai-sdk/openai" && typeof model.settings?.project === "string")
    generated.set("OpenAI-Project", model.settings.project)
  if (packageName === "@ai-sdk/anthropic" && typeof model.settings?.authToken === "string")
    generated.set("Authorization", `Bearer ${model.settings.authToken}`)
  return ProviderV2.mergeHeaders(generated.size === 0 ? undefined : Object.fromEntries(generated), model.headers)
}

const providerOptions = (
  model: ModelV2.Info,
): { readonly [key: string]: { readonly [key: string]: unknown } } | undefined => {
  if (!ProviderV2.isAISDK(model.package) || model.settings === undefined) return undefined
  const { apiKey: _, baseURL: _baseURL, ...settings } = model.settings
  if (Object.keys(settings).length === 0) return undefined
  const packageName = ProviderV2.packageName(model.package)
  if (packageName === "@ai-sdk/openai") return { openai: settings }
  if (packageName === "@ai-sdk/anthropic") return { anthropic: settings }
  if (packageName === "@ai-sdk/openai-compatible") return { openai: settings }
}

export const withVariant = (
  model: ModelV2.Info,
  variantID: ModelV2.VariantID | undefined,
): Effect.Effect<ModelV2.Info, VariantUnavailableError> => {
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
          draft.settings = ProviderV2.mergeOverlay(draft.settings, variant.settings)
          draft.headers = ProviderV2.mergeHeaders(draft.headers, variant.headers)
          draft.body = ProviderV2.mergeOverlay(draft.body, variant.body)
        })
      : model,
  )
}

export interface Dependencies {
  readonly loadPackage?: (specifier: string) => Effect.Effect<ProviderV2.ProviderPackage, ProviderV2.LoadError>
  readonly loadAISDK?: (model: ModelV2.Info) => Effect.Effect<Model, AISDK.InitError>
}

export const fromCatalogModel = (
  model: ModelV2.Info,
  credential?: Credential.Value,
  dependencies: Dependencies = {},
): Effect.Effect<Model, UnsupportedPackageError> => {
  const resolved =
    credential?.type !== "key" || credential.metadata === undefined
      ? model
      : produce(model, (draft) => {
          draft.body = ProviderV2.mergeOverlay(draft.body, credential.metadata)
        })
  const packageName = ProviderV2.packageName(resolved.package)
  const key = apiKey(resolved, credential)

  if (
    OpenAICodex.isChatGPT(credential) &&
    !ProviderV2.isAISDK(resolved.package) &&
    isNativeOpenAI(resolved.package)
  ) {
    return Effect.succeed(codexModel(resolved, credential, key))
  }

  if (ProviderV2.isAISDK(resolved.package) && packageName === "@ai-sdk/openai") {
    if (OpenAICodex.isChatGPT(credential)) return Effect.succeed(codexModel(resolved, credential, key))
    return Effect.succeed(
      withDefaults(resolved, OpenAIResponses.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: resolved.modelID ?? resolved.id }),
    )
  }
  if (ProviderV2.isAISDK(resolved.package) && packageName === "@ai-sdk/anthropic") {
    return Effect.succeed(
      withDefaults(resolved, AnthropicMessages.route)
        .with({ auth: key === undefined ? Auth.none : Auth.header("x-api-key", key) })
        .model({ id: resolved.modelID ?? resolved.id }),
    )
  }
  if (
    ProviderV2.isAISDK(resolved.package) &&
    packageName === "@ai-sdk/openai-compatible" &&
    typeof resolved.settings?.baseURL === "string"
  ) {
    return Effect.succeed(
      withDefaults(resolved, OpenAICompatibleChat.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: resolved.modelID ?? resolved.id }),
    )
  }
  if (ProviderV2.isAISDK(resolved.package)) {
    if (!dependencies.loadAISDK) return Effect.fail(unsupported(resolved))
    const runtime = produce(resolved, (draft) => {
      draft.settings = ProviderV2.mergeOverlay(draft.settings, {
        ...(credential?.type === "key" ? { apiKey: credential.key } : {}),
        ...(credential?.type === "oauth" ? { apiKey: credential.access } : {}),
        ...credential?.metadata,
      })
    })
    return dependencies.loadAISDK(runtime).pipe(Effect.mapError(() => unsupported(resolved)))
  }
  if (!resolved.package) return Effect.fail(unsupported(resolved))

  const specifier = resolved.package
  return Effect.gen(function* () {
    const module = yield* (dependencies.loadPackage ?? ProviderV2.loadPackage)(specifier).pipe(
      Effect.mapError(() => unsupported(resolved)),
    )
    const settings = {
      ...resolved.settings,
      ...(credential?.type === "key" ? { apiKey: credential.key } : {}),
      ...(credential?.type === "oauth" ? { apiKey: credential.access } : {}),
      ...credential?.metadata,
      headers: resolved.headers,
      body: resolved.body,
      limits: { context: resolved.limit.context, output: resolved.limit.output },
    }
    return yield* Effect.try({
      try: () =>
        Model.update(module.model(resolved.modelID ?? resolved.id, settings), { provider: resolved.providerID }),
      catch: () => unsupported(resolved),
    })
  })
}

const isNativeOpenAI = (packageName: string | undefined) =>
  packageName === "@opencode-ai/llm/providers/openai" ||
  packageName?.startsWith("@opencode-ai/llm/providers/openai/") === true

const codexModel = (
  model: ModelV2.Info,
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
    .model({ id: model.modelID ?? model.id })
}

const unsupported = (model: ModelV2.Info) =>
  new UnsupportedPackageError({
    providerID: model.providerID,
    modelID: model.id,
    package: model.package ?? "unknown",
  })

export const resolve = (
  session: SessionSchema.Info,
  model: ModelV2.Info,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) =>
  withVariant(model, session.model?.variant).pipe(
    Effect.flatMap((model) => fromCatalogModel(model, credential, dependencies)),
  )

export const supported = (model: ModelV2.Info) => Boolean(model.package)

/** Resolves models from the catalog belonging to the current Location runtime. */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service
    const npm = yield* Npm.Service
    const aisdk = yield* AISDK.Service
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session) {
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        const defaultModel = session.model ? undefined : yield* catalog.model.default()
        const selected = session.model
          ? (yield* catalog.model.available()).find(
              (model) => model.providerID === session.model?.providerID && model.id === session.model.id,
            )
          : defaultModel && supported(defaultModel)
            ? defaultModel
            : (yield* catalog.model.available()).find(supported)
        if (!selected && session.model)
          return yield* new ModelUnavailableError({
            providerID: session.model.providerID,
            modelID: session.model.id,
          })
        if (!selected) return yield* new ModelNotSelectedError({ sessionID: session.id })
        const provider = yield* catalog.provider.get(selected.providerID)
        const connection = yield* integrations.connection.active(
          provider?.integrationID ?? Integration.ID.make(selected.providerID),
        )
        const model = yield* resolve(
          session,
          selected,
          connection ? yield* integrations.connection.resolve(connection) : undefined,
          {
            loadPackage: (specifier) => ProviderV2.loadPackage(specifier, npm),
            loadAISDK: (model) => aisdk.model(model),
          },
        )
        return {
          model,
          ref: ModelV2.Ref.make({
            id: selected.id,
            providerID: selected.providerID,
            ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
          }),
          cost: selected.cost,
        }
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Catalog.node, Integration.node, Npm.node, AISDK.node],
})
