import { catalogSlug, findModelCatalogEntry, type ModelCatalog, type ModelCatalogEntry } from "../routes/model-catalog"

type ComparisonFamilyDefinition = {
  slug: string
  name: string
  lab: string
  prefixes: string[]
  aliases?: string[]
  preferredFamilies?: string[]
}

export type ResolvedComparisonFamily = ComparisonFamilyDefinition & {
  model: ModelCatalogEntry
}

export const comparisonFamilies: ComparisonFamilyDefinition[] = [
  {
    slug: "gpt",
    name: "GPT",
    lab: "openai",
    prefixes: ["gpt", "o"],
    aliases: ["openai"],
    preferredFamilies: ["gpt", "o"],
  },
  {
    slug: "claude",
    name: "Claude",
    lab: "anthropic",
    prefixes: ["claude"],
    aliases: ["anthropic"],
    preferredFamilies: ["claude-sonnet", "claude-opus"],
  },
  {
    slug: "gemini",
    name: "Gemini",
    lab: "google",
    prefixes: ["gemini"],
    aliases: ["google"],
    preferredFamilies: ["gemini-pro", "gemini-flash", "gemini"],
  },
  {
    slug: "deepseek",
    name: "DeepSeek",
    lab: "deepseek",
    prefixes: ["deepseek"],
    preferredFamilies: ["deepseek-thinking", "deepseek"],
  },
  {
    slug: "qwen",
    name: "Qwen",
    lab: "alibaba",
    prefixes: ["qwen"],
    aliases: ["alibaba"],
    preferredFamilies: ["qwen"],
  },
  {
    slug: "glm",
    name: "GLM",
    lab: "zhipuai",
    prefixes: ["glm"],
    aliases: ["zhipu", "zhipuai", "zai"],
    preferredFamilies: ["glm"],
  },
  {
    slug: "kimi",
    name: "Kimi",
    lab: "moonshotai",
    prefixes: ["kimi"],
    aliases: ["moonshot", "moonshotai"],
    preferredFamilies: ["kimi-k2", "kimi-thinking"],
  },
  {
    slug: "minimax",
    name: "MiniMax",
    lab: "minimax",
    prefixes: ["minimax"],
  },
  {
    slug: "grok",
    name: "Grok",
    lab: "xai",
    prefixes: ["grok"],
    aliases: ["xai"],
    preferredFamilies: ["grok"],
  },
  {
    slug: "mistral",
    name: "Mistral",
    lab: "mistral",
    prefixes: ["mistral", "magistral", "devstral", "codestral"],
    preferredFamilies: ["mistral-large", "mistral-medium", "mistral-small"],
  },
  {
    slug: "llama",
    name: "Llama",
    lab: "meta",
    prefixes: ["llama"],
    aliases: ["meta"],
  },
  {
    slug: "nemotron",
    name: "Nemotron",
    lab: "nvidia",
    prefixes: ["nemotron", "llama-nemotron"],
    aliases: ["nvidia"],
  },
  {
    slug: "mimo",
    name: "MiMo",
    lab: "xiaomi",
    prefixes: ["mimo"],
    aliases: ["xiaomi"],
  },
  {
    slug: "command",
    name: "Command",
    lab: "cohere",
    prefixes: ["command"],
    aliases: ["cohere"],
    preferredFamilies: ["command-a", "command-r"],
  },
  {
    slug: "sonar",
    name: "Sonar",
    lab: "perplexity",
    prefixes: ["sonar"],
    aliases: ["perplexity"],
    preferredFamilies: ["sonar-pro", "sonar-reasoning", "sonar"],
  },
  {
    slug: "longcat",
    name: "LongCat",
    lab: "meituan",
    prefixes: ["longcat"],
    aliases: ["meituan"],
  },
  {
    slug: "step",
    name: "Step",
    lab: "stepfun",
    prefixes: ["step"],
    aliases: ["stepfun"],
  },
  {
    slug: "mai",
    name: "MAI",
    lab: "microsoft",
    prefixes: ["mai"],
    aliases: ["microsoft"],
  },
]

export function resolveComparisonFamily(catalog: ModelCatalog, value: string) {
  const family = findComparisonFamily(value)
  if (!family) return undefined
  const model = comparisonFamilyCandidates(catalog, family.slug)[0]
  if (!model) return undefined
  return { ...family, model } satisfies ResolvedComparisonFamily
}

export function findComparisonFamily(value: string) {
  const slug = catalogSlug(value)
  return comparisonFamilies.find((family) => family.slug === slug || family.aliases?.includes(slug))
}

export function comparisonFamilyCandidates(catalog: ModelCatalog, value: string) {
  const family = findComparisonFamily(value)
  if (!family) return []
  const matches = catalog.models
    .filter((model) => model.lab === family.lab && isFamilyModel(model, family) && isGeneralComparisonModel(model))
    .toSorted((a, b) => comparisonFamilyModelSort(a, b, family))
  return matches.filter((model) => !isDuplicateAliasModel(model, matches))
}

