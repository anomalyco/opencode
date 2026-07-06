export * as ConfigProviderPlugin from "./provider"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config"
import { ModelV2 } from "../../model"

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
      if (configuredDefault !== undefined) {
        const model = ModelV2.parse(configuredDefault)
        catalog.model.default.set(model.providerID, model.modelID)
      }
      for (const file of files) {
        for (const [id, item] of Object.entries(file.info.providers ?? {})) {
          const providerID = id
          catalog.provider.update(providerID, (provider) => {
            if (item.name !== undefined) provider.name = item.name
            if (item.api !== undefined) provider.api = { ...item.api }
            if (item.request !== undefined) {
              Object.assign(provider.request.settings, item.request.settings)
              Object.assign(provider.request.headers, item.request.headers)
              Object.assign(provider.request.body, item.request.body)
            }
          })
          for (const [id, config] of Object.entries(item.models ?? {})) {
            catalog.model.update(providerID, id, (model) => {
              if (config.family !== undefined) model.family = config.family
              if (config.name !== undefined) model.name = config.name
              if (config.api !== undefined) model.api = { ...model.api, ...config.api }
              if (config.capabilities !== undefined) {
                model.capabilities = {
                  tools: config.capabilities.tools,
                  input: [...config.capabilities.input],
                  output: [...config.capabilities.output],
                }
              }
              if (config.request !== undefined) {
                Object.assign(model.request.settings, config.request.settings)
                Object.assign(model.request.headers, config.request.headers)
                Object.assign(model.request.body, config.request.body)
                if (config.request.variant !== undefined) model.request.variant = config.request.variant
              }
              if (config.variants !== undefined) {
                for (const variant of config.variants) {
                  let existing = model.variants.find((item) => item.id === variant.id)
                  if (!existing) {
                    existing = {
                      id: variant.id,
                      settings: {},
                      headers: {},
                      body: {},
                    }
                    model.variants.push(existing)
                  }
                  Object.assign(existing.settings, variant.settings)
                  Object.assign(existing.headers, variant.headers)
                  Object.assign(existing.body, variant.body)
                }
              }
              if (config.cost !== undefined) {
                model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
                  tier: cost.tier && { ...cost.tier },
                  input: cost.input,
                  output: cost.output,
                  cache: {
                    read: cost.cache?.read ?? 0,
                    write: cost.cache?.write ?? 0,
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
