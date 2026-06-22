import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { IntegrationEnvMethod, IntegrationKeyMethod, IntegrationOAuthMethod } from "@opencode-ai/sdk/v2/types"
import { Effect } from "effect"

type Overrides = {
  readonly hook?: {
    readonly agent?: PluginContext["hook"]["agent"]
    readonly aisdk?: PluginContext["hook"]["aisdk"]
    readonly catalog?: PluginContext["hook"]["catalog"]
    readonly command?: PluginContext["hook"]["command"]
    readonly integration?: PluginContext["hook"]["integration"]
    readonly plugin?: PluginContext["hook"]["plugin"]
    readonly reference?: PluginContext["hook"]["reference"]
    readonly skill?: PluginContext["hook"]["skill"]
  }
  readonly reload?: Partial<PluginContext["reload"]>
}

export function host(overrides: Overrides = {}): PluginContext {
  return {
    options: {},
    hook: {
      agent: overrides.hook?.agent ?? { transform: () => Effect.die("unused hook.agent.transform") },
      aisdk: overrides.hook?.aisdk ?? {
        sdk: () => Effect.die("unused hook.aisdk.sdk"),
        language: () => Effect.die("unused hook.aisdk.language"),
      },
      catalog: overrides.hook?.catalog ?? { transform: () => Effect.die("unused hook.catalog.transform") },
      command: overrides.hook?.command ?? { transform: () => Effect.die("unused hook.command.transform") },
      integration: overrides.hook?.integration ?? { transform: () => Effect.die("unused hook.integration.transform") },
      plugin: overrides.hook?.plugin ?? { transform: () => Effect.die("unused hook.plugin.transform") },
      reference: overrides.hook?.reference ?? { transform: () => Effect.die("unused hook.reference.transform") },
      skill: overrides.hook?.skill ?? { transform: () => Effect.die("unused hook.skill.transform") },
    },
    reload: {
      agent: overrides.reload?.agent ?? (() => Effect.die("unused reload.agent")),
      catalog: overrides.reload?.catalog ?? (() => Effect.die("unused reload.catalog")),
      command: overrides.reload?.command ?? (() => Effect.die("unused reload.command")),
      integration: overrides.reload?.integration ?? (() => Effect.die("unused reload.integration")),
      plugin: overrides.reload?.plugin ?? (() => Effect.die("unused reload.plugin")),
      reference: overrides.reload?.reference ?? (() => Effect.die("unused reload.reference")),
      skill: overrides.reload?.skill ?? (() => Effect.die("unused reload.skill")),
    },
  }
}

export function agentHost(agent: AgentV2.Interface): PluginContext["hook"]["agent"] {
  return {
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

export function catalogHost(catalog: Catalog.Interface): PluginContext["hook"]["catalog"] {
  return {
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

export function integrationHost(integration: Integration.Interface): PluginContext["hook"]["integration"] {
  return {
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
