import * as fs from "node:fs/promises"
import * as path from "node:path"

const RECORDINGS_DIR = path.resolve(import.meta.dir, "..", "test", "fixtures", "recordings")
const MODELS_DEV_URL = "https://models.dev/api.json"

type JsonRecord = Record<string, unknown>

type Pricing = {
  readonly input?: number
  readonly output?: number
  readonly cache_read?: number
  readonly cache_write?: number
  readonly reasoning?: number
}

type Usage = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly reportedCost: number
}

type Row = Usage & {
  readonly cassette: string
  readonly provider: string
  readonly model: string
  readonly estimatedCost: number
  readonly pricingSource: string
}

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

const asString = (value: unknown) => (typeof value === "string" ? value : undefined)

const readJson = async (file: string) => JSON.parse(await Bun.file(file).text()) as unknown

const walk = async (dir: string): Promise<ReadonlyArray<string>> =>
  (await fs.readdir(dir, { withFileTypes: true }))
    .flatMap((entry) => {
      const file = path.join(dir, entry.name)
      return entry.isDirectory() ? [] : [file]
    })
    .concat(
      ...(await Promise.all(
        (await fs.readdir(dir, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => walk(path.join(dir, entry.name))),
      )),
    )

const providerFromUrl = (url: string) => {
  if (url.includes("api.openai.com")) return "openai"
  if (url.includes("api.anthropic.com")) return "anthropic"
  if (url.includes("generativelanguage.googleapis.com")) return "google"
  if (url.includes("bedrock")) return "amazon-bedrock"
  if (url.includes("openrouter.ai")) return "openrouter"
  if (url.includes("api.x.ai")) return "xai"
  if (url.includes("api.groq.com")) return "groq"
  if (url.includes("api.deepseek.com")) return "deepseek"
  if (url.includes("api.together.xyz")) return "togetherai"
  return "unknown"
}

const providerAliases: Record<string, ReadonlyArray<string>> = {
  openai: ["openai"],
  anthropic: ["anthropic"],
  google: ["google"],
  "amazon-bedrock": ["amazon-bedrock"],
  openrouter: ["openrouter", "openai", "anthropic", "google"],
  xai: ["xai"],
  groq: ["groq"],
  deepseek: ["deepseek"],
  togetherai: ["togetherai"],
}

const modelAliases = (model: string) => [
  model,
  model.replace(/^models\//, ""),
  model.replace(/-\d{8}$/, ""),
  model.replace(/-\d{4}-\d{2}-\d{2}$/, ""),
  model.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, ""),
  model.replace(/^openai\//, ""),
  model.replace(/^anthropic\//, ""),
  model.replace(/^google\//, ""),
]

const pricingFor = (models: JsonRecord, provider: string, model: string) => {
  for (const providerID of providerAliases[provider] ?? [provider]) {
    const providerEntry = models[providerID]
    if (!isRecord(providerEntry) || !isRecord(providerEntry.models)) continue
    for (const modelID of modelAliases(model)) {
      const modelEntry = providerEntry.models[modelID]
      if (isRecord(modelEntry) && isRecord(modelEntry.cost))
        return { pricing: modelEntry.cost as Pricing, source: `${providerID}/${modelID}` }
    }
  }
  return { pricing: undefined, source: "missing" }
}

const estimateCost = (usage: Usage, pricing: Pricing | undefined) => {
  if (!pricing) return 0
  return (
    (usage.inputTokens * (pricing.input ?? 0) +
      usage.outputTokens * (pricing.output ?? 0) +
      usage.cacheReadTokens * (pricing.cache_read ?? 0) +
      usage.cacheWriteTokens * (pricing.cache_write ?? 0) +
      usage.reasoningTokens * (pricing.reasoning ?? 0)) /
    1_000_000
  )
}

const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  reportedCost: 0,
})

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  reportedCost: a.reportedCost + b.reportedCost,
})

