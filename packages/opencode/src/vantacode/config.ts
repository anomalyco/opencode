/**
 * VantaCode provider / config resolution.
 *
 * One place to describe every LLM provider (API-key providers and local
 * Ollama). Keys are NEVER hardcoded — they are read from environment variables
 * (supporting comma-separated multi-key lists) and merged with an optional
 * config file. The result feeds the agent loop and the failover machinery.
 */

import { DEFAULT_OLLAMA_HOST } from "./ollama.ts"

export type ProviderKind = "openai-compatible" | "anthropic" | "ollama"

export type PermissionMode = "plan" | "auto-edit" | "yolo"

export interface VantaProviderConfig {
  /** Stable id used on the CLI, e.g. "openai", "ollama", "groq". */
  readonly id: string
  readonly kind: ProviderKind
  /** Base URL for the provider API. */
  readonly baseURL: string
  /** Default model when the user does not pass one. */
  readonly defaultModel?: string
  /** Env var name(s) that hold the API key(s). Comma-separated values = multi-key. */
  readonly apiKeyEnv?: string
  /** Resolved keys (filled in by resolveProviders). */
  readonly apiKeys?: string[]
  /** Whether this provider needs an API key at all (ollama does not). */
  readonly requiresKey: boolean
}

export interface VantaConfig {
  /** Default provider id when none is given on the CLI. */
  defaultProvider: string
  /** Default model (provider-specific) when none is given. */
  defaultModel?: string
  permissionMode: PermissionMode
  /** Ordered provider list — also the failover order. */
  providers: VantaProviderConfig[]
  /** Enable verbose raw tool-call logging (OLLAMA_DEBUG equivalent). */
  debug: boolean
}

/**
 * Built-in presets. baseURL / apiKeyEnv / defaultModel only — never secrets.
 * OpenAI-compatible covers most hosted providers via one code path.
 */
export const PROVIDER_PRESETS: Record<string, Omit<VantaProviderConfig, "apiKeys">> = {
  openai: {
    id: "openai",
    kind: "openai-compatible",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    apiKeyEnv: "OPENAI_API_KEY",
    requiresKey: true,
  },
  anthropic: {
    id: "anthropic",
    kind: "anthropic",
    baseURL: "https://api.anthropic.com",
    defaultModel: "claude-3-5-sonnet-latest",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    requiresKey: true,
  },
  groq: {
    id: "groq",
    kind: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
    requiresKey: true,
  },
  deepseek: {
    id: "deepseek",
    kind: "openai-compatible",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    requiresKey: true,
  },
  openrouter: {
    id: "openrouter",
    kind: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-3.5-sonnet",
    apiKeyEnv: "OPENROUTER_API_KEY",
    requiresKey: true,
  },
  together: {
    id: "together",
    kind: "openai-compatible",
    baseURL: "https://api.together.xyz/v1",
    defaultModel: "Qwen/Qwen2.5-Coder-32B-Instruct",
    apiKeyEnv: "TOGETHER_API_KEY",
    requiresKey: true,
  },
  mistral: {
    id: "mistral",
    kind: "openai-compatible",
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    apiKeyEnv: "MISTRAL_API_KEY",
    requiresKey: true,
  },
  ollama: {
    id: "ollama",
    kind: "ollama",
    baseURL: DEFAULT_OLLAMA_HOST,
    defaultModel: "qwen2.5-coder:7b",
    requiresKey: false,
  },
}

export const DEFAULT_CONFIG: VantaConfig = {
  defaultProvider: "ollama",
  permissionMode: "auto-edit",
  providers: [],
  debug: false,
}

/**
 * Resolve API keys for a preset from the environment. Supports:
 *   OPENAI_API_KEY="sk-a"                → ["sk-a"]
 *   OPENAI_API_KEY="sk-a,sk-b,sk-c"      → ["sk-a","sk-b","sk-c"]  (multi-key)
 *   OPENAI_API_KEYS="sk-a,sk-b"          → merged, plural takes priority order
 */
export function resolveKeys(apiKeyEnv: string | undefined, env: NodeJS.ProcessEnv): string[] {
  if (!apiKeyEnv) return []
  const names = [apiKeyEnv, `${apiKeyEnv}S`, `${apiKeyEnv}_LIST`]
  const keys: string[] = []
  for (const name of names) {
    const raw = env[name]
    if (!raw) continue
    for (const part of raw.split(",")) {
      const trimmed = part.trim()
      if (trimmed && !keys.includes(trimmed)) keys.push(trimmed)
    }
  }
  return keys
}

export interface MergeInput {
  /** Partial config from a config file (already parsed). */
  readonly file?: Partial<VantaConfig> & { providers?: Partial<VantaProviderConfig>[] }
  readonly env: NodeJS.ProcessEnv
}

/**
 * Produce a fully-resolved VantaConfig from presets + file overrides + env.
 * Only providers that are either keyless (ollama) or have at least one key are
 * considered "available"; the rest are still listed but marked keyless.
 */
export function resolveProviders(input: MergeInput): VantaProviderConfig[] {
  const { file, env } = input
  const chosen: Partial<VantaProviderConfig>[] =
    file?.providers && file.providers.length > 0
      ? file.providers
      : Object.values(PROVIDER_PRESETS).map((p) => ({ id: p.id }))

  const resolved: VantaProviderConfig[] = []
  for (const entry of chosen) {
    const preset = entry.id ? PROVIDER_PRESETS[entry.id] : undefined
    const base = preset ?? {
      id: entry.id ?? "custom",
      kind: entry.kind ?? "openai-compatible",
      baseURL: entry.baseURL ?? "",
      requiresKey: entry.requiresKey ?? true,
    }
    const merged: Omit<VantaProviderConfig, "apiKeys"> = {
      id: base.id,
      kind: entry.kind ?? base.kind,
      baseURL: entry.baseURL ?? base.baseURL,
      defaultModel: entry.defaultModel ?? base.defaultModel,
      apiKeyEnv: entry.apiKeyEnv ?? base.apiKeyEnv,
      requiresKey: entry.requiresKey ?? base.requiresKey,
    }
    const apiKeys = resolveKeys(merged.apiKeyEnv, env)
    resolved.push({ ...merged, apiKeys })
  }
  return resolved
}

export function mergeConfig(input: MergeInput): VantaConfig {
  const { file, env } = input
  const providers = resolveProviders(input)
  const debug = env.VANTACODE_DEBUG === "1" || env.OLLAMA_DEBUG === "1" || file?.debug === true
  const permissionMode: PermissionMode =
    (env.VANTACODE_PERMISSION as PermissionMode) ?? file?.permissionMode ?? DEFAULT_CONFIG.permissionMode
  const defaultProvider = env.VANTACODE_PROVIDER ?? file?.defaultProvider ?? DEFAULT_CONFIG.defaultProvider
  const defaultModel = env.VANTACODE_MODEL ?? file?.defaultModel
  return { defaultProvider, defaultModel, permissionMode, providers, debug }
}

/** Find a provider by id, returning the first available one as fallback. */
export function selectProvider(config: VantaConfig, id?: string): VantaProviderConfig | undefined {
  if (id) {
    const exact = config.providers.find((p) => p.id === id)
    if (exact) return exact
  }
  const preferred = config.providers.find((p) => p.id === config.defaultProvider)
  if (preferred) return preferred
  return config.providers.find((p) => !p.requiresKey || (p.apiKeys && p.apiKeys.length > 0))
}
