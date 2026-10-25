export * as OpencodeLegacy from "./opencode-legacy.js"

// The OpenCode Console's original `/api/v2/config` response, which it serves without `$schema`. Unlike a regular
// OpenCode config, the plugin applies it itself: providers, organization policy, web search, and MCP servers.
// Delete this module and its uses in opencode.ts once every Console serves a regular OpenCode config.

import { Effect, Schema } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { WebSearchDefinition } from "@opencode/plugin/effect/websearch"
import { ConfigProvider } from "@opencode/schema/config/provider"
import { Mcp } from "@opencode/schema/mcp"
import { Money } from "@opencode/schema/money"
import { ConfigIntegration } from "../../config/integration.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { Variant } from "../../variant.js"
import { WebSearch } from "../../websearch.js"

export const Response = Schema.Struct({
  providers: Schema.Record(Schema.String, ConfigProvider.Info),
  websearch: Schema.Struct({
    providerID: WebSearch.ID,
  }).pipe(Schema.optional),
  // MCP servers by name, in the same shape as a remote server in local config. Only remote servers are
  // accepted so the Console can never make the client run a command. `auth: "console"` asks the client
  // to attach its own Console credential to that server's requests.
  mcp: Schema.Struct({
    servers: Schema.Record(
      Schema.String,
      Schema.Struct({ ...Mcp.RemoteConfig.fields, auth: Schema.Literal("console").pipe(Schema.optional) }),
    ),
  }).pipe(Schema.optional),
  // Organization policy compiled for the authenticated caller; omitted when there is none.
  // `experimental.policies` remains accepted alongside top-level `policies`.
  policies: ConfigIntegration.Policies.pipe(Schema.optional),
  experimental: Schema.Struct({ policies: ConfigIntegration.Policies.pipe(Schema.optional) }).pipe(Schema.optional),
})
export type Response = typeof Response.Type

export interface Snapshot {
  readonly type: "legacy"
  readonly response: Response
  // Console MCP servers carry the credential in their headers, so a rotated token changes the snapshot.
  readonly mcp: { servers: NonNullable<Response["mcp"]>["servers"]; headers: Record<string, string> } | undefined
}

/** The plugin's Console response in either format; this module only acts on the legacy one. */
type Remote = Snapshot | { readonly type: "config" } | undefined

type Connection = NonNullable<Effect.Success<ReturnType<Context["integration"]["connection"]["active"]>>>

export function make(response: Response, headers: Record<string, string>): Snapshot {
  return { type: "legacy", response, mcp: response.mcp && { servers: response.mcp.servers, headers } }
}

/** Organization policy statements, which the plugin hands to `ManagedPolicy` instead of config. */
export function statements(snapshot: Snapshot) {
  return [...(snapshot.response.experimental?.policies ?? []), ...(snapshot.response.policies ?? [])]
}

/** Providers the legacy response routes through the Console, so the plugin can explain their rejected inference. */
export function providerIDs(remote: Remote) {
  return remote?.type === "legacy" ? Object.keys(remote.response.providers) : []
}

/**
 * Registers the transforms that apply a legacy snapshot: the Console's providers bound to its connection, its web
 * search provider as the default, and its MCP servers with the Console credential where they ask for it.
 */
