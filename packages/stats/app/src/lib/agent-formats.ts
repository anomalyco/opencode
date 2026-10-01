import type { UsagePoint } from "@opencode-ai/stats-core/domain/home"
import { translate } from "../i18n"
import {
  catalogModelPath,
  catalogSlug,
  formatCatalogLabName,
  isKnownCatalogLab,
  type ModelCatalog,
  type ModelCatalogEntry,
} from "../routes/model-catalog"
import {
  canonicalFamilyComparisonPath,
  canonicalModelComparisonPath,
  latestFamilyComparisonPath,
  resolveComparisonFamily,
} from "./comparison-pages"
import { formatPercent, formatPrice, formatTokens, fromFirstUsage, isoDay } from "./format"
import { baseUrl, jsonUrl, markdownUrl, pageUrl } from "./language"
import { methodologyItems } from "./methodology"
import type { ComparePageData, HomePageData, LabPageData, ModelPageData } from "./page-data"
import { homeSummary, labSummary, modelSummary } from "./summaries"

type Cell = string | number
type CompareModel = ComparePageData["models"][number]

const regions = new Intl.DisplayNames(["en"], { type: "region" })

export function homeMarkdown(data: HomePageData) {
  const summary = homeSummary("en", data)
  const latest = data.market.at(-1)
  return markdown(
    `# ${translate("en", "app.title")}`,
    summary && `> ${summary}`,
    facts([
      ["Page", pageUrl("/data/")],
      ["JSON", jsonUrl("/data/")],
      ["Updated", data.updatedAt],
    ]),
    "## Top models: past 7 days",
    table(
      ["Rank", "Model", "Lab", "Tokens", `Change ${translate("en", "chart.vsPreviousWeek")}`],
      data.leaderboard.weekly.map((entry) => [
        entry.rank,
        link(modelLabel(entry.name, entry.model), entry.path),
        entryLab(entry.provider, data.catalogLabs),
        formatTokens(entry.tokens * 1_000_000_000),
        formatChange(entry.change),
      ]),
    ),
    "## Top models: past day",
    table(
      ["Rank", "Model", "Lab", "Tokens"],
      data.leaderboard.daily.map((entry) => [
        entry.rank,
        link(modelLabel(entry.name, entry.model), entry.path),
        entryLab(entry.provider, data.catalogLabs),
        formatTokens(entry.tokens * 1_000_000_000),
      ]),
    ),
    "## Daily tokens by model: past 2 months",
    seriesTable(data.usage, data.updatedAt, (value) => formatTokens(value * 1_000_000_000_000)),
    "## Daily unique users by model: past 2 months",
    seriesTable(data.users, data.updatedAt, formatTokens),
    "## Weekly retention",
    translate("en", "methodology.retention"),
    table(
      ["Rank", "Model", "Retention", "Eligible user-weeks"],
      data.retention.map((entry) => [
        entry.rank ?? "-",
        link(modelLabel(entry.name, entry.model), entry.path),
        formatRate(entry.rate),
        formatTokens(entry.eligibleUserWeeks),
      ]),
    ),
    "## Session cost",
    table(
      ["Model", "Average cost per session", "Average tokens per session"],
      data.sessionCost.map((entry) => [entry.model, formatSessionCost(entry.cost), formatTokens(entry.tokens)]),
    ),
    "## Token prices: USD per 1M tokens",
    table(
      ["Model", "Input", "Output", "Cached input"],
      data.tokenCost.map((entry) => [
        entry.model,
        formatPrice(entry.input),
        formatPrice(entry.output),
        formatPrice(entry.cached),
      ]),
    ),
    "## Cache ratio",
    table(
      ["Model", "Input tokens served from cache", "Cached input tokens", "Uncached input tokens"],
      data.cacheRatio.map((entry) => [
        entry.model,
        `${entry.ratio}%`,
        formatTokens(entry.cached * 1_000_000_000),
        formatTokens(entry.uncached * 1_000_000_000),
      ]),
    ),
    latest && `## Market share by lab: ${isoDay(latest.date, data.updatedAt)}`,
    latest &&
      table(
        ["Lab", "Tokens", "Share"],
        latest.authors
          .toSorted((a, b) => b.tokens - a.tokens)
          .map((author) => [
            formatCatalogLabName(author.author),
            formatTokens(author.tokens * 1_000_000_000_000),
            `${author.share.toFixed(1)}%`,
          ]),
      ),
    "## Top countries: past 2 months",
    table(
      ["Rank", "Country", "Tokens", "Share"],
      data.country
        .slice(0, 30)
        .map((entry) => [
          entry.rank,
          countryName(entry.country),
          formatTokens(entry.tokens * 1_000_000_000_000),
          `${entry.share}%`,
        ]),
    ),
    methodologyMarkdown(),
  )
}

