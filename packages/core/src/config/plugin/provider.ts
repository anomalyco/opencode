export * as ConfigProviderPlugin from "./provider.js"

import type { ModelEditor } from "@opencode/plugin/effect/model"
import type { ProviderEditor } from "@opencode/plugin/effect/provider"
import { define } from "@opencode/plugin/effect/plugin"
import { Document, type Entry } from "@opencode/schema/config"
import { ConfigProvider } from "@opencode/schema/config/provider"
import { Money } from "@opencode/schema/money"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { Variant } from "../../variant.js"
import { ConfigIntegration } from "../integration.js"
import { ConfigManaged } from "../managed.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.provider",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(
      config,
      ctx.event,
      ctx.integration.reload().pipe(Effect.andThen(ctx.provider.reload())),
    )
    yield* ctx.integration.transform((integrations) => {
      for (const [id, provider] of configuredProviders(loaded.entries)) {
        const integrationID = id
        if (!integrations.get(integrationID)) {
          integrations.method.update({
            integrationID,
            method: { type: "key", label: "Manually enter API Key" },
          })
        }
        integrations.update(integrationID, (integration) => {
          integration.name = provider.name || integration.name
        })
        if (provider.env !== undefined) {
          integrations.method.update({
            integrationID,
            method: { type: "env", names: [...provider.env] },
          })
        }
      }
    })

    const sources = {
      defaultModel: undefined as Document["info"]["model"],
      models: new Map<
        ConfigProvider.Info,
        {
          readonly providerID: string
          readonly models: ReadonlyMap<string, { readonly inherit: boolean; readonly base?: Model.Info }>
        }
      >(),
    }
    yield* ctx.provider.transform((providers) => {
      const next: typeof sources.models = new Map()
      for (const [id, item] of configuredProviders(loaded.entries)) {
        const providerID = id
        const { current, source, changed } = overlayProvider(providers, providerID, item)
        const definitions = new Map<string, { readonly inherit: boolean; readonly base?: Model.Info }>()
        for (const [id, config] of Object.entries(item.models ?? {})) {
          const base = source?.models.get(config.modelID ?? id) ?? source?.models.get(id)
          const inherit = changed || !current?.models.has(id)
          // Bind the source at this point in the provider fold. Later source edits/removal
          // and its credential availability must not change an already-defined alias.
          definitions.set(id, { inherit, base: base && structuredClone(base) })
          if (!inherit) continue
          providers.models.update(providerID, id, (model) => {
            if (base) Object.assign(model, structuredClone(base))
            if (item.package !== undefined) model.package = undefined
          })
        }
        // A configured provider baseURL replaces every catalog per-model endpoint, not only those of configured
        // models. Configured per-model settings are applied later and still win.
        if (item.settings?.baseURL !== undefined)
          for (const [id, model] of providers.get(providerID)?.models ?? [])
            if (model.settings?.baseURL !== undefined)
              providers.models.update(providerID, id, (model) => {
                delete model.settings?.baseURL
              })
        next.set(item, { providerID, models: definitions })
      }
      for (const [item, definition] of next) {
        for (const [id, config] of Object.entries(item.models ?? {})) {
          if (config.limit === undefined) continue
          providers.models.update(definition.providerID, id, (model) => {
            model.limit = { ...model.limit, ...config.limit }
          })
        }
      }
      sources.defaultModel = Config.latest(loaded.entries, "model")
      sources.models = next
    })

    // Keep explicit model overrides in their late registration position, after external
    // model transforms. They can recreate or re-enable a model within an available provider.
    yield* ctx.model.transform((models) => {
      const configuredDefault = sources.defaultModel
      if (configuredDefault !== undefined) models.default.set(configuredDefault.providerID, configuredDefault.model)
      for (const [item, definition] of sources.models) {
        const providerID = definition.providerID
        for (const [id, config] of Object.entries(item.models ?? {})) {
          const source = definition.models.get(id)
          const inherit = source?.inherit || !models.get(providerID, id)
          overlay(
            models,
            models.provider.get(providerID)?.provider.package,
            item,
            providerID,
            id,
            config,
            inherit && source?.base ? { base: source.base } : undefined,
          )
          // Inherited variants are spelled for the base model's package, so a package override needs fresh ones.
          // A base without variants has no reasoning support to respell.
          const repackaged =
            source?.base !== undefined &&
            source.base.variants.length > 0 &&
            models.get(providerID, id)?.package !== source.base.package
          if (
            config.variants === undefined &&
            config.capabilities?.reasoning === undefined &&
            (!source?.base || repackaged)
          )
            models.update(providerID, id, (model) => {
              model.variants = [
                ...Variant.resolve({
                  ...model,
                  package: model.package ?? models.provider.get(providerID)?.provider.package,
                }),
              ]
            })
        }
      }
    })
  }),
})

// Integration documents are left out: their providers authenticate with the integration's connection, so they add no
// integration or method, and the integration's own plugin applies them earlier in the provider chain (`integrate`).
// A provider the Console supplies is shaped only by the Console and managed configuration: user, project, and remote
// documents cannot override any part of it, since it carries the org's token and a repository must not redirect it.
function configuredProviders(entries: readonly Entry[]) {
  const supplied = new Set(
    entries
      .filter((entry): entry is ConfigIntegration.Document => entry instanceof ConfigIntegration.Document)
      .flatMap((document) => Object.keys(document.info.providers ?? {})),
  )
  return entries
    .filter((entry): entry is Document => entry.type === "document" && !(entry instanceof ConfigIntegration.Document))
    .flatMap((file) =>
      Object.entries(file.info.providers ?? {}).filter(
        ([id]) => !supplied.has(id) || file instanceof ConfigManaged.Document,
      ),
    )
}

