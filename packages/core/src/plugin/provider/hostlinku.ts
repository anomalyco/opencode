import { Duration, Effect, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { Money } from "@opencode/schema/money"
import { Config } from "../../config.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { SharedCache } from "../../shared-cache.js"
import type { PluginInternal } from "../internal.js"
import { foldSettings } from "./configured.js"
import { activeCredential } from "./credential-settings.js"
import { ProviderRefresh } from "./refresh.js"

const defaultBaseURL = "https://api.hostlinku.com/v1"
const providerID = Provider.ID.make("hostlinku")
const integrationID = Integration.ID.make("hostlinku")
const unauthorizedMessage = "Invalid Hostlinku API key. Reconnect Hostlinku with a valid key."

const RemotePricing = Schema.Struct({
  input: Schema.NullOr(Schema.Number),
  output: Schema.NullOr(Schema.Number),
  cache_read: Schema.optional(Schema.NullOr(Schema.Number)),
  cache_write: Schema.optional(Schema.NullOr(Schema.Number)),
})

const RemoteModel = Schema.Struct({
  id: Schema.String,
  display_name: Schema.optional(Schema.String),
  context_window: Schema.optional(Schema.NullOr(Schema.Int)),
  max_output_tokens: Schema.optional(Schema.NullOr(Schema.Int)),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
  service_mode: Schema.optional(Schema.String),
  pricing: Schema.optional(Schema.NullOr(RemotePricing)),
})

const RemoteResponse = Schema.Struct({
  service_mode: Schema.optional(Schema.String),
  data: Schema.Array(RemoteModel),
})

type RemoteModelInfo = typeof RemoteModel.Type
type Connection = Effect.Success<ReturnType<Context["integration"]["connection"]["active"]>>

type Snapshot = {
  readonly connection?: Connection
  readonly baseURL?: string
  readonly models?: readonly RemoteModelInfo[]
}

type CacheResult =
  | { readonly kind: "ok"; readonly models: readonly RemoteModelInfo[] }
  | { readonly kind: "unauthorized" }

function normalizeBaseURL(input: unknown) {
  if (typeof input !== "string" || !input.trim()) return defaultBaseURL
  const raw = input.trim().replace(/\/+$/, "")
  if (!URL.canParse(raw)) return defaultBaseURL
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") return defaultBaseURL
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

function modelsKey(connection: Connection, apiKey: string, baseURL: string) {
  const access = IntegrationConnection.key(connection) ?? "env:HOSTLINKU_API_KEY"
  return `hostlinku:${access}:${SharedCache.fingerprint(apiKey)}:${baseURL.replace(/\/+$/, "")}`
}

function toModelInfo(id: Model.ID, remote: RemoteModelInfo, baseURL: string, previous?: Model.Info): Model.Info {
  const pricing = remote.pricing
  const cost =
    pricing && typeof pricing.input === "number" && typeof pricing.output === "number"
      ? [
          {
            input: Money.USDPerMillionTokens.make(pricing.input),
            output: Money.USDPerMillionTokens.make(pricing.output),
            cache: {
              read: Money.USDPerMillionTokens.make(pricing.cache_read ?? 0),
              write: Money.USDPerMillionTokens.make(pricing.cache_write ?? 0),
            },
          },
        ]
      : previous?.cost

  const caps = new Set(remote.capabilities ?? [])
  const hasVision = caps.has("vision") || caps.has("image-input") || caps.has("multimodal")
  const hasPdf = caps.has("pdf-input") || caps.has("file-input")
  const explicitInputs = ["text", ...(hasVision ? ["image"] : []), ...(hasPdf ? ["pdf"] : [])]

  const context =
    typeof remote.context_window === "number" && remote.context_window > 0
      ? remote.context_window
      : (previous?.limit.context ?? 0)
  const rawOutput =
    typeof remote.max_output_tokens === "number" && remote.max_output_tokens > 0
      ? remote.max_output_tokens
      : (previous?.limit.output ?? 0)
  const output = context > 0 ? Math.min(rawOutput, context) : rawOutput
  const inputLimit =
    previous?.limit.input !== undefined && context > 0 ? Math.min(previous.limit.input, context) : previous?.limit.input

  return Model.Info.make({
    ...Model.Info.default(providerID, id),
    id,
    modelID: Model.ID.make(remote.id),
    providerID,
    name: remote.display_name || previous?.name || remote.id,
    family: previous?.family,
    compatibility: previous?.compatibility,
    package: previous?.package,
    settings: Provider.mergeOverlay(previous?.settings, { baseURL, provider: providerID }),
    headers: previous?.headers,
    body: previous?.body,
    capabilities: {
      tools:
        caps.size > 0
          ? caps.has("tools") || caps.has("tool-calling") || caps.has("function-calling")
          : (previous?.capabilities.tools ?? true),
      input:
        caps.size > 0
          ? Array.from(new Set([...(previous?.capabilities.input ?? []), ...explicitInputs]))
          : (previous?.capabilities.input ?? ["text"]),
      output: previous?.capabilities.output ?? ["text"],
      ...(previous?.capabilities.temperature !== undefined ? { temperature: previous.capabilities.temperature } : {}),
      ...(previous?.capabilities.freeform !== undefined ? { freeform: previous.capabilities.freeform } : {}),
    },
    variants: previous?.variants ?? [],
    time: previous?.time ?? { released: 0 },
    ...(cost ? { cost } : {}),
    status: previous?.status ?? "active",
    enabled: true,
    limit: {
      context,
      ...(inputLimit === undefined ? {} : { input: inputLimit }),
      output,
    },
  })
}

function fetchInventory(http: HttpClient.HttpClient, baseURL: string, apiKey: string) {
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(`${baseURL}/models`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(apiKey),
      ),
    )
    .pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      Effect.flatMap((response) =>
        response.status === 401 || response.status === 403
          ? Effect.succeed<CacheResult>({ kind: "unauthorized" })
          : HttpClientResponse.filterStatusOk(response).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(RemoteResponse)),
              Effect.map((body): CacheResult => ({ kind: "ok", models: body.data })),
            ),
      ),
      Effect.scoped,
      Effect.timeout(Duration.seconds(10)),
    )
}