export function homeJson(data: HomePageData) {
  return {
    page: pageUrl("/data/"),
    updatedAt: data.updatedAt,
    summary: homeSummary("en", data) ?? null,
    leaderboard: {
      pastWeek: data.leaderboard.weekly.map((entry) => ({ ...leaderboardJson(entry), changePercent: entry.change })),
      pastDay: data.leaderboard.daily.map(leaderboardJson),
    },
    dailyTokens: seriesJson(data.usage, data.updatedAt, 1_000_000_000_000),
    dailyUniqueUsers: seriesJson(data.users, data.updatedAt, 1),
    weeklyRetention: data.retention.map((entry) => ({
      rank: entry.rank,
      model: entry.model,
      name: entry.name,
      page: pageUrl(entry.path),
      retentionPercent: entry.rate,
      eligibleUserWeeks: entry.eligibleUserWeeks,
      retainedUserWeeks: entry.retainedUserWeeks,
    })),
    sessionCost: data.sessionCost.map((entry) => ({
      model: entry.model,
      costPerSessionUsd: entry.cost,
      tokensPerSession: entry.tokens,
    })),
    tokenPricesUsdPer1M: data.tokenCost.map((entry) => ({
      model: entry.model,
      input: entry.input,
      output: entry.output,
      cachedInput: entry.cached,
    })),
    cacheRatio: data.cacheRatio.map((entry) => ({
      model: entry.model,
      cachedInputPercent: entry.ratio,
      cachedInputTokens: Math.round(entry.cached * 1_000_000_000),
      uncachedInputTokens: Math.round(entry.uncached * 1_000_000_000),
    })),
    marketShare: data.market.map((day) => ({
      date: isoDay(day.date, data.updatedAt),
      tokens: Math.round(day.total * 1_000_000_000_000),
      labs: day.authors.map((author) => ({
        lab: formatCatalogLabName(author.author),
        tokens: Math.round(author.tokens * 1_000_000_000_000),
        sharePercent: author.share,
      })),
    })),
    countries: data.country.map((entry) => ({
      rank: entry.rank,
      country: entry.country,
      tokens: Math.round(entry.tokens * 1_000_000_000_000),
      sharePercent: entry.share,
    })),
  }
}

export function labMarkdown(data: LabPageData) {
  const lab = data.lab
  if (!lab) return undefined
  const path = `/data/${lab.id}`
  const stats = data.stats
  const usage = new Map((stats?.models ?? []).map((item) => [item.slug, item]))
  const summary = labSummary("en", data)
  return markdown(
    `# ${translate("en", "lab.title", { lab: lab.name })}`,
    summary && `> ${summary}`,
    lab.description,
    facts([
      ["Page", pageUrl(path)],
      ["JSON", jsonUrl(path)],
      ["Updated", stats?.updatedAt],
      ["Tokens processed: past 2 months", stats && formatTokens(stats.totals.tokens)],
      ["Share of all usage", stats && formatPercent(stats.tokenShare)],
    ]),
    `## ${lab.name} models`,
    table(
      ["Model", "Tokens: past 2 months", "Share of lab usage", "Context window", "Max output", "Release date"],
      lab.models.map((model) => {
        const item = usage.get(model.slug)
        return [
          link(model.name, data.modelPaths[model.id] ?? catalogModelPath(model)),
          item ? formatTokens(item.tokens) : "-",
          item ? formatPercent(item.share) : "-",
          formatLimit(model.limit?.context),
          formatLimit(model.limit?.output),
          model.releaseDate ?? "-",
        ]
      }),
    ),
    stats && stats.usage.length > 0 && "## Daily usage: past 2 months",
    stats &&
      stats.usage.length > 0 &&
      table(
        ["Date", "Tokens", "Unique users"],
        fromFirstUsage(stats.usage).map((point) => [
          isoDay(point.date, stats.updatedAt),
          formatTokens(point.tokens),
          formatTokens(point.users),
        ]),
      ),
    methodologyMarkdown(),
  )
}

