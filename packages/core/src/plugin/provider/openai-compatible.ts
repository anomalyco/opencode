import { define } from "@opencode/plugin/effect/plugin"
import type { Document, Entry } from "@opencode/schema/config"
import { type Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { Credential } from "../../credential.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"
import { foldSettings } from "./configured.js"

const Strings = Schema.NullOr(Schema.Array(Schema.String)).pipe(Schema.optional)

const RemoteModel = Schema.Struct({
  id: Schema.String,
  mode: Schema.NullOr(Schema.String).pipe(Schema.optional),
  // Gateways report modalities at the top level or under `architecture`, as OpenRouter does.
  input_modalities: Strings,
  output_modalities: Strings,
  architecture: Schema.NullOr(Schema.Struct({ input_modalities: Strings, output_modalities: Strings })).pipe(
    Schema.optional,
  ),
  supported_parameters: Strings,
})

const Models = Schema.Struct({ data: Schema.Array(RemoteModel) })

// Gateways such as LiteLLM also list embedding, image, and audio models.
const chat = new Set(["chat", "responses"])

const packages = new Set(["@ai-sdk/openai-compatible", "@opencode/ai/providers/openai-compatible"])

// These providers have dedicated discovery plugins that own their whole model list.
const dedicated = new Set(["ollama", "lmstudio", "vllm"])

type Target = ReturnType<typeof targets>[number]

export function make(interval: Duration.Input = "5 minutes") {
  return define({
    id: "opencode.provider.openai-compatible",
    effect: Effect.fn(function* (ctx) {
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const bus = yield* Bus.Service
      const config = yield* Config.Service
      const loading = Semaphore.makeUnsafe(1)
      const loaded = {
        inventory: new Map<
          Provider.ID,
          { source: string; models: readonly { id: string; capabilities: Model.Capabilities }[] }
        >(),
        hash: "[]",
      }

      yield* ctx.provider.transform((providers) => {
        for (const [providerID, item] of loaded.inventory) {
          const provider = providers.get(providerID)
          if (!provider) continue
          for (const model of item.models) {
            // Configured models keep their own capabilities.
            if (provider.models.has(Model.ID.make(model.id))) continue
            providers.models.update(providerID, model.id, (draft) => {
              draft.capabilities = {
                tools: model.capabilities.tools,
                input: [...model.capabilities.input],
                output: [...model.capabilities.output],
              }
            })
          }
        }
      })

      const inventory = Effect.fnUntraced(function* (target: Target) {
        const connection = yield* ctx.integration.connection.active(target.providerID)
        const credential = connection
          ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
        // Same precedence as requests: a stored key replaces the configured one.
        const apiKey = credential?.type === "key" ? credential.key : target.apiKey
        const source = JSON.stringify([target.baseURL, apiKey, target.headers])
        const previous = loaded.inventory.get(target.providerID)
        const request = HttpClientRequest.get(`${target.baseURL}/models`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.setHeaders(target.headers ?? {}),
        )
        const models = yield* http.execute(apiKey ? request.pipe(HttpClientRequest.bearerToken(apiKey)) : request).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Models)),
          Effect.timeout("5 seconds"),
          Effect.map((response) =>
            response.data
              .filter((model) => model.id.length > 0 && (!model.mode || chat.has(model.mode)))
              .map((model) => ({ id: model.id, capabilities: capabilities(model) }))
              .toSorted((a, b) => a.id.localeCompare(b.id)),
          ),
          // Log the message only: the request in the cause carries configured headers, which may hold secrets.
          Effect.tapError((error) =>
            Effect.logDebug("openai-compatible model discovery failed", {
              providerID: target.providerID,
              message: error.message,
            }),
          ),
          // Keep the last successful inventory through transient outages while the endpoint and key are unchanged.
          Effect.orElseSucceed(() => (previous?.source === source ? previous.models : undefined)),
        )
        return models === undefined ? [] : [[target.providerID, { source, models }] as const]
      })

      const load = Effect.fn("OpenAICompatiblePlugin.load")(function* () {
        const results = yield* Effect.forEach(targets(yield* config.entries()), inventory, { concurrency: 4 })
        const next = new Map(results.flat())
        const hash = JSON.stringify([...next])
        if (hash === loaded.hash) return
        loaded.inventory = next
        loaded.hash = hash
        yield* ctx.provider.reload()
      })
      const refresh = () => loading.withPermit(load())

      yield* ctx.event.subscribe().pipe(
        Stream.filter((event) => event.type === "config.updated"),
        Stream.runForEach(refresh),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.runForEach(refresh),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* refresh().pipe(Effect.ignore, Effect.repeat(Schedule.spaced(interval)), Effect.forkScoped)
    }),
  } satisfies PluginInternal.InternalPlugin)
}

export const OpenAICompatiblePlugin = make()

function targets(entries: readonly Entry[]) {
  const documents = entries.filter((entry): entry is Document => entry.type === "document")
  const ids = new Set(documents.flatMap((file) => Object.keys(file.info.providers ?? {})))
  return [...ids].flatMap((id) => {
    if (dedicated.has(id)) return []
    const configured = documents.flatMap((file) => file.info.providers?.[id] ?? [])
    const pkg = configured.findLast((item) => item.package !== undefined)?.package
    // Migrated V1 configs store the package as `aisdk:@ai-sdk/openai-compatible`.
    if (pkg === undefined || !packages.has(Provider.packageName(pkg))) return []
    const settings = foldSettings(entries, id, undefined)
    const baseURL = typeof settings?.baseURL === "string" ? settings.baseURL.replace(/\/+$/, "") : ""
    if (!URL.canParse(baseURL) || !["http:", "https:"].includes(new URL(baseURL).protocol)) return []
    return [
      {
        providerID: Provider.ID.make(id),
        baseURL,
        apiKey: typeof settings?.apiKey === "string" && settings.apiKey !== "" ? settings.apiKey : undefined,
        headers: configured.reduce(
          (headers: Record<string, string> | undefined, item) => Provider.mergeHeaders(headers, item.headers),
          undefined,
        ),
      },
    ]
  })
}

// Without metadata, assume text-only input: an image sent to a text-only model fails every later request in the
// session, while a missing image capability only blocks attachments.
function capabilities(model: typeof RemoteModel.Type): Model.Capabilities {
  const input = model.input_modalities ?? model.architecture?.input_modalities ?? ["text"]
  return {
    tools: model.supported_parameters?.includes("tools") ?? true,
    // OpenRouter calls PDF input `file`.
    input: input.map((modality) => (modality === "file" ? "pdf" : modality)),
    output: model.output_modalities ?? model.architecture?.output_modalities ?? ["text"],
  }
}
