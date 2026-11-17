import { Duration, Effect, Equal, Schema, Semaphore, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { ConnectionInfo } from "@opencode/client"
import { define } from "@opencode/plugin/effect/plugin"
import { Money } from "@opencode/schema/money"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"
import { configuredSettings } from "./configured.js"

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

class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()("Hostlinku.Unauthorized", {}) {
  override get message() {
    return unauthorizedMessage
  }
}

function normalizeBaseURL(input: unknown) {
  if (typeof input !== "string" || !input.trim()) return defaultBaseURL
  const raw = input.trim().replace(/\/+$/, "")
  if (!URL.canParse(raw)) return defaultBaseURL
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") return defaultBaseURL
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

function inferModelPackage(id: string): string | undefined {
  if (id.startsWith("claude-")) return "@opencode/ai/providers/anthropic-compatible"
  if (id.startsWith("gpt-")) return "@opencode/ai/providers/openai-compatible/responses"
  return undefined
}

function inferCompatibility(id: string): Model.Compatibility | undefined {
  if (id.startsWith("claude-") || id.startsWith("gpt-") || id.startsWith("gemini-")) return undefined
  return { reasoningField: "reasoning_content" }
}

function toModelInfo(item: typeof RemoteModel.Type, base: Model.Info | undefined): Model.Info {
  const modelID = Model.ID.make(item.id)
  const fallback = base ? structuredClone(base) : Model.Info.default(providerID, modelID)
  const caps = new Set(item.capabilities ?? [])
  const hasVision = caps.has("vision") || caps.has("image-input") || caps.has("multimodal")
  const hasPdf = caps.has("pdf-input") || caps.has("file-input")

  const context =
    typeof item.context_window === "number" && item.context_window > 0
      ? item.context_window
      : fallback.limit.context
  const output =
    typeof item.max_output_tokens === "number" && item.max_output_tokens > 0
      ? Math.min(item.max_output_tokens, context)
      : Math.min(fallback.limit.output, context)

  const pricing = item.pricing
  const cost: Model.Cost[] =
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
      : fallback.cost

  const pkg = fallback.package ?? inferModelPackage(item.id)
  const compatibility = fallback.compatibility ?? inferCompatibility(item.id)

  return {
    ...fallback,
    id: modelID,
    modelID,
    providerID,
    name: item.display_name || fallback.name || item.id,
    ...(pkg ? { package: pkg } : {}),
    ...(compatibility ? { compatibility } : {}),
    capabilities: {
      tools:
        caps.size > 0
          ? caps.has("tool-calling") || caps.has("function-calling")
          : fallback.capabilities.tools,
      input: Array.from(
        new Set([
          ...fallback.capabilities.input,
          "text",
          ...(hasVision ? ["image"] : []),
          ...(hasPdf ? ["pdf"] : []),
        ]),
      ),
      output: fallback.capabilities.output,
    },
    cost,
    enabled: true,
    status: "active",
    limit: {
      ...(fallback.limit.input !== undefined ? { input: Math.min(fallback.limit.input, context) } : {}),
      context,
      output,
    },
  }
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
          ? Effect.fail(new UnauthorizedError())
          : HttpClientResponse.filterStatusOk(response).pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(RemoteResponse)),
            ),
      ),
      Effect.scoped,
      Effect.timeout(Duration.seconds(10)),
    )
}

export const HostlinkuPlugin = define<HttpClient.HttpClient | Bus.Service>({
  id: "opencode.provider.hostlinku",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const http = yield* HttpClient.HttpClient
    const loading = Semaphore.makeUnsafe(1)

    type Snapshot = {
      connection: ConnectionInfo | undefined
      baseURL: string
      models: readonly (typeof RemoteModel.Type)[] | undefined
      serviceMode: string | undefined
    }

    let snapshot: Snapshot = {
      connection: undefined,
      baseURL: defaultBaseURL,
      models: undefined,
      serviceMode: undefined,
    }

    const resolveApiKey = Effect.fn("HostlinkuPlugin.resolveApiKey")(function* (
      connection: ConnectionInfo | undefined,
    ) {
      const configured = yield* configuredSettings(providerID).pipe(Effect.orElseSucceed(() => undefined))
      const baseURL = normalizeBaseURL(configured?.baseURL)
      if (connection?.type === "env") {
        return { baseURL, apiKey: process.env[connection.name] }
      }
      if (connection) {
        const credential = yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        if (credential?.type === "key" && credential.key) {
          return {
            baseURL: normalizeBaseURL(
              (credential.configuration as Record<string, unknown> | undefined)?.baseURL ?? configured?.baseURL,
            ),
            apiKey: credential.key,
          }
        }
      }
      const settingsKey = typeof configured?.apiKey === "string" ? configured.apiKey : undefined
      return {
        baseURL,
        apiKey: settingsKey || process.env.HOSTLINKU_API_KEY || undefined,
      }
    })

    const load = Effect.fn("HostlinkuPlugin.load")(function* (): Effect.Effect<Snapshot> {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const { baseURL, apiKey } = yield* resolveApiKey(connection)
      if (!apiKey) {
        return { connection, baseURL, models: undefined, serviceMode: undefined }
      }

      const clearStatus = () =>
        connection
          ? ctx.integration.connection.status({ integrationID, connection, status: undefined })
          : Effect.void

      const reportUnauthorized = () =>
        connection
          ? ctx.integration.connection.status({
              integrationID,
              connection,
              status: { status: "needs_auth", message: unauthorizedMessage },
            })
          : Effect.void

      return yield* fetchInventory(http, baseURL, apiKey).pipe(
        Effect.tap(clearStatus),
        Effect.map((response) => ({
          connection,
          baseURL,
          models: response.data,
          serviceMode: response.service_mode,
        })),
        Effect.catch((cause) =>
          Effect.gen(function* () {
            if (cause instanceof UnauthorizedError) {
              yield* reportUnauthorized()
              return { connection, baseURL, models: [], serviceMode: undefined }
            }
            yield* Effect.logWarning("failed to discover Hostlinku models from GET /v1/models", { cause })
            // Keep the last successful inventory for the same connection across transient outages.
            if (IntegrationConnection.key(connection) === IntegrationConnection.key(snapshot.connection)) {
              return {
                connection,
                baseURL,
                models: snapshot.models,
                serviceMode: snapshot.serviceMode,
              }
            }
            return { connection, baseURL, models: undefined, serviceMode: undefined }
          }),
        ),
      )
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

    snapshot = yield* load()

    yield* ctx.provider.transform((providers) => {
      if (snapshot.models === undefined) return

      const existing = providers.get(providerID)
      const info: Provider.Info = {
        ...(existing?.provider ?? Provider.Info.empty(providerID)),
        id: providerID,
        name: existing?.provider.name ?? "Hostlinku",
        integrationID,
        activation: existing?.provider.activation === "disabled" ? "disabled" : "enabled",
        package: existing?.provider.package || "@opencode/ai/providers/openai-compatible",
        settings: {
          ...existing?.provider.settings,
          baseURL: snapshot.baseURL,
        },
      }

      const mapped = snapshot.models.map((remote) => toModelInfo(remote, existing?.models.get(remote.id)))
      providers.add({
        info,
        models: mapped,
        sourceConnection: snapshot.connection,
      })
    })

    const refresh = Effect.fn("HostlinkuPlugin.refresh")(function* () {
      const next = yield* load()
      if (Equal.equals(snapshot, next)) return
      snapshot = next
      yield* ctx.provider.reload()
    })

    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(() => loading.withPermit(refresh())),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
}) satisfies PluginInternal.InternalPlugin
