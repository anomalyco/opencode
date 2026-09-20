import type { Model as CatalogModel, Provider as CatalogProvider } from "@opencode-ai/core/models-dev"
import type { Model as ProviderModel } from "@/provider/provider"

export const AUTOSELECT_MODEL_ID = "jev-openai-autoselect"
export const AUTOSELECT_METADATA_KEY = "jevOpenAIAutoselect"

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
const OPENROUTER_JEV_MODEL = "~typesafe/jev-latest"
const OPENROUTER_TIMEOUT_MS = 10_000
const FALLBACK_MODEL_ID = "gpt-5.6-luna"

export type AutoSelectSource = "jev" | "fallback"

export type AutoSelectDiagnostic = {
  reason: "missing-api-key" | "http-error" | "invalid-response" | "request-error"
  status?: number
  code?: string
  error?: string
  message?: string
}

export type AutoSelectMetadata = {
  type: "jev-openai-autoselect"
  requested: {
    providerID: string
    modelID: string
  }
  source: AutoSelectSource
  confidence?: number
  selectorModel?: string
}

export type AutoSelectCache = {
  providerID: "openai"
  modelID: string
  variant: string
  source: AutoSelectSource
  confidence?: number
  selectorModel?: string
}

type Candidate = {
  key: string
  modelID: string
  variant: string
  model: ProviderModel
  catalog?: CatalogModel
}

type SelectionContext = {
  models: Readonly<Record<string, ProviderModel>>
  catalog?: CatalogProvider
  prompt: string
  attachments: Array<{ filename?: string; mime: string }>
  agent: string
  metadata?: Readonly<Record<string, unknown>>
}

type AutoSelectModel = {
  id: string
  name: string
  api: { id: string }
  variants?: Record<string, Record<string, unknown>>
}

export function addAutoSelectModel<T extends AutoSelectModel>(models: Readonly<Record<string, T>>): Record<string, T> {
  const base = Object.values(models)[0]
  if (!base) return models

  const autoSelect = {
    ...base,
    id: AUTOSELECT_MODEL_ID,
    name: "Jev OpenAI Auto",
    api: { ...base.api, id: AUTOSELECT_MODEL_ID },
    variants: {},
  } as T

  return {
    ...models,
    [AUTOSELECT_MODEL_ID]: autoSelect,
  }
}

export async function resolve(input: SelectionContext): Promise<{
  model: { providerID: "openai"; modelID: string; variant: string }
  metadata: AutoSelectMetadata
  cache: AutoSelectCache
  diagnostic?: AutoSelectDiagnostic
}> {
  const candidates = buildCandidates(input.models, input.catalog)
  const cached = readCache(input.metadata?.[AUTOSELECT_METADATA_KEY])
  if (cached) {
    const candidate = candidates.find((item) => item.modelID === cached.modelID && item.variant === cached.variant)
    if (candidate) return result(candidate, cached.source, cached.confidence, cached.selectorModel)
  }

  const fallback = chooseFallback(candidates)
  if (!fallback) throw new Error("No OpenAI model is available for auto-selection")
  if (!process.env.OPENROUTER_API_KEY) {
    return result(fallback, "fallback", undefined, undefined, { reason: "missing-api-key" })
  }

  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://opencode.ai",
        "X-OpenRouter-Title": "OpenCode Jev OpenAI Auto",
      },
      signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
      body: JSON.stringify({
        model: OPENROUTER_JEV_MODEL,
        questions: {
          route: {
            type: "choice",
            instructions: [
              "Choose exactly one candidate key.",
              "Choose the smallest model and reasoning effort that can complete the task reliably; promote aggressively for difficult coding, debugging, architecture, or long dependency chains.",
              "Reasoning effort guidance: none is trivial lookup or formatting; low is a clear bounded question or small edit; medium is ordinary multi-file coding and tool use; high is ambiguous debugging, architecture, or long dependency chains; xhigh is the hardest high-risk or long-running agentic work.",
            ].join(" "),
            criteria: Object.fromEntries(
              candidates.map((candidate) => [candidate.key, JSON.stringify(describeCandidate(candidate))]),
            ),
          },
        },
        state: {
          prompt: input.prompt.slice(0, 32_000),
          attachments: input.attachments,
          agent: input.agent,
          priority: "quality-and-speed",
          billing: "openrouter",
          effortGuidance: {
            none: "Trivial lookup, formatting, or transformation.",
            low: "Clear, bounded question or small edit.",
            medium: "Normal multi-file coding and tool use.",
            high: "Ambiguous debugging, architecture, or long dependency chains.",
            xhigh: "The hardest high-risk or long-running agentic work.",
          },
          candidates: candidates.map((candidate) => ({
            key: candidate.key,
            ...describeCandidate(candidate),
          })),
        },
      }),
    })
    if (!response.ok) {
      const error = await readOpenRouterError(response)
      return result(fallback, "fallback", undefined, undefined, {
        reason: "http-error",
        status: response.status,
        ...error,
      })
    }

    const payload = (await response.json()) as {
      answers?: { route?: { choice?: unknown; confidence?: unknown } }
      model?: unknown
    }
    const answer = payload.answers?.route
    const key = typeof answer?.choice === "string" ? answer.choice : undefined
    const selected = key ? candidates.find((candidate) => candidate.key === key) : undefined
    if (!selected) return result(fallback, "fallback", undefined, undefined, { reason: "invalid-response" })
    const selectorModel = typeof payload.model === "string" ? payload.model : OPENROUTER_JEV_MODEL
    const confidence =
      typeof answer?.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : undefined
    return result(selected, "jev", confidence, selectorModel)
  } catch (error) {
    return result(fallback, "fallback", undefined, undefined, {
      reason: "request-error",
      ...(error instanceof Error
        ? { error: error.name, message: error.message.slice(0, 200) }
        : { error: "UnknownError" }),
    })
  }
}

