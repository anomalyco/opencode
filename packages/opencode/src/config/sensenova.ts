export * as ConfigSensenova from "./sensenova"

import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { mergeDeep } from "remeda"

export const PROVIDER_ID = "sensenova"
export const API_URL = "https://token.sensenova.cn/v1"
export const API_KEY_ENV = "SENSENOVA_API_KEY"
export const MODEL_ENV = "OPENCODE_COMPACTION_MODEL"
export const DEEPSEEK_MODEL = "deepseek-v4-flash"
export const SENSENOVA_MODEL = "sensenova-6.8-flash-lite"

const models = {
  [DEEPSEEK_MODEL]: {
    id: DEEPSEEK_MODEL,
    name: "DeepSeek V4 Flash",
    reasoning: true,
    tool_call: true,
    interleaved: "reasoning_content" as const,
    limit: { context: 1_000_000, output: 65_536 },
    variants: {
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    },
  },
  [SENSENOVA_MODEL]: {
    id: SENSENOVA_MODEL,
    name: "SenseNova 6.8 Flash-Lite",
    reasoning: true,
    tool_call: true,
    interleaved: "reasoning" as const,
    limit: { context: 262_144, output: 32_768 },
    variants: {
      high: { reasoningEffort: "high" },
    },
  },
}

const provider = {
  name: "SenseNova",
  api: API_URL,
  npm: "@ai-sdk/openai-compatible",
  env: [API_KEY_ENV],
  models,
}

const compaction = (model: string) => ({
  model: `${PROVIDER_ID}/${model}`,
  variant: model === DEEPSEEK_MODEL ? "max" : "high",
  options: {
    reasoningEffort: model === DEEPSEEK_MODEL ? "max" : "high",
  },
})

function modelFromEnv(env: Record<string, string | undefined>) {
  const requestedModel = env[MODEL_ENV]?.trim().toLowerCase()
  return requestedModel === SENSENOVA_MODEL || requestedModel === `${PROVIDER_ID}/${SENSENOVA_MODEL}`
    ? SENSENOVA_MODEL
    : DEEPSEEK_MODEL
}

/**
 * The config written on first start contains only the environment-variable
 * name, never the secret itself. `env` is deliberately a list rather than an
 * `options.apiKey` value so the provider resolver can read the key at runtime
 * without serializing it back into a config file.
 */
export function defaultConfig(): ConfigV1.Info {
  // The compaction agent is selected at runtime so changing
  // OPENCODE_COMPACTION_MODEL does not require rewriting this file.
  return {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [PROVIDER_ID]: provider,
    },
  }
}

export function applyDefaults(config: ConfigV1.Info, env: Record<string, string | undefined>): ConfigV1.Info {
  const configuredProvider = config.provider?.[PROVIDER_ID]
  if (!env[API_KEY_ENV] && !configuredProvider) return config

  const configuredEnv = configuredProvider?.env?.some((name) => Boolean(env[name]))
  const configuredApiKey =
    typeof configuredProvider?.options?.apiKey === "string" && configuredProvider.options.apiKey.length > 0
  const hasCredentials = Boolean(env[API_KEY_ENV] || configuredEnv || configuredApiKey)

  const model = modelFromEnv(env)
  const defaults = {
    provider: {
      [PROVIDER_ID]: provider,
    },
    agent: {
      compaction: compaction(model),
    },
  } satisfies Pick<ConfigV1.Info, "provider" | "agent">

  const next = {
    ...config,
    provider: {
      ...config.provider,
      [PROVIDER_ID]: mergeDeep(provider, configuredProvider ?? {}),
    },
  }
  if (!hasCredentials || config.agent?.compaction) return next
  return {
    ...next,
    agent: {
      ...config.agent,
      compaction: defaults.agent.compaction,
    },
  }
}