export const HostlinkuPlugin = define({
  id: "opencode.provider.hostlinku",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const cache = yield* SharedCache.Service
    const http = yield* HttpClient.HttpClient

    const discovered = yield* ProviderRefresh.start({
      integrationID,
      initial: {} as Snapshot,
      active: ctx.integration.connection.active(integrationID),
      reload: ctx.provider.reload(),
      load: Effect.fn("HostlinkuPlugin.load")(function* (current, options) {
        const { connection, credential } = yield* activeCredential(ctx, integrationID)
        const catalogProvider = yield* providers.get(providerID)
        const entries = Option.isSome(config)
          ? yield* config.value.entries().pipe(Effect.orElseSucceed(() => [] as const))
          : ([] as const)
        const configured = foldSettings(entries, providerID, catalogProvider?.settings)
        const catalogBaseURL =
          typeof catalogProvider?.settings?.baseURL === "string" ? catalogProvider.settings.baseURL : undefined
        const credBaseURL = credential?.type === "key" ? credential.metadata?.baseURL : undefined
        const baseURL = normalizeBaseURL(credBaseURL ?? configured?.baseURL ?? catalogBaseURL)
        const settingsKey = typeof configured?.apiKey === "string" ? configured.apiKey : undefined
        const apiKey =
          credential?.type === "key" ? credential.key : settingsKey || process.env.HOSTLINKU_API_KEY || undefined
        if (!apiKey) return { connection, value: {} as Snapshot }

        const result = yield* cache
          .get({
            key: modelsKey(connection, apiKey, baseURL),
            ...options,
            load: (connection ? ctx.integration.connection.resolve(connection) : Effect.undefined).pipe(
              Effect.map((resolved) =>
                resolved?.type === "key"
                  ? {
                      key: resolved.key,
                      url: normalizeBaseURL(resolved.metadata?.baseURL ?? configured?.baseURL ?? catalogBaseURL),
                    }
                  : connection?.type === "credential"
                    ? undefined
                    : { key: settingsKey || process.env.HOSTLINKU_API_KEY, url: baseURL },
              ),
              Effect.flatMap((resolved) =>
                resolved?.key
                  ? fetchInventory(http, resolved.url, resolved.key)
                  : Effect.fail(new Error("Hostlinku connection has no API key")),
              ),
            ),
          })
          .pipe(Effect.orElseSucceed(() => undefined))

        if (connection && result) {
          yield* ctx.integration.connection.status({
            integrationID,
            connection,
            status: result.kind === "unauthorized" ? { status: "needs_auth", message: unauthorizedMessage } : undefined,
          })
        }

        if (result === undefined) {
          const sameConnection = IntegrationConnection.key(connection) === IntegrationConnection.key(current.connection)
          return {
            connection,
            value: {
              connection,
              baseURL,
              ...(sameConnection && current.models !== undefined ? { models: current.models } : {}),
            } as Snapshot,
          }
        }

        const models = result.kind === "ok" ? result.models : ([] as readonly RemoteModelInfo[])
        return { connection, value: { connection, baseURL, models } as Snapshot }
      }),
    })

    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = "Hostlinku"
      })
      editor.method.update({
        integrationID,
        method: { type: "env", names: ["HOSTLINKU_API_KEY"] },
      })
      editor.method.update({
        integrationID,
        method: { type: "key", label: "Hostlinku API key" },
      })
    })

    yield* ctx.provider.transform((evt) => {
      const loaded = discovered.current
      if (loaded.models === undefined || !loaded.baseURL) return

      const existing = evt.get(providerID)
      const info: Provider.Info = {
        ...(existing?.provider ?? Provider.Info.empty(providerID)),
        id: providerID,
        name: existing?.provider.name ?? "Hostlinku",
        integrationID,
        activation: existing?.provider.activation === "disabled" ? "disabled" : "enabled",
        package: existing?.provider.package || "@opencode/ai/providers/openai-compatible",
        settings: Provider.mergeOverlay(existing?.provider.settings, { baseURL: loaded.baseURL }),
      }

      const mapped = loaded.models.map((remote) => {
        const modelID = Model.ID.make(remote.id)
        return toModelInfo(modelID, remote, loaded.baseURL!, existing?.models.get(modelID))
      })

      evt.add({
        info,
        models: mapped,
        sourceConnection: loaded.connection,
      })
    })
  }),
} satisfies PluginInternal.InternalPlugin)