export function labJson(data: LabPageData) {
  const lab = data.lab
  if (!lab) return undefined
  const stats = data.stats
  const usage = new Map((stats?.models ?? []).map((item) => [item.slug, item]))
  return {
    page: pageUrl(`/data/${lab.id}`),
    updatedAt: stats?.updatedAt ?? null,
    summary: labSummary("en", data) ?? null,
    lab: { id: lab.id, name: lab.name, description: lab.description ?? null },
    usage: stats && {
      tokens: stats.totals.tokens,
      sessions: stats.totals.sessions,
      sharePercent: stats.tokenShare,
      changePercent: stats.tokenChange,
      modelsWithUsage: stats.totals.models,
    },
    models: lab.models.map((model) => ({
      id: model.id,
      name: model.name,
      page: pageUrl(data.modelPaths[model.id] ?? catalogModelPath(model)),
      tokens: usage.get(model.slug)?.tokens ?? 0,
      sharePercent: usage.get(model.slug)?.share ?? 0,
      contextTokens: model.limit?.context ?? null,
      outputTokens: model.limit?.output ?? null,
      releaseDate: model.releaseDate ?? null,
    })),
    daily: (stats?.usage ?? []).map((point) => ({
      date: isoDay(point.date, stats?.updatedAt ?? null),
      tokens: point.tokens,
      uniqueUsers: point.users,
      sessions: point.sessions,
      costUsd: point.cost,
    })),
  }
}

export function modelMarkdown(data: ModelPageData, name: string) {
  const entry = data.catalog.entry
  const stats = data.stats
  if (!entry && !stats) return undefined
  const summary = modelSummary("en", data, name)
  return markdown(
    `# ${translate("en", "model.title", { model: name })}`,
    summary && `> ${summary}`,
    entry?.description,
    facts([
      ["Page", pageUrl(data.path)],
      ["JSON", jsonUrl(data.path)],
      ["Model ID", entry?.id ?? stats?.model],
      ["Lab", entry ? formatCatalogLabName(entry.lab) : stats?.author],
      ["Updated", stats?.updatedAt],
    ]),
    entry && "## Model facts",
    entry && table(["Fact", "Value"], modelFacts(entry)),
    entry?.cost && "## Pricing: USD per 1M tokens",
    entry?.cost &&
      table(
        ["Input", "Output", "Cached input", "Cache write"],
        [
          [
            formatPrice(entry.cost.input),
            formatPrice(entry.cost.output),
            optionalPrice(entry.cost.cacheRead),
            optionalPrice(entry.cost.cacheWrite),
          ],
        ],
      ),
    stats && "## OpenCode usage: past 2 months",
    stats &&
      table(
        ["Metric", "Value"],
        [
          ["Rank by tokens last week", stats.rank === null ? "Unranked" : `#${stats.rank}`],
          ["Tokens", formatTokens(stats.totals.tokens)],
          ["Share of all tokens", formatPercent(stats.tokenShare)],
          ["Change vs previous 2 months", formatChange(stats.tokenChange)],
          ["Unique users", formatTokens(stats.totals.uniqueUsers)],
          ["Completed sessions", stats.totals.sessions.toLocaleString("en")],
          ["Average tokens per session", formatTokens(stats.totals.tokensPerSession)],
          ["Average cost per session", formatSessionCost(stats.totals.costPerSession)],
          ["Total spend", `$${Math.round(stats.totals.cost).toLocaleString("en")}`],
          ["Input tokens served from cache", `${stats.totals.cacheRatio}%`],
          ["Weekly retention", stats.weeklyRetention ? formatRate(stats.weeklyRetention.rate) : "-"],
        ],
      ),
    stats && stats.usage.length > 0 && "## Daily usage: past 2 months",
    stats &&
      stats.usage.length > 0 &&
      table(
        ["Date", "Tokens", "Unique users", "Sessions"],
        fromFirstUsage(stats.usage).map((point) => [
          isoDay(point.date, stats.updatedAt),
          formatTokens(point.tokens),
          formatTokens(point.users),
          point.sessions.toLocaleString("en"),
        ]),
      ),
    stats && stats.country.length > 0 && "## Top countries: past 2 months",
    stats &&
      stats.country.length > 0 &&
      table(
        ["Rank", "Country", "Tokens", "Share"],
        stats.country
          .slice(0, 15)
          .map((country) => [
            country.rank,
            countryName(country.country),
            formatTokens(country.tokens * 1_000_000_000_000),
            `${country.share}%`,
          ]),
      ),
    stats && stats.peers.length > 0 && "## Nearby models by tokens last week",
    stats &&
      stats.peers.length > 0 &&
      table(
        ["Rank", "Model", "Lab", "Tokens"],
        stats.peers.map((peer) => [
          peer.rank,
          link(peer.model, peer.path),
          peer.provider === "unknown" ? "-" : formatCatalogLabName(peer.provider),
          formatTokens(peer.tokens),
        ]),
      ),
    entry && entry.benchmarks.length > 0 && "## Benchmarks",
    entry &&
      entry.benchmarks.length > 0 &&
      table(
        ["Benchmark", "Score", "Metric", "Source"],
        entry.benchmarks.map((item) => [item.name, item.score, item.metric ?? "", item.source ?? ""]),
      ),
    methodologyMarkdown(),
  )
}

