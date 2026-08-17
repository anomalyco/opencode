import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type {
  IntegrationCommandMethod,
  IntegrationEnvMethod,
  IntegrationKeyMethod,
  IntegrationOAuthMethod,
} from "@opencode-ai/sdk/v2/types"
import { Effect, Stream } from "effect"

type Overrides = Partial<Omit<PluginContext, "options" | "session">> & {
  readonly session?: Partial<PluginContext["session"]>
}

export function host(overrides: Overrides = {}): PluginContext {
  return {
    options: {},
    agent: overrides.agent ?? {
      get: () => Effect.die("unused agent.get"),
      list: () => Effect.die("unused agent.list"),
      transform: () => Effect.die("unused agent.transform"),
      reload: () => Effect.die("unused agent.reload"),
    },
    aisdk: overrides.aisdk ?? {
      hook: () => Effect.die("unused aisdk.hook"),
    },
    catalog: overrides.catalog ?? {
      provider: {
        list: () => Effect.die("unused catalog.provider.list"),
        get: () => Effect.die("unused catalog.provider.get"),
      },
      model: {
        get: () => Effect.die("unused catalog.model.get"),
        list: () => Effect.die("unused catalog.model.list"),
        default: () => Effect.die("unused catalog.model.default"),
      },
      transform: () => Effect.die("unused catalog.transform"),
      reload: () => Effect.die("unused catalog.reload"),
    },
    command: overrides.command ?? {
      list: () => Effect.die("unused command.list"),
      transform: () => Effect.die("unused command.transform"),
      reload: () => Effect.die("unused command.reload"),
    },
    event: overrides.event ?? {
      subscribe: () => Stream.empty,
    },
    integration: overrides.integration ?? {
      list: () => Effect.die("unused integration.list"),
      get: () => Effect.die("unused integration.get"),
      connect: {
        key: () => Effect.die("unused integration.connect.key"),
      },
      oauth: {
        connect: () => Effect.die("unused integration.oauth.connect"),
        status: () => Effect.die("unused integration.oauth.status"),
        complete: () => Effect.die("unused integration.oauth.complete"),
        cancel: () => Effect.die("unused integration.oauth.cancel"),
      },
      command: {
        connect: () => Effect.die("unused integration.command.connect"),
        status: () => Effect.die("unused integration.command.status"),
        cancel: () => Effect.die("unused integration.command.cancel"),
      },
      transform: () => Effect.die("unused integration.transform"),
      reload: () => Effect.die("unused integration.reload"),
      connection: {
        active: () => Effect.die("unused integration.connection.active"),
        resolve: () => Effect.die("unused integration.connection.resolve"),
      },
    },
    plugin: overrides.plugin ?? {
      list: () => Effect.die("unused plugin.list"),
    },
    reference: overrides.reference ?? {
      list: () => Effect.die("unused reference.list"),
      transform: () => Effect.die("unused reference.transform"),
      reload: () => Effect.die("unused reference.reload"),
    },
    skill: overrides.skill ?? {
      list: () => Effect.die("unused skill.list"),
      transform: () => Effect.die("unused skill.transform"),
      reload: () => Effect.die("unused skill.reload"),
    },
    tool: overrides.tool ?? {
      transform: () => Effect.die("unused tool.transform"),
      hook: () => Effect.die("unused tool.hook"),
    },
    session: {
      hook: overrides.session?.hook ?? (() => Effect.die("unused session.hook")),
      create: overrides.session?.create ?? (() => Effect.die("unused session.create")),
      get: overrides.session?.get ?? (() => Effect.die("unused session.get")),
      prompt: overrides.session?.prompt ?? (() => Effect.die("unused session.prompt")),
      generate: overrides.session?.generate ?? (() => Effect.die("unused session.generate")),
      command: overrides.session?.command ?? (() => Effect.die("unused session.command")),
      synthetic: overrides.session?.synthetic ?? (() => Effect.die("unused session.synthetic")),
      interrupt: overrides.session?.interrupt ?? (() => Effect.die("unused session.interrupt")),
    },
  }
}