export function comparisonSitemapModels(
  catalog: ModelCatalog,
  leaderboard: { model: string; provider: string }[] = [],
) {
  return uniqueModels([
    ...comparisonFamilies.flatMap((family) => comparisonFamilyCandidates(catalog, family.slug).slice(0, 2)),
    ...leaderboard.flatMap((entry) => {
      const model =
        findModelCatalogEntry(catalog, entry.model, entry.provider) ?? findModelCatalogEntry(catalog, entry.model)
      return model && isGeneralComparisonModel(model) ? [model] : []
    }),
  ]).toSorted((a, b) => a.id.localeCompare(b.id))
}

export function canonicalModelComparisonPath(first: ModelCatalogEntry, second: ModelCatalogEntry) {
  const models = [first, second].toSorted((a, b) => a.id.localeCompare(b.id))
  return `/data/compare/${models[0].lab}/${models[0].slug}/${models[1].lab}/${models[1].slug}`
}

export function canonicalFamilyComparisonPath(first: ResolvedComparisonFamily, second: ResolvedComparisonFamily) {
  const families = [first, second].toSorted((a, b) => a.slug.localeCompare(b.slug))
  return `/data/compare/${families[0].slug}/${families[1].slug}`
}

export function latestFamilyComparisonPath(catalog: ModelCatalog, first: ModelCatalogEntry, second: ModelCatalogEntry) {
  const firstFamily = comparisonFamilyForModel(catalog, first)
  const secondFamily = comparisonFamilyForModel(catalog, second)
  if (!firstFamily || !secondFamily || firstFamily.slug === secondFamily.slug) return undefined
  if (firstFamily.model.id !== first.id || secondFamily.model.id !== second.id) return undefined
  return canonicalFamilyComparisonPath(firstFamily, secondFamily)
}

export function comparisonFamilyForModel(catalog: ModelCatalog, model: ModelCatalogEntry) {
  const family = comparisonFamilies.find(
    (candidate) => candidate.lab === model.lab && isFamilyModel(model, candidate) && isGeneralComparisonModel(model),
  )
  if (!family) return undefined
  const latest = comparisonFamilyCandidates(catalog, family.slug)[0]
  if (!latest) return undefined
  return { ...family, model: latest } satisfies ResolvedComparisonFamily
}

function isFamilyModel(model: ModelCatalogEntry, family: ComparisonFamilyDefinition) {
  const values = [model.family, model.slug, model.name]
    .filter((value): value is string => Boolean(value))
    .map(catalogSlug)
  return family.prefixes.some((prefix) => values.some((value) => value === prefix || value.startsWith(`${prefix}-`)))
}

function isGeneralComparisonModel(model: ModelCatalogEntry) {
  const input = model.modalities.input.map(catalogSlug)
  const output = model.modalities.output.map(catalogSlug)
  if (!input.includes("text") || !output.includes("text")) return false
  return !/(?:^|-)(?:audio|embedding|guard|image|moderation|omni|rerank|safety|speech|transcribe|tts|vision)(?:-|$)/.test(
    model.slug,
  )
}

function comparisonFamilyModelSort(
  first: ModelCatalogEntry,
  second: ModelCatalogEntry,
  family: ComparisonFamilyDefinition,
) {
  return (
    displayDateTime(second.releaseDate ?? second.lastUpdated) -
      displayDateTime(first.releaseDate ?? first.lastUpdated) ||
    preferredFamilyIndex(first, family) - preferredFamilyIndex(second, family) ||
    modelVariantPenalty(first) - modelVariantPenalty(second) ||
    first.slug.length - second.slug.length ||
    first.name.localeCompare(second.name)
  )
}

function preferredFamilyIndex(model: ModelCatalogEntry, family: ComparisonFamilyDefinition) {
  const index = family.preferredFamilies?.indexOf(catalogSlug(model.family ?? "")) ?? -1
  return index === -1 ? (family.preferredFamilies?.length ?? 0) : index
}

function modelVariantPenalty(model: ModelCatalogEntry) {
  return /(?:highspeed|latest|preview|turbo|ultraspeed)/.test(model.slug) ? 1 : 0
}

function isDuplicateAliasModel(model: ModelCatalogEntry, models: ModelCatalogEntry[]) {
  if (!/(?:-latest|-highspeed|-ultraspeed)$/.test(model.slug)) return false
  return models.some(
    (candidate) =>
      candidate.id !== model.id &&
      candidate.releaseDate === model.releaseDate &&
      candidate.family === model.family &&
      !/(?:-latest|-highspeed|-ultraspeed)$/.test(candidate.slug),
  )
}

function uniqueModels(models: ModelCatalogEntry[]) {
  return models.reduce<{ ids: Set<string>; models: ModelCatalogEntry[] }>(
    (result, model) => {
      if (result.ids.has(model.id)) return result
      result.ids.add(model.id)
      result.models.push(model)
      return result
    },
    { ids: new Set(), models: [] },
  ).models
}

function displayDateTime(value: string | undefined) {
  if (!value) return 0
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) return date.getTime()
  const year = Number(value.match(/\d{4}/)?.[0] ?? 0)
  return Number.isFinite(year) ? year : 0
}