export function modelJson(data: ModelPageData, name: string) {
  const entry = data.catalog.entry
  const stats = data.stats
  if (!entry && !stats) return undefined
  return {
    page: pageUrl(data.path),
    updatedAt: stats?.updatedAt ?? null,
    summary: modelSummary("en", data, name) ?? null,
    model: {
      id: entry?.id ?? stats?.model ?? null,
      name,
      lab: entry?.lab ?? stats?.provider ?? null,
      labName: entry ? formatCatalogLabName(entry.lab) : (stats?.author ?? null),
      family: entry?.family ?? null,
      description: entry?.description ?? null,
      releaseDate: entry?.releaseDate ?? null,
      lastUpdated: entry?.lastUpdated ?? null,
      knowledgeCutoff: entry?.knowledge ?? null,
      contextTokens: entry?.limit?.context ?? null,
      outputTokens: entry?.limit?.output ?? null,
      inputModalities: entry?.modalities.input ?? [],
      outputModalities: entry?.modalities.output ?? [],
      reasoning: entry?.reasoning ?? null,
      toolCall: entry?.toolCall ?? null,
      openWeights: entry?.openWeights ?? null,
      weights: entry?.weights ?? [],
      priceUsdPer1M: entry?.cost
        ? {
            input: entry.cost.input,
            output: entry.cost.output,
            cachedInput: entry.cost.cacheRead ?? null,
            cacheWrite: entry.cost.cacheWrite ?? null,
          }
        : null,
      benchmarks: entry?.benchmarks ?? [],
    },
    usage: stats && {
      rankLastWeek: stats.rank,
      tokens: stats.totals.tokens,
      sharePercent: stats.tokenShare,
      changePercent: stats.tokenChange,
      uniqueUsers: stats.totals.uniqueUsers,
      sessions: stats.totals.sessions,
      tokensPerSession: stats.totals.tokensPerSession,
      costPerSessionUsd: stats.totals.costPerSession,
      costUsd: stats.totals.cost,
      cachedInputPercent: stats.totals.cacheRatio,
      weeklyRetentionPercent: stats.weeklyRetention?.rate ?? null,
      daily: stats.usage.map((point) => ({
        date: isoDay(point.date, stats.updatedAt),
        tokens: point.tokens,
        uniqueUsers: point.users,
        sessions: point.sessions,
        costUsd: point.cost,
      })),
      countries: stats.country.map((country) => ({
        rank: country.rank,
        country: country.country,
        tokens: Math.round(country.tokens * 1_000_000_000_000),
        sharePercent: country.share,
      })),
      peers: stats.peers.map((peer) => ({
        rank: peer.rank,
        model: peer.model,
        lab: peer.provider,
        page: pageUrl(peer.path),
        tokens: peer.tokens,
      })),
    },
  }
}

