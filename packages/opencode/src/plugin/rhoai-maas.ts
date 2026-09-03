import { InstallationVersion } from "@opencode-ai/core/installation/version"
import type { Hooks } from "@opencode-ai/plugin"
import type { Model } from "@opencode-ai/sdk/v2"

// Red Hat OpenShift AI — Models-as-a-Service (MaaS).
//
// MaaS exposes a per-cluster, OpenAI-compatible `/v1` gateway (Kuadrant/Envoy in
// front of vLLM/KServe) secured with subscription-scoped API keys. Every RHOAI
// customer runs their own cluster, so the gateway base URL is not a constant we
// can bake into models.dev — it is captured per-login and stored in the auth
// metadata (`metadata.baseURL`). The models.dev catalog entry only needs to
// exist so this plugin's `provider.models` hook is allowed to run; the actual
// model list is discovered live from `<baseURL>/models`.

export const PROVIDER_ID = "rhoai-maas"

const DEFAULT_CONTEXT = 32768
const DEFAULT_OUTPUT = 8192
const DISCOVERY_TIMEOUT_MS = 10_000

interface OpenAIModellist {
  data?: Array<{ id?: unknown; name?: unknown }>
}

/** Normalize a user-entered gateway URL to an OpenAI-compatible base ending in `/v1`. */
export function normalizeBaseURL(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let value = raw.trim()
  if (!value) return undefined
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  value = value.replace(/\/+$/, "")
  if (!/\/v1$/i.test(value)) value = `${value}/v1`
  return value
}

function maasModel(id: string, name: string, baseURL: string): Model {
  return {
    id,
    providerID: PROVIDER_ID,
    name,
    family: "rhoai-maas",
    api: { id, url: baseURL, npm: "@ai-sdk/openai-compatible" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: DEFAULT_CONTEXT, output: DEFAULT_OUTPUT },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

async function discoverModels(
  baseURL: string,
  key: string,
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): Promise<Record<string, Model>> {
  const res = await request(`${baseURL}/models`, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "User-Agent": `opencode/${InstallationVersion}`,
    },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`MaaS model discovery failed (HTTP ${res.status})`)
  const body = (await res.json()) as OpenAIModellist
  const models: Record<string, Model> = {}
  for (const entry of body.data ?? []) {
    if (typeof entry?.id !== "string" || !entry.id) continue
    const name = typeof entry.name === "string" && entry.name ? entry.name : entry.id
    models[entry.id] = maasModel(entry.id, name, baseURL)
  }
  return models
}

export function createRhoaiMaasHooks(
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Hooks {
  return {
    provider: {
      id: PROVIDER_ID,
      async models(provider, ctx) {
        if (ctx.auth?.type !== "api") return provider.models
        const baseURL = normalizeBaseURL(ctx.auth.metadata?.baseURL)
        if (!baseURL) return provider.models
        return discoverModels(baseURL, ctx.auth.key, request).catch(() => provider.models)
      },
    },
    auth: {
      provider: PROVIDER_ID,
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "api") return {}
        const baseURL = normalizeBaseURL(auth.metadata?.baseURL)
        if (!baseURL) return {}
        return { baseURL, apiKey: auth.key }
      },
      methods: [
        {
          type: "api",
          label: "API key",
          prompts: [
            {
              type: "text",
              key: "baseURL",
              message: "Enter your MaaS gateway URL",
              placeholder: "e.g. https://maas.apps.<cluster>/v1",
              validate: (value) => (normalizeBaseURL(value) ? undefined : "A gateway URL is required"),
            },
          ],
        },
      ],
    },
  }
}

export async function RhoaiMaasAuthPlugin(): Promise<Hooks> {
  return createRhoaiMaasHooks()
}
