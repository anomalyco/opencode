import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { IntegrationEnvMethod, IntegrationKeyMethod, IntegrationOAuthMethod } from "@opencode-ai/sdk/v2/types"
import { Effect } from "effect"

type Overrides = Partial<Omit<PluginContext, "options">>

export function host(overrides: Overrides = {}): PluginContext {
  return {
    options: {},
    agent: overrides.agent ?? {
      transform: () => Effect.die("unused agent.transform"),
      reload: () => Effect.die("unused agent.reload"),
    },
    aisdk: overrides.aisdk ?? {
      sdk: () => Effect.die("unused aisdk.sdk"),
      language: () => Effect.die("unused aisdk.language"),
    },
    catalog: overrides.catalog ?? {
      transform: () => Effect.die("unused catalog.transform"),
      reload: () => Effect.die("unused catalog.reload"),
    },
    command: overrides.command ?? {
      transform: () => Effect.die("unused command.transform"),
      reload: () => Effect.die("unused command.reload"),
    },
    integration: overrides.integration ?? {
      transform: () => Effect.die("unused integration.transform"),
      reload: () => Effect.die("unused integration.reload"),
      connection: {
        active: () => Effect.die("unused integration.connection.active"),
        resolve: () => Effect.die("unused integration.connection.resolve"),
      },
    },
    plugin: overrides.plugin ?? {
      add: () => Effect.die("unused plugin.add"),
      remove: () => Effect.die("unused plugin.remove"),
    },
    reference: overrides.reference ?? {
      transform: () => Effect.die("unused reference.transform"),
      reload: () => Effect.die("unused reference.reload"),
    },
    skill: overrides.skill ?? {
      transform: () => Effect.die("unused skill.transform"),
      reload: () => Effect.die("unused skill.reload"),
    },
  }
}

export function agentHost(agent: AgentV2.Interface): PluginContext["agent"] {
  return {
    reload: agent.reload,
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

export function catalogHost(catalog: Catalog.Interface): PluginContext["catalog"] {
  return {
    reload: catalog.reload,
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

export function integrationHost(integration: Integration.Interface): PluginContext["integration"] {
  return {
    reload: integration.reload,
    connection: {
      active: (id) => integration.connection.active(Integration.ID.make(id)),
      resolve: (connection) =>
        integration.connection.resolve(
          connection.type === "credential" ? { ...connection, id: Credential.ID.make(connection.id) } : connection,
        ),
    },
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
            update: (input) => {
              if ("authorize" in input) {
                const methodID = Integration.MethodID.make(input.method.id)
                const refresh = input.refresh
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: { ...input.method, id: methodID },
                  authorize: (inputs) =>
                    input.authorize(inputs).pipe(
                      Effect.map((authorization) => {
                        if (authorization.mode === "auto") {
                          return {
                            ...authorization,
                            callback: authorization.callback.pipe(
                              Effect.map(
                                (credential) =>
                                  new Credential.OAuth({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                              ),
                            ),
                          }
                        }
                        return {
                          ...authorization,
                          callback: (code: string) =>
                            authorization.callback(code).pipe(
                              Effect.map(
                                (credential) =>
                                  new Credential.OAuth({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                              ),
                            ),
                        }
                      }),
                    ),
                  ...(refresh
                    ? {
                        refresh: (value: Credential.OAuth) =>
                          refresh(value).pipe(
                            Effect.map(
                              (next) =>
                                new Credential.OAuth({
                                  ...next,
                                  methodID: Integration.MethodID.make(next.methodID),
                                }),
                            ),
                          ),
                      }
                    : {}),
                  ...(input.label ? { label: input.label } : {}),
                })
                return
              }
              if (input.method.type === "env") {
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: { ...input.method, names: [...input.method.names] },
                })
                return
              }
              draft.method.update({
                integrationID: Integration.ID.make(input.integrationID),
                method: input.method,
              })
            },
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
