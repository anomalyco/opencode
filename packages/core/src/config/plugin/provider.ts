export * as ConfigProviderPlugin from "./provider"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Money } from "@opencode-ai/schema/money"
import { Effect, Stream } from "effect"
import { Config } from "../../config"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

export const Plugin = define({
  id: "opencode.config.provider",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = { entries: yield* config.entries() }
    yield* ctx.integration.transform((integrations) => {
      const files = loaded.entries.filter((entry): entry is Config.Document => entry.type === "document")
      const configuredIntegrations = new Set(
        files.flatMap((file) =>
          Object.entries(file.info.providers ?? {}).flatMap(([id, provider]) =>
            provider.env === undefined ? [] : [id],
          ),
        ),
      )
      for (const file of files) {
        for (const [id, item] of Object.entries(file.info.providers ?? {})) {
          const integrationID = id
          if (!configuredIntegrations.has(id) && !integrations.get(integrationID)) continue
          integrations.update(integrationID, (integration) => {
            integration.name = item.name ?? integration.name
          })
          if (item.env !== undefined) {
            integrations.method.update({
              integrationID,
              method: { type: "env", names: [...item.env] },
            })
          }
        }
      }
    })

    yield* ctx.catalog.transform((catalog) => {
      const files = loaded.entries.filter((entry): entry is Config.Document => entry.type === "document")
      const configuredDefault = Config.latest(loaded.entries, "model")
      if (configuredDefault !== undefined)
        catalog.model.default.set(configuredDefault.providerID, configuredDefault.model)
      for (const file of files) {
        for (const [id, item] of Object.entries(file.info.providers ?? {})) {
          const providerID = id
          catalog.provider.update(providerID, (provider) => {
            if (item.name !== undefined) provider.name = item.name
            if (item.package !== undefined) provider.package = item.package
            if (item.settings !== undefined)
              provider.settings = ProviderV2.mergeOverlay(provider.settings, item.settings)
            if (item.headers !== undefined) provider.headers = ProviderV2.mergeHeaders(provider.headers, item.headers)
            if (item.body !== undefined) provider.body = ProviderV2.mergeOverlay(provider.body, item.body)
          })
          for (const [id, config] of Object.entries(item.models ?? {})) {
            catalog.model.update(providerID, id, (model) => {
              if (config.family !== undefined) model.family = config.family
              if (config.name !== undefined) model.name = config.name
              if (config.modelID !== undefined) model.modelID = config.modelID
              if (config.package !== undefined) model.package = config.package
              if (config.settings !== undefined)
                model.settings = ProviderV2.mergeOverlay(model.settings, config.settings)
              if (config.headers !== undefined) model.headers = ProviderV2.mergeHeaders(model.headers, config.headers)
              if (config.body !== undefined) model.body = ProviderV2.mergeOverlay(model.body, config.body)
              if (config.capabilities !== undefined) {
                model.capabilities = {
                  tools: config.capabilities.tools,
                  input: [...config.capabilities.input],
                  output: [...config.capabilities.output],
                }
              }
              if (config.variants !== undefined) {
                model.variants ??= []
                for (const variant of config.variants) {
                  let existing = model.variants.find((item) => item.id === variant.id)
                  if (!existing) {
                    existing = { id: variant.id }
                    model.variants.push(existing)
                  }
                  if (variant.settings !== undefined)
                    existing.settings = ProviderV2.mergeOverlay(existing.settings, variant.settings)
                  if (variant.headers !== undefined)
                    existing.headers = ProviderV2.mergeHeaders(existing.headers, variant.headers)
                  if (variant.body !== undefined) existing.body = ProviderV2.mergeOverlay(existing.body, variant.body)
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
              if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
            })
          }
        }
      }
    })
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() =>
        config.entries().pipe(
          Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
          Effect.andThen(ctx.integration.reload()),
          Effect.andThen(ctx.catalog.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
