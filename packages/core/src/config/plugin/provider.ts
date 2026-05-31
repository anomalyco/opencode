export * as ConfigProviderPlugin from "./provider"

import { Effect } from "effect"
import { Catalog } from "../../catalog"
import { Config } from "../../config"
import { ModelV2 } from "../../model"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

export const Plugin = PluginV2.define({
  id: PluginV2.ID.make("config-provider"),
  effect: Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const config = yield* Config.Service
    const transform = yield* catalog.transform()
    const files = yield* config.get()

    yield* transform((catalog) => {
      for (const file of files) {
        for (const [id, item] of Object.entries(file.info.providers ?? {})) {
          const providerID = ProviderV2.ID.make(id)
          catalog.provider.update(providerID, (provider) => {
            if (item.name !== undefined) provider.name = item.name
            if (item.env !== undefined) provider.env = [...item.env]
            provider.enabled = { via: "custom", data: {} }
            if (item.endpoint !== undefined) provider.endpoint = { ...item.endpoint }
            if (item.options !== undefined) {
              Object.assign(provider.options.headers, item.options.headers ?? {})
              Object.assign(provider.options.body, item.options.body ?? {})
              Object.assign(provider.options.aisdk.provider, item.options.aisdk?.provider ?? {})
              Object.assign(provider.options.aisdk.request, item.options.aisdk?.request ?? {})
            }
          })

          for (const [id, config] of Object.entries(item.models ?? {})) {
            catalog.model.update(providerID, ModelV2.ID.make(id), (model) => {
              if (config.api_id !== undefined) model.apiID = config.api_id
              if (config.family !== undefined) model.family = config.family
              if (config.name !== undefined) model.name = config.name
              if (config.endpoint !== undefined) model.endpoint = { ...config.endpoint }
              if (config.capabilities !== undefined) {
                model.capabilities = {
                  tools: config.capabilities.tools,
                  input: [...config.capabilities.input],
                  output: [...config.capabilities.output],
                }
              }
              if (config.options !== undefined) {
                Object.assign(model.options.headers, config.options.headers ?? {})
                Object.assign(model.options.body, config.options.body ?? {})
                Object.assign(model.options.aisdk.provider, config.options.aisdk?.provider ?? {})
                Object.assign(model.options.aisdk.request, config.options.aisdk?.request ?? {})
                if (config.options.variant !== undefined) model.options.variant = config.options.variant
              }
              if (config.variants !== undefined) {
                for (const variant of config.variants) {
                  let existing = model.variants.find((item) => item.id === variant.id)
                  if (!existing) {
                    existing = {
                      id: variant.id,
                      headers: {},
                      body: {},
                      aisdk: {
                        provider: {},
                        request: {},
                      },
                    }
                    model.variants.push(existing)
                  }
                  Object.assign(existing.headers, variant.headers ?? {})
                  Object.assign(existing.body, variant.body ?? {})
                  Object.assign(existing.aisdk.provider, variant.aisdk?.provider ?? {})
                  Object.assign(existing.aisdk.request, variant.aisdk?.request ?? {})
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
  }),
})
