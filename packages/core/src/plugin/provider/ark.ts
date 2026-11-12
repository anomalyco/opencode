/**
 * Generic OpenAI-compatible provider discovery plugin.
 *
 * Providers whose model list is not statically known — or whose accessible
 * models depend on the API key — are discovered at runtime by calling their
 * OpenAI-compatible `GET /models` endpoint. The catalog (models.dev) supplies
 * metadata templates (family, cost, capabilities, compatibility) and this
 * plugin merges the live model IDs with those templates.
 *
 * Each provider entry declares:
 *   - `baseURL`: the API root for `GET /models`
 *   - `env`: environment variable names checked as fallback when no credential
 *     is stored in the integration
 *
 * The plugin runs one `ProviderRefresh` cycle per provider, sharing results
 * across locations via `SharedCache`. A provider with no API key is skipped.
 */

import { Effect } from "effect"
import { HttpClient } from "effect/http"
import { define } from "@opencode/plugin/effect/plugin"
import { IntegrationConnection } from "../../integration/connection.js"
import { OpenAICompatibleModels } from "../../ark/models.js"
import { Provider } from "../../provider.js"
import { SharedCache } from "../../shared-cache.js"
import type { PluginInternal } from "../internal.js"
import { activeCredential } from "./credential-settings.js"
import { ProviderRefresh } from "./refresh.js"

/** A provider whose model list can be discovered via `GET <baseURL>/models`. */
type ProviderEntry = {
  readonly id: string
  readonly baseURL: string
  readonly env: readonly string[]
}

/**
 * Providers covered by this plugin. Adding a provider here is the only change
 * needed to extend discovery to a new OpenAI-compatible endpoint.
 *
 * Every provider here exposes a standard `GET <baseURL>/models` endpoint that
 * returns `{ data: [{ id: "model-id" }] }` and accepts `Authorization: Bearer
 * <key>`. The base URL defaults to the provider's documented API root; if the
 * user configures a custom `baseURL` in provider settings, that value is used
 * instead.
 */
const PROVIDERS: readonly ProviderEntry[] = [
  // Volcengine Ark API (mainland + overseas)
  {
    id: "volcengine",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    env: ["ARK_API_KEY", "VOLCENGINE_API_KEY"],
  },
  {
    id: "volcengine-coding-plan",
    baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
    env: ["ARK_CODING_PLAN_API_KEY"],
  },
  {
    id: "byteplus",
    baseURL: "https://ark.ap-southeast.bytepluses.com/api/v3",
    env: ["BYTEPLUS_API_KEY"],
  },
  // MiniMax
  {
    id: "minimax",
    baseURL: "https://api.minimax.io/v1",
    env: ["MINIMAX_API_KEY"],
  },
  {
    id: "minimax-cn",
    baseURL: "https://api.minimax.cn/v1",
    env: ["MINIMAX_API_KEY"],
  },
  {
    id: "minimax-coding-plan",
    baseURL: "https://api.minimax.io/v1",
    env: ["MINIMAX_API_KEY"],
  },
  {
    id: "minimax-cn-coding-plan",
    baseURL: "https://api.minimax.cn/v1",
    env: ["MINIMAX_API_KEY"],
  },
  // DeepSeek
  {
    id: "deepseek",
    baseURL: "https://api.deepseek.com",
    env: ["DEEPSEEK_API_KEY"],
  },
  // Groq
  {
    id: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    env: ["GROQ_API_KEY"],
  },
  // Fireworks AI
  {
    id: "fireworks-ai",
    baseURL: "https://api.fireworks.ai/inference/v1",
    env: ["FIREWORKS_API_KEY"],
  },
  // SiliconFlow
  {
    id: "siliconflow",
    baseURL: "https://api.siliconflow.com/v1",
    env: ["SILICONFLOW_API_KEY"],
  },
  {
    id: "siliconflow-cn",
    baseURL: "https://api.siliconflow.cn/v1",
    env: ["SILICONFLOW_CN_API_KEY"],
  },
  // Moonshot / Kimi
  {
    id: "moonshotai",
    baseURL: "https://api.moonshot.ai/v1",
    env: ["MOONSHOT_API_KEY"],
  },
  {
    id: "moonshotai-cn",
    baseURL: "https://api.moonshot.cn/v1",
    env: ["MOONSHOT_API_KEY"],
  },
  // Zhipu AI / GLM
  {
    id: "zhipuai",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    env: ["ZHIPU_API_KEY"],
  },
  {
    id: "zhipuai-coding-plan",
    baseURL: "https://open.bigmodel.cn/api/coding/paas/v4",
    env: ["ZHIPU_API_KEY"],
  },
  // Novita AI
  {
    id: "novita-ai",
    baseURL: "https://api.novita.ai/openai/v1",
    env: ["NOVITA_API_KEY"],
  },
  // Perplexity
  {
    id: "perplexity",
    baseURL: "https://api.perplexity.ai",
    env: ["PERPLEXITY_API_KEY"],
  },
  // Mistral
  {
    id: "mistral",
    baseURL: "https://api.mistral.ai/v1",
    env: ["MISTRAL_API_KEY"],
  },
  // NVIDIA NIM
  {
    id: "nvidia",
    baseURL: "https://integrate.api.nvidia.com/v1",
    env: ["NVIDIA_API_KEY"],
  },
  // Cerebras
  {
    id: "cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    env: ["CEREBRAS_API_KEY"],
  },
]