export function compareMarkdown(data: ComparePageData, params: string[]) {
  const [first, second] = data.models
  if (!first || !second || data.models.some((model) => !model.entry && !model.stats)) return undefined
  const names = data.models.map((model) => model.entry?.name ?? model.stats?.model ?? model.request.slug)
  const updatedAt = data.models
    .flatMap((model) => (model.stats?.updatedAt ? [model.stats.updatedAt] : []))
    .toSorted()
    .at(-1)
  const cells = (read: (model: CompareModel) => Cell) => data.models.map(read)
  return markdown(
    `# ${names[0]} vs ${names[1]} - AI Model Comparison`,
    facts([
      ["Page", pageUrl(comparePath(data, params))],
      ["Updated", updatedAt],
    ]),
    table(
      ["", ...names],
      [
        [
          "Lab",
          ...cells((model) => (model.entry ? formatCatalogLabName(model.entry.lab) : (model.stats?.author ?? "-"))),
        ],
        ["Context window", ...cells((model) => formatLimit(model.entry?.limit?.context))],
        ["Max output", ...cells((model) => formatLimit(model.entry?.limit?.output))],
        ["Input modalities", ...cells((model) => model.entry?.modalities.input.join(", ") || "-")],
        ["Reasoning", ...cells((model) => yesNo(model.entry?.reasoning))],
        ["Tool calling", ...cells((model) => yesNo(model.entry?.toolCall))],
        ["Open weights", ...cells((model) => yesNo(model.entry?.openWeights))],
        ["Release date", ...cells((model) => model.entry?.releaseDate ?? "-")],
        ["Input price per 1M tokens", ...cells((model) => optionalPrice(model.entry?.cost?.input))],
        ["Output price per 1M tokens", ...cells((model) => optionalPrice(model.entry?.cost?.output))],
        ["Cached input price per 1M tokens", ...cells((model) => optionalPrice(model.entry?.cost?.cacheRead))],
        [
          "OpenCode tokens: past 2 months",
          ...cells((model) => (model.stats ? formatTokens(model.stats.totals.tokens) : "-")),
        ],
        ["Share of all tokens", ...cells((model) => (model.stats ? formatPercent(model.stats.tokenShare) : "-"))],
        ["Rank by tokens last week", ...cells((model) => (model.stats?.rank ? `#${model.stats.rank}` : "-"))],
        ["Unique users", ...cells((model) => (model.stats ? formatTokens(model.stats.totals.uniqueUsers) : "-"))],
        [
          "Weekly retention",
          ...cells((model) => (model.stats?.weeklyRetention ? formatRate(model.stats.weeklyRetention.rate) : "-")),
        ],
      ],
    ),
    `Model pages: ${data.models.map((model, index) => link(names[index], compareModelPath(model))).join(", ")}`,
    methodologyMarkdown(),
  )
}

export function llmsTxt(home: HomePageData, catalog: ModelCatalog) {
  return markdown(
    "# OpenCode Data",
    "> AI model usage rankings, token prices, session costs, and market share from OpenCode, updated hourly.",
    homeSummary("en", home),
    facts([
      ["Updates", translate("en", "methodology.updates")],
      ["Updated", home.updatedAt],
    ]),
    "The home, lab, and model pages are also available as Markdown or JSON, and model comparison pages as Markdown: add `.md` or `.json` to the page URL (the home page is `/data/index.md`), or request a page with `Accept: text/markdown`.",
    "## Pages",
    [
      `- ${link("AI model usage rankings", "/data/")}: leaderboards, daily tokens and users by model, retention, session cost, token prices, cache ratio, market share by lab, and countries`,
      `- [Model comparisons](${pageUrl("/data/compare")}): compare models on usage, pricing, limits, and capabilities`,
    ].join("\n"),
    "## Top models: past 7 days",
    home.leaderboard.weekly
      .map(
        (entry) =>
          `- ${link(modelLabel(entry.name, entry.model), entry.path)}: #${entry.rank}, ${formatTokens(entry.tokens * 1_000_000_000)} tokens`,
      )
      .join("\n"),
    "## Labs",
    catalog.labs
      .map(
        (lab) =>
          `- ${link(lab.name, `/data/${lab.id}`)}: ${lab.models.length} ${lab.models.length === 1 ? "model" : "models"}`,
      )
      .join("\n"),
    "## Data",
    [
      `- [Home data (JSON)](${jsonUrl("/data/")})`,
      `- Lab data: \`${baseUrl}/data/{lab}.json\``,
      `- Model data: \`${baseUrl}/data/{lab}/{model}.json\``,
      `- [Sitemap](${pageUrl("/data/sitemap.xml")})`,
    ].join("\n"),
    methodologyMarkdown(),
  )
}

function comparePath(data: ComparePageData, params: string[]) {
  const [first, second] = data.models
  if (params.length === 2) {
    const families = params.flatMap((value) => resolveComparisonFamily(data.catalog, value) ?? [])
    if (families.length === 2) return canonicalFamilyComparisonPath(families[0], families[1])
  }
  if (first?.entry && second?.entry)
    return (
      latestFamilyComparisonPath(data.catalog, first.entry, second.entry) ??
      canonicalModelComparisonPath(first.entry, second.entry)
    )
  return `/data/compare/${params.map(catalogSlug).join("/")}`
}

