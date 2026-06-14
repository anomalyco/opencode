import { query } from "@solidjs/router"

export const modelCatalogSourceUrl = "https://models.dev/models.json"
export const modelCatalogPricingUrl = "https://models.dev/api.json"

export type ModelCatalogCost = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export type ModelCatalogEntry = {
  id: string
  lab: string
  slug: string
  name: string
  family?: string
  knowledge?: string
  releaseDate?: string
  lastUpdated?: string
  limit?: { context?: number; output?: number }
  modalities: { input: string[]; output: string[] }
  openWeights: boolean
  reasoning: boolean
  toolCall: boolean
  attachment: boolean
  temperature: boolean
  cost?: ModelCatalogCost
  weights: { label: string; url: string }[]
  benchmarks: ModelCatalogBenchmark[]
}

export type ModelCatalogBenchmark = {
  name: string
  score: number
  metric?: string
  harness?: string
  variant?: string
  dataset?: string
  version?: string
  source?: string
}

export type ModelCatalogLab = {
  id: string
  name: string
  models: ModelCatalogEntry[]
}

export type ModelCatalog = {
  models: ModelCatalogEntry[]
  labs: ModelCatalogLab[]
}

export const getModelCatalog = query(async () => {
  "use server"
  const [models, pricing] = await Promise.all([
    fetchCatalogPayload(modelCatalogSourceUrl),
    fetchCatalogPayload(modelCatalogPricingUrl),
  ])
  return buildModelCatalog(models, pricing)
}, "getModelCatalog")

export function findModelCatalogEntry(catalog: ModelCatalog, model: string, lab?: string) {
  const normalizedId = lab ? `${catalogSlug(lab)}/${catalogSlug(model)}` : model.trim().toLowerCase()
  const leaf = catalogSlug(model)
  return (
    catalog.models.find((entry) => entry.id.toLowerCase() === normalizedId) ??
    catalog.models.find((entry) => (lab ? entry.lab === catalogSlug(lab) : true) && entry.slug === leaf) ??
    catalog.models.find((entry) => entry.slug === leaf)
  )
}

export function findModelCatalogLab(catalog: ModelCatalog, lab: string) {
  const id = catalogSlug(lab)
  return catalog.labs.find((entry) => entry.id === id)
}

export function formatCatalogLabName(lab: string) {
  const known: Record<string, string> = {
    alibaba: "Alibaba",
    anthropic: "Anthropic",
    cohere: "Cohere",
    deepseek: "DeepSeek",
    google: "Google",
    meta: "Meta",
    minimax: "MiniMax",
    mistral: "Mistral",
    moonshotai: "Moonshot",
    openai: "OpenAI",
    perplexity: "Perplexity",
    stepfun: "StepFun",
    tencent: "Tencent",
    xai: "xAI",
    xiaomi: "Xiaomi",
    zai: "Z.ai",
    zhipuai: "Zhipu",
  }
  return known[catalogSlug(lab)] ?? lab.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function catalogSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
}

function buildModelCatalog(payload: unknown, pricingPayload?: unknown): ModelCatalog {
  const costs = readCatalogCosts(pricingPayload)
  const models = (Array.isArray(payload) ? payload : isRecord(payload) ? Object.values(payload) : [])
    .flatMap(readModelCatalogEntry)
    .map((model) => ({
      ...model,
      cost:
        costs.get(catalogIdKey(model.id)) ??
        costs.get(`${model.lab}/${model.slug}`) ??
        costs.get(model.slug) ??
        model.cost,
    }))
    .toSorted((a, b) => a.lab.localeCompare(b.lab) || displayDateTime(b.releaseDate) - displayDateTime(a.releaseDate))
  return {
    models,
    labs: Object.values(
      models.reduce<Record<string, ModelCatalogLab>>((result, model) => {
        result[model.lab] = {
          id: model.lab,
          name: formatCatalogLabName(model.lab),
          models: [...(result[model.lab]?.models ?? []), model],
        }
        return result
      }, {}),
    ).toSorted((a, b) => a.name.localeCompare(b.name)),
  }
}

