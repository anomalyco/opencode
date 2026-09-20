import { Model as ModelV2 } from "@opencode-ai/core/model"
import type { Model as CatalogModel, Provider as CatalogProvider } from "@opencode-ai/core/models-dev"
import type { Model as ProviderModel } from "@/provider/provider"

export const AUTOSELECT_MODEL_ID = "jev-openai-autoselect"
export const AUTOSELECT_METADATA_KEY = "jevOpenAIAutoselect"

const JEV_MODEL = "jev-latest"
const AUTOSELECT_TIMEOUT_MS = 10_000

export type AutoSelectSource = "jev" | "fallback"

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

type TypeSafeClient = {
  systemOne(input: {
    model: string
    state: Record<string, unknown>
    questions: Record<string, unknown>
  }): Promise<unknown>
}

type TypeSafeSDK = {
  TypeSafeClient: new (input: { timeout: number; logLevel: "off" }) => TypeSafeClient
  choice(instructions: string, criteria: Record<string, string>): unknown
}

export function addAutoSelectModel(models: Readonly<Record<string, ProviderModel>>) {
  const base = Object.values(models)[0]
  if (!base) return models

  return {
    ...models,
    [AUTOSELECT_MODEL_ID]: {
      ...base,
      id: ModelV2.ID.make(AUTOSELECT_MODEL_ID),
      name: "Jev OpenAI Auto",
      api: { ...base.api, id: AUTOSELECT_MODEL_ID },
      variants: {},
    },
  }
}

export async function resolve(input: SelectionContext): Promise<{
  model: { providerID: "openai"; modelID: string; variant: string }
  metadata: AutoSelectMetadata
  cache: AutoSelectCache
}> {
  const candidates = buildCandidates(input.models, input.catalog)
  const cached = readCache(input.metadata?.[AUTOSELECT_METADATA_KEY])
  if (cached) {
    const candidate = candidates.find(
      (item) => item.modelID === cached.modelID && item.variant === cached.variant,
    )
    if (candidate) return result(candidate, cached.source, cached.confidence, cached.selectorModel)
  }

  const fallback = chooseFallback(candidates)
  if (!fallback) throw new Error("No OpenAI model is available for auto-selection")
  if (!process.env.TYPESAFE_API_KEY) return result(fallback, "fallback")

  try {
    const sdk = await loadTypeSafeSDK()
    const criteria = Object.fromEntries(
      candidates.map((candidate) => [candidate.key, describeCandidate(candidate)]),
    )
    const client = new sdk.TypeSafeClient({ timeout: AUTOSELECT_TIMEOUT_MS, logLevel: "off" })
    const response = (await client.systemOne({
        model: JEV_MODEL,
        state: {
          task: input.prompt.slice(0, 32_000),
          attachments: input.attachments,
          agent: input.agent,
          priority: "quality-and-speed",
          effortGuidance: {
            none: "Trivial lookup, formatting, or transformation.",
            low: "Clear, bounded question or small edit.",
            medium: "Normal multi-file coding and tool use.",
            high: "Ambiguous debugging, architecture, or long dependency chains.",
            xhigh: "The hardest high-risk or long-running agentic work.",
          },
        },
        questions: {
          route: sdk.choice(
            "Choose the smallest OpenAI model and reasoning effort that can complete this task reliably. Promote aggressively for difficult coding, debugging, architecture, or long dependency chains.",
            criteria,
          ),
        },
      })) as {
      answers?: { route?: { choice?: unknown; confidence?: unknown } }
      model?: unknown
    }
    const answer = response.answers?.route
    const key = typeof answer?.choice === "string" ? answer.choice : undefined
    const selected = key ? candidates.find((candidate) => candidate.key === key) : undefined
    if (!selected) return result(fallback, "fallback")
    const confidence =
      typeof answer?.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : undefined
    const selectorModel = typeof response.model === "string" ? response.model : undefined
    return result(selected, "jev", confidence, selectorModel)
  } catch {
    return result(fallback, "fallback")
  }
}

function buildCandidates(
  models: Readonly<Record<string, ProviderModel>>,
  catalog: CatalogProvider | undefined,
): Candidate[] {
  return Object.values(models)
    .filter((model) => model.id !== AUTOSELECT_MODEL_ID)
    .filter((model) => model.providerID === "openai")
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

function chooseFallback(candidates: Candidate[]) {
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
  return a.modelID.localeCompare(b.modelID)
}

function describeCandidate(candidate: Candidate) {
  const catalog = candidate.catalog
  const model = candidate.model
  return JSON.stringify({
    model: model.name,
    modelID: model.api.id,
    family: model.family,
    description: catalog?.description,
    knowledge: catalog?.knowledge,
    reasoningEffort: candidate.variant,
    contextLimit: catalog?.limit.context ?? model.limit.context,
    outputLimit: catalog?.limit.output ?? model.limit.output,
    modalities: catalog?.modalities,
    toolCall: model.capabilities.toolcall,
    referenceApiCost: catalog?.cost,
  })
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

function result(candidate: Candidate | undefined, source: AutoSelectSource, confidence?: number, selectorModel?: string) {
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
  }
}

async function loadTypeSafeSDK() {
  const packageName = "@typesafe-ai/sdk"
  return (await import(packageName)) as unknown as TypeSafeSDK
}