function compareModelPath(model: CompareModel) {
  if (model.entry) return catalogModelPath(model.entry)
  return `/data/${catalogSlug(model.request.lab)}/${catalogSlug(model.request.slug)}`
}

function modelFacts(entry: ModelCatalogEntry): Cell[][] {
  return [
    ["Context window", formatLimit(entry.limit?.context)],
    ["Max output", formatLimit(entry.limit?.output)],
    ["Knowledge cutoff", entry.knowledge ?? "-"],
    ["Release date", entry.releaseDate ?? "-"],
    ["Input modalities", entry.modalities.input.join(", ") || "-"],
    ["Output modalities", entry.modalities.output.join(", ") || "-"],
    ["Reasoning", yesNo(entry.reasoning)],
    ["Tool calling", yesNo(entry.toolCall)],
    ["Open weights", yesNo(entry.openWeights)],
    ...entry.weights.map((weight) => ["Weights", `[${weight.label}](${weight.url})`]),
  ]
}

function leaderboardJson(entry: HomePageData["leaderboard"]["weekly"][number]) {
  return {
    rank: entry.rank,
    model: entry.model,
    name: entry.name,
    lab: entry.provider,
    page: pageUrl(entry.path),
    tokens: entry.tokens * 1_000_000_000,
  }
}

function seriesTable(points: UsagePoint[], updatedAt: string | null, format: (value: number) => string) {
  const models = points[0]?.segments.map((segment) => segment.model) ?? []
  return table(
    [translate("en", "chart.date"), ...models, "Total"],
    points.map((point) => [
      isoDay(point.date, updatedAt),
      ...models.map((model) => format(point.segments.find((segment) => segment.model === model)?.value ?? 0)),
      format(point.segments.reduce((sum, segment) => sum + segment.value, 0)),
    ]),
  )
}

function seriesJson(points: UsagePoint[], updatedAt: string | null, scale: number) {
  return points.map((point) => ({
    date: isoDay(point.date, updatedAt),
    total: Math.round(point.segments.reduce((sum, segment) => sum + segment.value, 0) * scale),
    models: Object.fromEntries(point.segments.map((segment) => [segment.model, Math.round(segment.value * scale)])),
  }))
}

function methodologyMarkdown() {
  return [
    `## ${translate("en", "methodology.title")}`,
    methodologyItems.map(([label, text]) => `- ${translate("en", label)}: ${translate("en", text)}`).join("\n"),
  ].join("\n\n")
}

function markdown(...blocks: (string | false | null | undefined | 0)[]) {
  return `${blocks.filter((block): block is string => typeof block === "string" && block.length > 0).join("\n\n")}\n`
}

function table(headers: Cell[], rows: Cell[][]) {
  if (rows.length === 0) return "_No data yet._"
  const line = (cells: Cell[]) =>
    `| ${cells.map((value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n")
}

function facts(items: [string, string | false | null | undefined][]) {
  return items.flatMap(([label, value]) => (value ? [`- ${label}: ${value}`] : [])).join("\n")
}

function link(label: string, path: string) {
  return `[${label}](${markdownUrl(path)})`
}

function modelLabel(name: string, model: string) {
  return name === model ? model : `${name} (${model})`
}

function entryLab(provider: string, catalogLabs: readonly string[]) {
  return isKnownCatalogLab(provider, catalogLabs) ? formatCatalogLabName(provider) : "-"
}

function countryName(code: string) {
  if (code === "ZZ") return "Unknown"
  // Edge networks report non-ISO codes like T1 (Tor), which Intl.DisplayNames rejects.
  if (!/^[A-Z]{2}$/.test(code)) return code
  return regions.of(code) ?? code
}

function formatChange(value: number | null) {
  if (value === null) return "New"
  return `${value > 0 ? "+" : ""}${value}%`
}

function formatRate(value: number) {
  return `${value.toFixed(1)}%`
}

function formatSessionCost(value: number) {
  return `$${value.toFixed(4)}`
}

function formatLimit(value: number | undefined) {
  return value === undefined ? "-" : formatTokens(value)
}

function optionalPrice(value: number | undefined) {
  return value === undefined ? "-" : formatPrice(value)
}

function yesNo(value: boolean | undefined) {
  if (value === undefined) return "-"
  return value ? "Yes" : "No"
}