function readModelCatalogEntry(value: unknown): ModelCatalogEntry[] {
  if (!isRecord(value)) return []
  const id = stringValue(value.id)
  const name = stringValue(value.name)
  const lab = id?.split("/")[0]
  const slug = id?.split("/").slice(1).join("/")
  if (!id || !name || !lab || !slug) return []
  return [
    {
      id,
      lab: catalogSlug(lab),
      slug: catalogSlug(slug),
      name,
      family: stringValue(value.family),
      knowledge: stringValue(value.knowledge),
      releaseDate: stringValue(value.release_date),
      lastUpdated: stringValue(value.last_updated),
      limit: readCatalogLimit(value.limit),
      modalities: readCatalogModalities(value.modalities),
      openWeights: booleanValue(value.open_weights),
      reasoning: booleanValue(value.reasoning),
      toolCall: booleanValue(value.tool_call),
      attachment: booleanValue(value.attachment),
      temperature: booleanValue(value.temperature),
      cost: readCatalogCost(value.cost),
      weights: readCatalogWeights(value.weights),
      benchmarks: readCatalogBenchmarks(value.benchmarks),
    },
  ]
}

async function fetchCatalogPayload(url: string) {
  return fetch(url)
    .then((response): Promise<unknown> => (response.ok ? (response.json() as Promise<unknown>) : Promise.resolve()))
    .catch(() => undefined)
}

function readCatalogCosts(payload: unknown) {
  const costs = new Map<string, ModelCatalogCost>()
  const add = (model: unknown, provider?: string) => {
    if (!isRecord(model)) return
    const id = stringValue(model.id)
    const cost = readCatalogCost(model.cost)
    if (!id || !cost) return
    costs.set(catalogIdKey(id), cost)
    costs.set(catalogSlug(id), cost)
    if (provider && !id.includes("/")) costs.set(`${catalogSlug(provider)}/${catalogSlug(id)}`, cost)
  }

  if (Array.isArray(payload)) {
    payload.forEach((model) => add(model))
    return costs
  }
  if (!isRecord(payload)) return costs

  Object.entries(payload).forEach(([key, value]) => {
    if (!isRecord(value)) return
    if (isRecord(value.models)) {
      Object.values(value.models).forEach((model) => add(model, stringValue(value.id) ?? key))
      return
    }
    add(value)
  })
  return costs
}

function readCatalogCost(value: unknown): ModelCatalogCost | undefined {
  if (!isRecord(value)) return undefined
  const input = numberValue(value.input)
  const output = numberValue(value.output)
  if (input === undefined || output === undefined) return undefined
  return {
    input,
    output,
    cacheRead: numberValue(value.cache_read),
    cacheWrite: numberValue(value.cache_write),
  }
}

function readCatalogLimit(value: unknown) {
  if (!isRecord(value)) return undefined
  return {
    context: numberValue(value.context),
    output: numberValue(value.output),
  }
}

function readCatalogModalities(value: unknown) {
  if (!isRecord(value)) return { input: [], output: [] }
  return {
    input: stringArrayValue(value.input),
    output: stringArrayValue(value.output),
  }
}

function readCatalogWeights(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const label = stringValue(item.label)
    const url = stringValue(item.url)
    return label && url ? [{ label, url }] : []
  })
}

function readCatalogBenchmarks(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const name = stringValue(item.name)
    const score = numberValue(item.score)
    return name && score !== undefined
      ? [
          {
            name,
            score,
            metric: stringValue(item.metric),
            harness: stringValue(item.harness),
            variant: stringValue(item.variant),
            dataset: stringValue(item.dataset),
            version: stringValue(item.version),
            source: stringValue(item.source),
          },
        ]
      : []
  })
}

function displayDateTime(value: string | undefined) {
  return value ? new Date(value).getTime() || 0 : 0
}

function catalogIdKey(value: string) {
  return value.split("/").map(catalogSlug).join("/")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown) {
  return value === true
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : []
}
