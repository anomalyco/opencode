import type { AISDKHooks, PluginHost } from "@opencode-ai/plugin/v2/effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { IntegrationEnvMethod, IntegrationKeyMethod, IntegrationOAuthMethod } from "@opencode-ai/sdk/v2/types"
import { Effect, Stream } from "effect"

export function host(overrides: Partial<PluginHost> = {}): PluginHost {
  return {
    aisdk: {
      hook: () => Effect.die("unused aisdk.hook"),
    },
    agent: {
      get: () => Effect.die("unused agent.get"),
      default: () => Effect.die("unused agent.default"),
      list: () => Effect.die("unused agent.list"),
      rebuild: () => Effect.die("unused agent.rebuild"),
      transform: () => Effect.die("unused agent.transform"),
    },
    catalog: {
      provider: {
        get: () => Effect.die("unused catalog.provider.get"),
        list: () => Effect.die("unused catalog.provider.list"),
        available: () => Effect.die("unused catalog.provider.available"),
      },
      model: {
        get: () => Effect.die("unused catalog.model.get"),
        list: () => Effect.die("unused catalog.model.list"),
        available: () => Effect.die("unused catalog.model.available"),
        default: () => Effect.die("unused catalog.model.default"),
        small: () => Effect.die("unused catalog.model.small"),
      },
      rebuild: () => Effect.die("unused catalog.rebuild"),
      transform: () => Effect.die("unused catalog.transform"),
    },
    command: {
      get: () => Effect.die("unused command.get"),
      list: () => Effect.die("unused command.list"),
      rebuild: () => Effect.die("unused command.rebuild"),
      transform: () => Effect.die("unused command.transform"),
    },
    event: {
      subscribe: () => Stream.die("unused event.subscribe"),
    },
    filesystem: {
      read: () => Effect.die("unused filesystem.read"),
      list: () => Effect.die("unused filesystem.list"),
      find: () => Effect.die("unused filesystem.find"),
      glob: () => Effect.die("unused filesystem.glob"),
    },
    integration: {
      get: () => Effect.die("unused integration.get"),
      list: () => Effect.die("unused integration.list"),
      rebuild: () => Effect.die("unused integration.rebuild"),
      transform: () => Effect.die("unused integration.transform"),
    },
    location: {
      directory: "/unused/location",
      project: { directory: "/unused/project" },
    },
    npm: {
      add: () => Effect.die("unused npm.add"),
    },
    path: {
      home: "/unused/home",
      data: "/unused/data",
      cache: "/unused/cache",
      config: "/unused/config",
      state: "/unused/state",
      temp: "/unused/temp",
    },
    reference: {
      list: () => Effect.die("unused reference.list"),
      rebuild: () => Effect.die("unused reference.rebuild"),
      transform: () => Effect.die("unused reference.transform"),
    },
    skill: {
      sources: () => Effect.die("unused skill.sources"),
      list: () => Effect.die("unused skill.list"),
      rebuild: () => Effect.die("unused skill.rebuild"),
      transform: () => Effect.die("unused skill.transform"),
    },
    ...overrides,
  }
}

export function aisdkHost(plugin: PluginV2.Interface): PluginHost["aisdk"] {
  return {
    hook: (name, callback) => {
      if (name === "sdk") {
        const run = callback as AISDKHooks["sdk"]
        return plugin.hook("aisdk.sdk", (event) => {
          const output = { ...event }
          const result = run(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.sdk = output.sdk))),
          )
        })
      }
      const run = callback as AISDKHooks["language"]
      return plugin.hook("aisdk.language", (event) => {
        const output = { ...event }
        const result = run(output)
        return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
          Effect.tap(() => Effect.sync(() => (event.language = output.language))),
        )
      })
    },
  }
}

export function agentHost(agent: AgentV2.Interface): PluginHost["agent"] {
  return {
    ...host().agent,
    transform: (callback) =>
      agent.transform((draft) =>
        callback({
          list: () => draft.list().map(agentInfo),
          get: (id) => {
            const value = draft.get(AgentV2.ID.make(id))
            return value && agentInfo(value)
          },
          default: (id) => draft.default(id === undefined ? undefined : AgentV2.ID.make(id)),
          update: (id, update) =>
            draft.update(AgentV2.ID.make(id), (value) => {
              const current = agentInfo(value)
              update(current)
              Object.assign(value, current, { id: AgentV2.ID.make(current.id) })
            }),
          remove: (id) => draft.remove(AgentV2.ID.make(id)),
        }),
      ),
  }
}