function buildCandidates(
  models: Readonly<Record<string, ProviderModel>>,
  catalog: CatalogProvider | undefined,
): Candidate[] {
  return Object.values(models)
    .filter((model) => model.id !== AUTOSELECT_MODEL_ID)
    .filter((model) => model.providerID === "openai")
    .filter((model) => isAutoSelectableModel(model.api.id))
    .filter((model) => !model.id.endsWith("-fast"))
    .flatMap((model) => {
      const variants = Object.keys(model.variants ?? {})
      return (variants.length > 0 ? variants : ["default"]).map((variant) => ({
        key: `${model.id}:${variant}`,
        modelID: model.id,
        variant,
        model,
        catalog: catalog?.models[model.api.id],
      }))
    })
}

function isAutoSelectableModel(modelID: string) {
  return modelID === "gpt-6-astra" || /^gpt-5\.6(?:-|$)/.test(modelID)
}

function chooseFallback(candidates: Candidate[]) {
  const preferred = candidates.find(
    (candidate) => candidate.modelID === FALLBACK_MODEL_ID && candidate.variant === "medium",
  )
  if (preferred) return preferred

  const preferredVariant = candidates.find((candidate) => candidate.modelID === FALLBACK_MODEL_ID)
  if (preferredVariant) return preferredVariant

  const sorted = [...candidates].sort(compareCandidates)
  const medium = sorted.filter((candidate) => candidate.variant === "medium")
  const general = medium.filter((candidate) => !/(mini|nano|spark|codex)/i.test(candidate.modelID))
  return general[0] ?? medium[0] ?? sorted[0]
}

function compareCandidates(a: Candidate, b: Candidate) {
  const date = (b.catalog?.release_date ?? b.model.release_date).localeCompare(
    a.catalog?.release_date ?? a.model.release_date,
  )
  if (date !== 0) return date
  const model = a.modelID.localeCompare(b.modelID)
  return model !== 0 ? model : a.variant.localeCompare(b.variant)
}

function describeCandidate(candidate: Candidate) {
  const catalog = candidate.catalog
  const model = candidate.model
  return {
    model: model.name,
    modelID: model.api.id,
    family: model.family,
    description: catalog?.description,
    knowledge: catalog?.knowledge,
    releaseDate: catalog?.release_date ?? model.release_date,
    reasoningEffort: candidate.variant,
    contextLimit: catalog?.limit.context ?? model.limit.context,
    outputLimit: catalog?.limit.output ?? model.limit.output,
    capabilities: model.capabilities,
    modalities: catalog?.modalities,
    toolCall: model.capabilities.toolcall,
    referenceApiCost: catalog?.cost,
  }
}

async function readOpenRouterError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: { code?: unknown; message?: unknown }
    }
    return {
      ...(typeof payload.error?.code === "string" || typeof payload.error?.code === "number"
        ? { code: String(payload.error.code) }
        : {}),
      ...(typeof payload.error?.message === "string"
        ? { message: payload.error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 200) }
        : {}),
    }
  } catch {
    return {}
  }
}

function readCache(value: unknown): AutoSelectCache | undefined {
  if (!value || typeof value !== "object") return
  const item = value as Record<string, unknown>
  if (item.providerID !== "openai") return
  if (typeof item.modelID !== "string" || typeof item.variant !== "string") return
  if (item.source !== "jev" && item.source !== "fallback") return
  return {
    providerID: "openai",
    modelID: item.modelID,
    variant: item.variant,
    source: item.source,
    ...(typeof item.confidence === "number" ? { confidence: item.confidence } : {}),
    ...(typeof item.selectorModel === "string" ? { selectorModel: item.selectorModel } : {}),
  }
}

function result(
  candidate: Candidate | undefined,
  source: AutoSelectSource,
  confidence?: number,
  selectorModel?: string,
  diagnostic?: AutoSelectDiagnostic,
) {
  if (!candidate) throw new Error("No OpenAI model is available for auto-selection")
  const cache: AutoSelectCache = {
    providerID: "openai",
    modelID: candidate.modelID,
    variant: candidate.variant,
    source,
    ...(confidence === undefined ? {} : { confidence }),
    ...(selectorModel === undefined ? {} : { selectorModel }),
  }
  return {
    model: {
      providerID: "openai" as const,
      modelID: candidate.modelID,
      variant: candidate.variant,
    },
    metadata: {
      type: "jev-openai-autoselect" as const,
      requested: { providerID: "openai", modelID: AUTOSELECT_MODEL_ID },
      source,
      ...(confidence === undefined ? {} : { confidence }),
      ...(selectorModel === undefined ? {} : { selectorModel }),
    },
    cache,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  }
}