const usageFromObject = (usage: unknown): Usage => {
  if (!isRecord(usage)) return emptyUsage()
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {}
  const completionDetails = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {}
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {}
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {}
  const cacheWriteTokens = asNumber(promptDetails.cache_write_tokens) + asNumber(inputDetails.cache_write_tokens)
  return {
    inputTokens: asNumber(usage.prompt_tokens) + asNumber(usage.input_tokens),
    outputTokens: asNumber(usage.completion_tokens) + asNumber(usage.output_tokens),
    cacheReadTokens: asNumber(promptDetails.cached_tokens) + asNumber(inputDetails.cached_tokens),
    cacheWriteTokens,
    reasoningTokens: asNumber(completionDetails.reasoning_tokens) + asNumber(outputDetails.reasoning_tokens),
    reportedCost: asNumber(usage.cost),
  }
}

const jsonPayloads = (body: string) =>
  body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line !== "" && line !== "[DONE]")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown]
      } catch {
        return []
      }
    })

const usageFromResponseBody = (body: string) =>
  jsonPayloads(body).reduce<Usage>((usage, payload) => {
    if (!isRecord(payload)) return usage
    return addUsage(
      usage,
      addUsage(
        usageFromObject(payload.usage),
        usageFromObject(isRecord(payload.response) ? payload.response.usage : undefined),
      ),
    )
  }, emptyUsage())

const modelFromRequest = (request: unknown) => {
  if (!isRecord(request)) return "unknown"
  const requestBody = asString(request.body)
  if (!requestBody) return "unknown"
  try {
    const body = JSON.parse(requestBody) as unknown
    if (!isRecord(body)) return "unknown"
    return asString(body.model) ?? "unknown"
  } catch {
    return "unknown"
  }
}

const rowFor = (models: JsonRecord, file: string, cassette: unknown): Row | undefined => {
  if (!isRecord(cassette) || !Array.isArray(cassette.interactions)) return undefined
  const first = cassette.interactions.find(isRecord)
  if (!first || !isRecord(first.request)) return undefined
  const provider = providerFromUrl(asString(first.request.url) ?? "")
  const model = modelFromRequest(first.request)
  const usage = cassette.interactions.filter(isRecord).reduce<Usage>((total, interaction) => {
    if (!isRecord(interaction.response)) return total
    const responseBody = asString(interaction.response.body)
    if (!responseBody) return total
    return addUsage(total, usageFromResponseBody(responseBody))
  }, emptyUsage())
  const priced = pricingFor(models, provider, model)
  return {
    cassette: path.relative(RECORDINGS_DIR, file),
    provider,
    model,
    ...usage,
    estimatedCost: estimateCost(usage, priced.pricing),
    pricingSource: priced.source,
  }
}

const money = (value: number) => (value === 0 ? "$0.000000" : `$${value.toFixed(6)}`)
const tokens = (value: number) => value.toLocaleString("en-US")

const models = (await (await fetch(MODELS_DEV_URL)).json()) as JsonRecord
const rows = (
  await Promise.all(
    (await walk(RECORDINGS_DIR))
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => rowFor(models, file, await readJson(file))),
  )
).filter((row): row is Row => row !== undefined)

const totals = rows.reduce(
  (total, row) => ({
    ...addUsage(total, row),
    estimatedCost: total.estimatedCost + row.estimatedCost,
  }),
  { ...emptyUsage(), estimatedCost: 0 },
)

console.log("# Recording Cost Report")
console.log("")
console.log(`Pricing: ${MODELS_DEV_URL}`)
console.log(`Cassettes: ${rows.length}`)
console.log(`Reported cost: ${money(totals.reportedCost)}`)
console.log(`Estimated cost: ${money(totals.estimatedCost)}`)
console.log("")
console.log("| Provider | Model | Input | Output | Reasoning | Reported | Estimated | Pricing | Cassette |")
console.log("|---|---:|---:|---:|---:|---:|---:|---|---|")
for (const row of rows.toSorted((a, b) => b.reportedCost + b.estimatedCost - (a.reportedCost + a.estimatedCost))) {
  if (row.inputTokens + row.outputTokens + row.reasoningTokens + row.reportedCost + row.estimatedCost === 0) continue
  console.log(
    `| ${row.provider} | ${row.model} | ${tokens(row.inputTokens)} | ${tokens(row.outputTokens)} | ${tokens(row.reasoningTokens)} | ${money(row.reportedCost)} | ${money(row.estimatedCost)} | ${row.pricingSource} | ${row.cassette} |`,
  )
}