/**
 * Applies an integration document's providers. The integration's plugin calls this at its own position in the
 * provider chain, so provider plugins registered after it treat these providers as configured ones rather than
 * as their canonical provider, while user and project config still overlay them in this plugin's late transform.
 */
export function integrate(providers: ProviderEditor, document: ConfigIntegration.Document) {
  for (const [providerID, item] of Object.entries(document.info.providers ?? {})) {
    const { source } = overlayProvider(providers, providerID, item, document.integrationID)
    // An integration lists the models it routes: each starts again from the catalog and takes the provider's
    // package and URL. Its models are complete here, so later model transforms and config apply on top.
    for (const [id, config] of Object.entries(item.models ?? {})) {
      overlay(providers.models, providers.get(providerID)?.provider.package, item, providerID, id, config, {
        base: source?.models.get(config.modelID ?? id) ?? source?.models.get(id),
      })
    }
    const configured = providers.get(providerID)
    // Bound to the connection so its providers disappear as soon as the account changes or signs out.
    if (configured)
      providers.add({
        info: configured.provider,
        models: Array.from(configured.models.values()),
        sourceConnection: document.connection,
      })
  }
}

/** Applies one configured provider, first copying its source when `canonical` points it at another provider. */
function overlayProvider(
  providers: ProviderEditor,
  providerID: string,
  item: ConfigProvider.Info,
  integrationID?: ConfigIntegration.Document["integrationID"],
) {
  const current = providers.get(providerID)
  const source = providers.get(item.canonical ?? current?.provider.canonical ?? providerID)
  const changed = item.canonical !== undefined && item.canonical !== current?.provider.canonical
  providers.update(providerID, (provider) => {
    if (changed && source && source.provider !== provider)
      Object.assign(provider, structuredClone(source.provider), {
        id: provider.id,
        integrationID: provider.integrationID,
      })
    if (integrationID) provider.integrationID = integrationID
    provider.activation = "enabled"
    if (item.canonical !== undefined) provider.canonical = item.canonical
    if (item.name) provider.name = item.name
    if (item.package !== undefined) provider.package = item.package
    if (item.compatibility !== undefined) provider.compatibility = { ...provider.compatibility, ...item.compatibility }
    if (item.settings !== undefined) provider.settings = Provider.mergeOverlay(provider.settings, item.settings)
    if (item.headers !== undefined) provider.headers = Provider.mergeHeaders(provider.headers, item.headers)
    if (item.body !== undefined) provider.body = Provider.mergeOverlay(provider.body, item.body)
  })
  return { current, source, changed }
}

/** Applies one configured model, first resetting it to `inherit.base` when it starts again from the catalog. */
function overlay(
  models: Pick<ModelEditor, "update">,
  providerPackage: string | undefined,
  item: ConfigProvider.Info,
  providerID: string,
  id: string,
  config: NonNullable<ConfigProvider.Info["models"]>[string],
  inherit: { readonly base: Model.Info | undefined } | undefined,
) {
  models.update(providerID, id, (model) => {
    if (inherit) {
      if (inherit.base) Object.assign(model, structuredClone(inherit.base))
      if (item.package !== undefined) model.package = undefined
      if (item.settings?.baseURL !== undefined && model.settings) delete model.settings.baseURL
    }
    if (config.type !== undefined) model.type = config.type
    if (config.family !== undefined) model.family = config.family
    if (config.name) model.name = config.name
    if (config.modelID !== undefined) model.modelID = config.modelID
    if (config.releaseDate !== undefined) model.time = { released: Date.parse(config.releaseDate) }
    if (config.compatibility !== undefined) model.compatibility = { ...model.compatibility, ...config.compatibility }
    if (config.package !== undefined) model.package = config.package
    if (config.settings !== undefined) model.settings = Provider.mergeOverlay(model.settings, config.settings)
    if (config.headers !== undefined) model.headers = Provider.mergeHeaders(model.headers, config.headers)
    if (config.body !== undefined) model.body = Provider.mergeOverlay(model.body, config.body)
    if (config.capabilities !== undefined)
      model.capabilities = Model.mergeCapabilities(config.capabilities, model.capabilities)
    if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
  })
  // Variants are spelled for the final package, which the update above normalizes from `aisdk:*`.
  models.update(providerID, id, (model) => {
    // Configured reasoning replaces the base variants; configured variants still overlay them below.
    if (config.capabilities?.reasoning !== undefined)
      model.variants = [
        ...Variant.resolve(
          { ...model, package: model.package ?? providerPackage },
          Variant.supports(config.capabilities.reasoning),
        ),
      ]
    if (config.variants !== undefined) {
      model.variants ??= []
      for (const variant of config.variants) {
        let existing = model.variants.find((item) => item.id === variant.id)
        if (!existing) {
          existing = { id: variant.id }
          model.variants.push(existing)
        }
        if (variant.settings !== undefined)
          existing.settings = Provider.mergeOverlay(existing.settings, variant.settings)
        if (variant.headers !== undefined) existing.headers = Provider.mergeHeaders(existing.headers, variant.headers)
        if (variant.body !== undefined) existing.body = Provider.mergeOverlay(existing.body, variant.body)
      }
    }
    if (config.cost !== undefined) {
      model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
        tier: cost.tier && { ...cost.tier },
        input: cost.input,
        output: cost.output,
        cache: {
          read: cost.cache?.read ?? Money.USDPerMillionTokens.zero,
          write: cost.cache?.write ?? Money.USDPerMillionTokens.zero,
        },
      }))
    }
    if (config.disabled !== undefined) model.enabled = !config.disabled
  })
}