export const ArkPlugin = define({
  id: "opencode.provider.ark",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const cache = yield* SharedCache.Service
    const http = yield* HttpClient.HttpClient

    // One refresh state per provider entry. ProviderRefresh.start returns a
    // mutable state object whose `current` field is updated on every load;
    // the transform reads it live so it always sees the latest models.
    const states = new Map<
      string,
      { readonly current: { readonly baseURL?: string; readonly models?: OpenAICompatibleModels.Snapshot; readonly connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>> } }
    >()

    for (const entry of PROVIDERS) {
      const providerID = Provider.ID.make(entry.id)

      const discovered = yield* ProviderRefresh.start({
        integrationID: entry.id,
        initial: {} as {
          readonly baseURL?: string
          readonly models?: OpenAICompatibleModels.Snapshot
          readonly connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
        },
        active: ctx.integration.connection.active(entry.id),
        reload: ctx.provider.reload(),
        load: Effect.fn("ArkPlugin.load")(function* (_, options) {
          const { connection, credential } = yield* activeCredential(ctx, entry.id)
          const apiKey = credential?.type === "key" ? credential.key : envKey(entry.env)
          const provider = yield* providers.get(providerID)
          const baseURL =
            typeof provider?.settings?.baseURL === "string" ? provider.settings.baseURL : entry.baseURL
          if (!apiKey) return { connection, value: {} }
          const models = yield* cache
            .get({
              key: modelsKey(connection, apiKey, baseURL),
              ...options,
              load: (connection
                ? ctx.integration.connection.resolve(connection)
                : Effect.undefined
              ).pipe(
                Effect.map(
                  (current) =>
                    current?.type === "key"
                      ? current.key
                      : connection
                        ? undefined
                        : envKey(entry.env),
                ),
                Effect.flatMap((key) =>
                  key
                    ? OpenAICompatibleModels.load(http, baseURL, key)
                    : Effect.fail(new Error(`${entry.id} connection has no API key`)),
                ),
                Effect.map((models) => models.toSorted((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))),
              ),
            })
            .pipe(Effect.orElseSucceed(() => undefined))
          return { connection, value: { baseURL, models, connection } }
        }),
      })

      states.set(entry.id, discovered)
    }

    // Transform: merge discovered models with catalog templates for each provider.
    yield* ctx.provider.transform((evt) => {
      for (const entry of PROVIDERS) {
        const providerID = Provider.ID.make(entry.id)
        const item = evt.get(providerID)
        const loaded = states.get(entry.id)?.current
        if (!item || !loaded?.models || !loaded.baseURL) continue
        evt.add({
          info: item.provider,
          models: Array.from(
            OpenAICompatibleModels.derive(
              providerID,
              loaded.baseURL,
              loaded.models,
              Array.from(item.models.values()),
            ).values(),
          ),
          sourceConnection: loaded.connection,
        })
      }
    })
  }),
} satisfies PluginInternal.InternalPlugin)

function envKey(env: readonly string[]): string | undefined {
  for (const name of env) {
    const value = process.env[name]
    if (value) return value
  }
  return undefined
}

function modelsKey(
  connection: Parameters<typeof IntegrationConnection.key>[0],
  apiKey: string,
  baseURL: string,
) {
  const access = IntegrationConnection.key(connection) ?? "env"
  return `ark:${access}:${SharedCache.fingerprint(apiKey)}:${baseURL.replace(/\/+$/, "")}`
}