export function catalogHost(catalog: Catalog.Interface): PluginHost["catalog"] {
  return {
    ...host().catalog,
    rebuild: catalog.rebuild,
    transform: (callback) =>
      catalog.transform((draft) =>
        callback({
          provider: {
            list: () =>
              draft.provider.list().map((value) => ({
                provider: providerInfo(value.provider),
                models: new Map(Array.from(value.models, ([id, model]) => [id, modelInfo(model)])),
              })),
            get: (id) => {
              const value = draft.provider.get(ProviderV2.ID.make(id))
              return (
                value && {
                  provider: providerInfo(value.provider),
                  models: new Map(Array.from(value.models, ([id, model]) => [id, modelInfo(model)])),
                }
              )
            },
            update: (id, update) =>
              draft.provider.update(ProviderV2.ID.make(id), (value) => {
                const current = providerInfo(value)
                update(current)
                Object.assign(value, current, { id: ProviderV2.ID.make(current.id) })
              }),
            remove: (id) => draft.provider.remove(ProviderV2.ID.make(id)),
          },
          model: {
            get: (providerID, modelID) => {
              const value = draft.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))
              return value && modelInfo(value)
            },
            update: (providerID, modelID, update) =>
              draft.model.update(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID), (value) => {
                const current = modelInfo(value)
                update(current)
                Object.assign(value, current, {
                  id: ModelV2.ID.make(current.id),
                  providerID: ProviderV2.ID.make(current.providerID),
                  family: current.family === undefined ? undefined : ModelV2.Family.make(current.family),
                  variants: current.variants.map((variant) => ({
                    ...variant,
                    id: ModelV2.VariantID.make(variant.id),
                  })),
                })
              }),
            remove: (providerID, modelID) =>
              draft.model.remove(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
            default: {
              get: () => {
                const value = draft.model.default.get()
                return value && { providerID: value.providerID, modelID: value.modelID }
              },
              set: (providerID, modelID) =>
                draft.model.default.set(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
            },
          },
        }),
      ),
  }
}

export function integrationHost(integration: Integration.Interface): PluginHost["integration"] {
  const info = (value: Integration.Info) => ({
    id: value.id,
    name: value.name,
    methods: value.methods.map(method),
    connections: value.connections.map((item) => ({ ...item })),
  })
  return {
    get: (id) => integration.get(Integration.ID.make(id)).pipe(Effect.map((value) => value && info(value))),
    list: () => integration.list().pipe(Effect.map((items) => items.map(info))),
    rebuild: integration.rebuild,
    transform: (callback) =>
      integration.transform((draft) =>
        callback({
          list: () => draft.list().map((value) => ({ id: value.id, name: value.name })),
          get: (id) => {
            const value = draft.get(Integration.ID.make(id))
            return value && { id: value.id, name: value.name }
          },
          update: (id, update) => draft.update(Integration.ID.make(id), update),
          remove: (id) => draft.remove(Integration.ID.make(id)),
          method: {
            list: (id) => draft.method.list(Integration.ID.make(id)).map(method),
            update: (input) =>
              input.method.type === "env"
                ? draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { ...input.method, names: [...input.method.names] },
                  })
                : draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: input.method,
                  }),
            remove: (id, item) => draft.method.remove(Integration.ID.make(id), internalMethod(item)),
          },
        }),
      ),
  }
}

function method(value: Integration.Method) {
  if (value.type === "env") return { type: value.type, names: [...value.names] }
  if (value.type === "key") return { type: value.type, label: value.label }
  return {
    type: value.type,
    id: value.id,
    label: value.label,
    prompts: value.prompts?.map((prompt) => {
      if (prompt.type === "text") return { ...prompt }
      return { ...prompt, options: prompt.options.map((option) => ({ ...option })) }
    }),
  }
}

function internalMethod(
  value: IntegrationOAuthMethod | IntegrationKeyMethod | IntegrationEnvMethod,
): Integration.Method {
  if (value.type === "env") return value
  if (value.type === "key") return value
  return {
    ...value,
    id: Integration.MethodID.make(value.id),
  }
}

function agentInfo(value: AgentV2.Info) {
  return {
    ...value,
    model: value.model && { ...value.model },
    request: { headers: { ...value.request.headers }, body: { ...value.request.body } },
    permissions: value.permissions.map((permission) => ({ ...permission })),
  }
}

function providerInfo(value: ProviderV2.MutableInfo) {
  return {
    ...value,
    api: { ...value.api, settings: value.api.settings && { ...value.api.settings } },
    request: { headers: { ...value.request.headers }, body: { ...value.request.body } },
  }
}

function modelInfo(value: ModelV2.Info | ModelV2.MutableInfo) {
  return {
    ...value,
    api: { ...value.api, settings: value.api.settings && { ...value.api.settings } },
    capabilities: {
      ...value.capabilities,
      input: [...value.capabilities.input],
      output: [...value.capabilities.output],
    },
    request: {
      ...value.request,
      headers: { ...value.request.headers },
      body: { ...value.request.body },
      generation: value.request.generation && {
        ...value.request.generation,
        stop: value.request.generation.stop && [...value.request.generation.stop],
      },
      options: value.request.options && { ...value.request.options },
    },
    variants: value.variants.map((variant) => ({
      ...variant,
      headers: { ...variant.headers },
      body: { ...variant.body },
      generation: variant.generation && {
        ...variant.generation,
        stop: variant.generation.stop && [...variant.generation.stop],
      },
      options: variant.options && { ...variant.options },
    })),
    time: { ...value.time },
    cost: value.cost.map((cost) => ({ ...cost, tier: cost.tier && { ...cost.tier }, cache: { ...cost.cache } })),
    limit: { ...value.limit },
  }
}
