import type { ConfigProvider } from "@/config/provider"

const PROVIDER_ID = "featherless"

/**
 * Bundled config-shape provider definition for Featherless. Injected as a
 * synthetic entry into `cfg.provider` on init so the existing config-provider
 * construction path builds the full Info/Model shapes — and so Featherless
 * shows up in `/connect` and the model picker with zero user config.
 *
 * `tool_call` defaults to true since the seeded models all support tools
 * in practice — Featherless's `/v1/models` `features.tool_use` field is
 * incomplete (missing on some entries that do support tools), so it's not
 * authoritative. Users can override per-model in their own opencode.json.
 *
 * This will be retired once `sst/models.dev` carries Featherless.
 */
export const FEATHERLESS_SEED: ConfigProvider.Info = {
  name: "Featherless",
  npm: "@ai-sdk/openai-compatible",
  api: "https://api.featherless.ai/v1",
  env: ["FEATHERLESS_API_KEY"],
  options: {
    baseURL: "https://api.featherless.ai/v1",
  },
  models: {
    "moonshotai/Kimi-K2.5": { name: "Kimi K2.5", tool_call: true },
    "stepfun-ai/Step-3.5-Flash": { name: "Step 3.5 Flash", tool_call: true },
    "MiniMaxAI/MiniMax-M2.5": { name: "MiniMax M2.5", tool_call: true },
    "MiniMaxAI/MiniMax-M2.1": { name: "MiniMax M2.1", tool_call: true },
    "Qwen/Qwen3.5-397B-A17B": { name: "Qwen 3.5 397B A17B", tool_call: true },
    "zai-org/GLM-4.7-Flash": { name: "GLM 4.7 Flash", tool_call: true },
    "zai-org/GLM-4.7": { name: "GLM 4.7", tool_call: true },
    "zai-org/GLM-5": { name: "GLM 5", tool_call: true },
    "zai-org/GLM-5.1": { name: "GLM 5.1", tool_call: true },
    "deepseek-ai/DeepSeek-V4-Flash": { name: "DeepSeek V4 Flash", tool_call: true },
    "deepseek-ai/DeepSeek-V4-Pro": { name: "DeepSeek V4 Pro", tool_call: true },
  },
}

/**
 * Inject the bundled Featherless seed into a configProviders list, unless
 * the user has already supplied their own `featherless` entry. Mutates in
 * place — designed to be called from provider.ts state init.
 *
 * Single call site keeps the prepend logic colocated with the seed itself,
 * and makes the eventual removal (when sst/models.dev carries Featherless)
 * a one-line delete in provider.ts.
 */
export function registerFeatherlessSeed(configProviders: Array<[string, ConfigProvider.Info]>): void {
  if (configProviders.some(([id]) => id === PROVIDER_ID)) return
  configProviders.unshift([PROVIDER_ID, FEATHERLESS_SEED])
}