export function agentHost(agent: AgentV2.Interface): PluginContext["agent"] {
  return {
    get: (id) => agent.get(AgentV2.ID.make(id)).pipe(Effect.map((value) => value && agentInfo(value))),
    list: () => Effect.die("unused agent.list"),
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
    provider: {
      list: () => Effect.die("unused catalog.provider.list"),
      get: () => Effect.die("unused catalog.provider.get"),
    },
    model: {
      get: (providerID, modelID) =>
        catalog.model
          .get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))
          .pipe(Effect.map((value) => value && modelInfo(value))),
      list: () => Effect.die("unused catalog.model.list"),
      default: () => Effect.die("unused catalog.model.default"),
    },
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
                  variants: current.variants?.map((variant) => ({
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
    list: () => Effect.die("unused integration.list"),
    get: () => Effect.die("unused integration.get"),
    connect: {
      key: () => Effect.die("unused integration.connect.key"),
    },
    oauth: {
      connect: () => Effect.die("unused integration.oauth.connect"),
      status: () => Effect.die("unused integration.oauth.status"),
      complete: () => Effect.die("unused integration.oauth.complete"),
      cancel: () => Effect.die("unused integration.oauth.cancel"),
    },
    command: {
      connect: () => Effect.die("unused integration.command.connect"),
      status: () => Effect.die("unused integration.command.status"),
      cancel: () => Effect.die("unused integration.command.cancel"),
    },
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
                              Effect.map((credential) =>
                                Credential.OAuth.make({
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
                              Effect.map((credential) =>
                                Credential.OAuth.make({
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
                            Effect.map((next) =>
                              Credential.OAuth.make({
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
              if (input.method.type === "command") {
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: {
                    ...input.method,
                    id: Integration.MethodID.make(input.method.id),
                    command: [...input.method.command],
                  },
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
  if (value.type === "command") return { ...value, command: [...value.command] }
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
  value: IntegrationOAuthMethod | IntegrationCommandMethod | IntegrationKeyMethod | IntegrationEnvMethod,
): Integration.Method {
  if (value.type === "env") return value
  if (value.type === "key") return value
  if (value.type === "command") {
    return {
      ...value,
      id: Integration.MethodID.make(value.id),
      command: [...value.command],
    }
  }
  return {
    ...value,
    id: Integration.MethodID.make(value.id),
  }
}

function agentInfo(value: AgentV2.Info) {
  return {
    ...value,
    model: value.model && { ...value.model },
    request: {
      settings: { ...value.request.settings },
      headers: { ...value.request.headers },
      body: { ...value.request.body },
    },
    permissions: value.permissions.map((permission) => ({ ...permission })),
  }
}

function providerInfo(value: ProviderV2.MutableInfo) {
  return {
    ...value,
    settings: value.settings && { ...value.settings },
    headers: value.headers && { ...value.headers },
    body: value.body && { ...value.body },
  }
}

function modelInfo(value: ModelV2.Info | ModelV2.MutableInfo) {
  return {
    ...value,
    settings: value.settings && { ...value.settings },
    headers: value.headers && { ...value.headers },
    body: value.body && { ...value.body },
    capabilities: {
      ...value.capabilities,
      input: [...value.capabilities.input],
      output: [...value.capabilities.output],
    },
    variants: value.variants?.map((variant) => ({
      ...variant,
      settings: variant.settings && { ...variant.settings },
      headers: variant.headers && { ...variant.headers },
      body: variant.body && { ...variant.body },
    })),
    time: { ...value.time },
    cost: value.cost.map((cost) => ({ ...cost, tier: cost.tier && { ...cost.tier }, cache: { ...cost.cache } })),
    limit: { ...value.limit },
  }
}
