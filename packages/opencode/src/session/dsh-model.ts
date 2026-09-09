import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { ConfigBackendV1 } from "@opencode-ai/core/v1/config/backend"
import type { Provider } from "@/provider/provider"

const providerID = ProviderV2.ID.make("dsh")

/**
 * Resolve the model entries shown by the DSH-backed model selector.
 *
 * @param backend - Validated DSH backend configuration.
 * @returns Configured routes, or the compatibility profile when no catalog is configured.
 */
export function entries(backend: ConfigBackendV1.DSH): readonly ConfigBackendV1.Model[] {
  if (!backend.models?.length) return [{ key: "profile", name: "DSH profile" }]
  const seen = new Set<string>()
  for (const item of backend.models) {
    if (seen.has(item.key)) throw new Error(`DSH backend model key is duplicated: ${item.key}`)
    seen.add(item.key)
  }
  if (backend.default_model !== undefined && !seen.has(backend.default_model)) {
    throw new Error(`DSH backend default_model is not listed in models: ${backend.default_model}`)
  }
  return backend.models
}

/**
 * Resolve the default model key for a DSH backend.
 *
 * @param backend - Validated DSH backend configuration.
 * @returns The configured default or the first available route.
 */
export function defaultModel(backend: ConfigBackendV1.DSH): string {
  return backend.default_model ?? entries(backend)[0].key
}

/**
 * Build display metadata for the existing OpenCode model selector.
 *
 * @param backend - Validated DSH backend configuration.
 * @returns A display-only provider; no OpenCode language-model provider is registered.
 */
export function provider(backend: ConfigBackendV1.DSH): Provider.Info {
  return {
    id: providerID,
    name: "DeepSeek Harness",
    source: "config",
    env: [],
    options: {},
    models: Object.fromEntries(entries(backend).map((item) => [item.key, model(item)])),
  }
}

function model(item: ConfigBackendV1.Model): Provider.Model {
  const id = ModelV2.ID.make(item.key)
  return {
    id,
    providerID,
    name: item.name ?? item.key,
    api: { id: item.key, url: "", npm: "" },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: false,
      toolcall: true,
      interleaved: false,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    },
    // ACP does not report provider pricing or exact model limits to this adapter.
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 0, output: 0 },
  }
}

export * as DSHModel from "./dsh-model"