export const register = Effect.fn("OpencodeLegacy.register")(function* (
  ctx: Context,
  current: () => { readonly remote: Remote; readonly connection: Connection | undefined },
  search: (providerID: WebSearch.ID, connection: Connection) => WebSearchDefinition,
) {
  yield* ctx.provider.transform((providers) => {
    const snapshot = current()
    const remote = snapshot.remote?.type === "legacy" ? snapshot.remote : undefined
    for (const [providerID, item] of Object.entries(remote?.response.providers ?? {})) {
      const source = providers.get(item.canonical ?? providerID)
      providers.update(providerID, (provider) => {
        if (source && source.provider !== provider)
          Object.assign(provider, structuredClone(source.provider), { id: provider.id })
        provider.integrationID = Integration.ID.make("opencode")
        if (item.canonical !== undefined) provider.canonical = item.canonical
        if (item.name !== undefined) provider.name = item.name
        provider.package = item.package ?? provider.package
        provider.settings = Provider.mergeOverlay(
          withoutCredentials(provider.settings),
          withoutCredentials(item.settings),
        )
        provider.headers = Provider.mergeHeaders(provider.headers, item.headers)
        provider.body = Provider.mergeOverlay(provider.body, item.body)
      })

      for (const [modelID, config] of Object.entries(item.models ?? {})) {
        const base = source?.models.get(config.modelID ?? modelID) ?? source?.models.get(modelID)
        providers.models.update(providerID, modelID, (model) => {
          Object.assign(model, structuredClone(base ?? model))
          if (config.family !== undefined) model.family = config.family
          if (config.name !== undefined) model.name = config.name
          if (config.modelID !== undefined) model.modelID = config.modelID
          if (config.releaseDate !== undefined) model.time = { released: Date.parse(config.releaseDate) }
          if (config.compatibility !== undefined)
            model.compatibility = { ...model.compatibility, ...config.compatibility }
          model.package = config.package ?? (item.package !== undefined ? undefined : model.package)
          if (item.settings?.baseURL !== undefined && model.settings) delete model.settings.baseURL
          if (config.capabilities !== undefined)
            model.capabilities = Model.mergeCapabilities(config.capabilities, model.capabilities)
          model.settings = Provider.mergeOverlay(
            withoutCredentials(model.settings),
            withoutCredentials(config.settings),
          )
          model.headers = Provider.mergeHeaders(model.headers, config.headers)
          model.body = Provider.mergeOverlay(model.body, config.body)
          if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
        })
        // Variants are spelled for the final package, which the update above normalizes from `aisdk:*`.
        providers.models.update(providerID, modelID, (model) => {
          // The Console's reasoning replaces the base variants; its variants still overlay them below.
          if (config.capabilities?.reasoning !== undefined)
            model.variants = [
              ...Variant.resolve(
                { ...model, package: model.package ?? providers.get(providerID)?.provider.package },
                Variant.supports(config.capabilities.reasoning),
              ),
            ]
          for (const variant of config.variants ?? []) {
            let existing = model.variants.find((item) => item.id === variant.id)
            if (!existing) {
              existing = { id: variant.id }
              model.variants.push(existing)
            }
            if (variant.settings !== undefined)
              existing.settings = Provider.mergeOverlay(existing.settings, withoutCredentials(variant.settings))
            if (variant.headers !== undefined)
              existing.headers = Provider.mergeHeaders(existing.headers, variant.headers)
            if (variant.body !== undefined) existing.body = Provider.mergeOverlay(existing.body, variant.body)
          }
          if (config.cost !== undefined)
            model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
              tier: cost.tier && { ...cost.tier },
              input: cost.input,
              output: cost.output,
              cache: {
                read: cost.cache?.read ?? Money.USDPerMillionTokens.zero,
                write: cost.cache?.write ?? Money.USDPerMillionTokens.zero,
              },
            }))
          model.enabled = !config.disabled
        })
      }
      const configured = providers.get(providerID)
      if (configured)
        providers.add({
          info: configured.provider,
          models: Array.from(configured.models.values()),
          sourceConnection: snapshot.connection,
        })
    }
  })

  yield* ctx.websearch.transform((editor) => {
    const snapshot = current()
    const descriptor = snapshot.remote?.type === "legacy" ? snapshot.remote.response.websearch : undefined
    const connection = snapshot.connection
    if (!descriptor || !connection) return
    editor.add(search(descriptor.providerID, connection))
    editor.default.set(descriptor.providerID)
  })

  yield* ctx.mcp.transform((editor) => {
    const remote = current().remote
    const mcp = remote?.type === "legacy" ? remote.mcp : undefined
    if (!mcp) return
    for (const [name, server] of Object.entries(mcp.servers)) {
      // A server the user configured under the same name wins.
      if (editor.get(name)) continue
      const { auth, ...config } = server
      editor.set(name, auth === "console" ? { ...config, headers: { ...config.headers, ...mcp.headers } } : config)
    }
  })
})

function withoutCredentials<Value>(body: Readonly<Record<string, Value>> | undefined) {
  return (
    body &&
    Object.fromEntries(Object.entries(body).filter(([key]) => !["apiKey", "authToken", "accessToken"].includes(key)))
  )
}
