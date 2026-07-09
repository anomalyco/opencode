import "../../../../index.css"
import { Link, Meta, Title } from "@solidjs/meta"
import { getStatsModelComparisonData, type StatsModelComparisonEntry } from "@opencode-ai/stats-core/domain/home"
import { runtime } from "@opencode-ai/stats-core/runtime"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import {
  ComparisonCardsSection,
  modelRefFromCatalog,
  uniqueComparisonPairs,
  type ComparisonModelRef,
  type ComparisonPair,
} from "../../../../compare-cards"
import { ComparisonSelector } from "../../../../compare-selector"
import {
  catalogSlug,
  findModelCatalogEntry,
  formatCatalogLabName,
  getModelCatalog,
  type ModelCatalog,
  type ModelCatalogEntry,
} from "../../../../model-catalog"
import {
  applyThemePreference,
  Footer,
  getGitHubStars,
  Header,
  isThemePreference,
  themeStorageKey,
  type HeaderLink,
  type ThemePreference,
} from "../../../../stats-shell"

const compareFallbackUrl = "https://stats.opencode.ai"
const compareHeaderLinks: readonly HeaderLink[] = [
  { href: "#overview", label: "Overview" },
  { href: "#comparison", label: "Comparison" },
  { href: "#compare-tool", label: "Compare" },
  { href: "#model-comparison", label: "Related" },
]
const compareFooterLinks: readonly HeaderLink[] = [
  { href: import.meta.env.BASE_URL, label: "Data Home" },
  { href: `${import.meta.env.BASE_URL}compare`, label: "Model Compare" },
  { href: `${import.meta.env.BASE_URL}#top-models`, label: "Top Models" },
  { href: `${import.meta.env.BASE_URL}#token-cost`, label: "Token Cost" },
]

type ComparisonModel = {
  name: string
  lab: string
  labName: string
  slug: string
  catalog: ModelCatalogEntry | null
  stats: StatsModelComparisonEntry | null
}
type ComparisonDirection = "higher" | "lower"
type ComparisonCell = { value: string; detail?: string; score?: number }
type ComparisonRow = {
  label: string
  description: string
  direction: ComparisonDirection
  cells: [ComparisonCell, ComparisonCell]
}

const getComparisonData = query(
  async (firstLab: string, firstModel: string, secondLab: string, secondModel: string) => {
    "use server"
    return runtime.runPromise(getStatsModelComparisonData(firstLab, firstModel, secondLab, secondModel))
  },
  "getStatsModelComparisonData",
)

export default function ModelComparePair() {
  const event = getRequestEvent()
  event?.response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400")
  const params = useParams()
  const firstLabParam = createMemo(() => params.firstLab ?? "")
  const firstModelParam = createMemo(() => params.firstModel ?? "")
  const secondLabParam = createMemo(() => params.secondLab ?? "")
  const secondModelParam = createMemo(() => params.secondModel ?? "")
  const catalog = createAsync(() => getModelCatalog())
  const firstCatalog = createMemo(() => resolvedCatalogEntry(catalog(), firstLabParam(), firstModelParam()))
  const secondCatalog = createMemo(() => resolvedCatalogEntry(catalog(), secondLabParam(), secondModelParam()))
  const stats = createAsync(() => {
    if (catalog() === undefined || firstCatalog() === undefined || secondCatalog() === undefined)
      return Promise.resolve(undefined)
    return getComparisonData(
      firstCatalog()?.lab ?? firstLabParam(),
      firstCatalog()?.slug ?? firstModelParam(),
      secondCatalog()?.lab ?? secondLabParam(),
      secondCatalog()?.slug ?? secondModelParam(),
    )
  })
  const githubStars = createAsync(() => getGitHubStars())
  const [themePreference, setThemePreference] = createSignal<ThemePreference>("system")
  const models = createMemo(
    () =>
      [
        buildComparisonModel(firstLabParam(), firstModelParam(), firstCatalog() ?? null, stats()?.models[0] ?? null),
        buildComparisonModel(secondLabParam(), secondModelParam(), secondCatalog() ?? null, stats()?.models[1] ?? null),
      ] as const,
  )
  const title = createMemo(() => `${models()[0].name} vs ${models()[1].name} - Model Comparison`)
  const description = createMemo(
    () =>
      `Compare ${models()[0].name} and ${models()[1].name} by usage, rank, context window, output limit, cache ratio, and cost across OpenCode data.`,
  )
  const canonicalPath = createMemo(
    () =>
      `${import.meta.env.BASE_URL}compare/${catalogSlug(models()[0].lab)}/${catalogSlug(models()[0].slug)}/${catalogSlug(
        models()[1].lab,
      )}/${catalogSlug(models()[1].slug)}`,
  )
  const canonicalUrl = createMemo(() =>
    new URL(
      canonicalPath(),
      event?.request.url ?? (typeof window === "undefined" ? compareFallbackUrl : window.location.href),
    ).toString(),
  )
  const rows = createMemo(() => buildComparisonRows(models()[0], models()[1]))
  const relatedPairs = createMemo(() => buildRelatedPairs(catalog(), models()[0], models()[1]))
  const selectorModels = createMemo(() =>
    uniqueCatalogModels([
      comparisonCatalogEntry(models()[0]),
      comparisonCatalogEntry(models()[1]),
      ...(catalog()?.models ?? []),
    ]),
  )
  const structuredData = createMemo(() =>
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title(),
      description: description(),
      url: canonicalUrl(),
      about: models().map((model) => ({
        "@type": "SoftwareApplication",
        name: model.name,
        applicationCategory: "AI model",
        provider: model.labName,
      })),
    }),
  )
  const updateThemePreference = (preference: ThemePreference) => {
    applyThemePreference(preference)
    setThemePreference(preference)
    if (typeof window === "undefined") return
    window.localStorage.setItem(themeStorageKey, preference)
  }

  onMount(() => {
    if (typeof window === "undefined") return
    const preference = window.localStorage.getItem(themeStorageKey)
    const nextPreference = isThemePreference(preference) ? preference : "system"
    applyThemePreference(nextPreference)
    setThemePreference(nextPreference)
  })

  return (
    <main data-page="stats" data-theme={themePreference()}>
      <Title>{title()}</Title>
      <Meta name="description" content={description()} />
      <Link rel="canonical" href={canonicalUrl()} />
      <Meta property="og:type" content="website" />
      <Meta property="og:site_name" content="OpenCode" />
      <Meta property="og:title" content={title()} />
      <Meta property="og:description" content={description()} />
      <Meta property="og:url" content={canonicalUrl()} />
      <Meta name="twitter:card" content="summary" />
      <Meta name="twitter:title" content={title()} />
      <Meta name="twitter:description" content={description()} />
      <script type="application/ld+json">{structuredData()}</script>
      <Header githubStars={githubStars() ?? "150K"} links={compareHeaderLinks} brandHref={import.meta.env.BASE_URL} />
      <div data-component="container">
        <div data-component="content">
          <ComparisonHero models={models()} />
          <section id="comparison" data-section="model-panel">
            <p data-slot="section-title">
              <strong>Comparison Table.</strong> <span>Compare usage, cost, limits, and features.</span>
            </p>
            <Show
              when={stats() !== undefined}
              fallback={
                <div data-component="empty-state" data-compact="true">
                  <strong>Loading comparison</strong>
                  <p>Loading stats for both models.</p>
                </div>
              }
            >
              <ComparisonTable models={models()} rows={rows()} />
            </Show>
          </section>
          <section id="compare-tool" data-section="model-panel" data-variant="compact">
            <p data-slot="section-title">
              <strong>Compare Another Pair.</strong> <span>Choose two models to compare.</span>
            </p>
            <Show
              when={selectorModels().length > 1}
              fallback={
                <div data-component="empty-state" data-compact="true">
                  <strong>No models found</strong>
                  <p>The model list could not be loaded.</p>
                </div>
              }
            >
              <ComparisonSelector
                models={selectorModels()}
                firstId={comparisonCatalogEntry(models()[0]).id}
                secondId={comparisonCatalogEntry(models()[1]).id}
              />
            </Show>
          </section>
          <ComparisonCardsSection
            pairs={relatedPairs()}
            title="Related Model Comparisons"
            description="Other model pairs to check."
          />
        </div>
        <Footer
          themePreference={themePreference()}
          onThemePreferenceChange={updateThemePreference}
          links={compareFooterLinks}
          bridge={{ href: "#comparison", label: "COMPARE TABLE" }}
        />
      </div>
    </main>
  )
}

function ComparisonHero(props: { models: readonly [ComparisonModel, ComparisonModel] }) {
  return (
    <section id="overview" data-section="model-hero">
      <a data-slot="model-back-link" href={`${import.meta.env.BASE_URL}compare`}>
        Compare
      </a>
      <div data-slot="model-hero-copy">
        <h1>
          {props.models[0].name} vs {props.models[1].name}
        </h1>
        <p>Compare usage, cost, limits, and features for these two models.</p>
      </div>
      <div data-slot="model-hero-pattern" aria-hidden="true" />
    </section>
  )
}

function ComparisonTable(props: { models: readonly [ComparisonModel, ComparisonModel]; rows: ComparisonRow[] }) {
  return (
    <div data-component="comparison-table-wrap">
      <table data-component="comparison-table">
        <caption>
          {props.models[0].name} compared with {props.models[1].name}
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <For each={props.models}>{(model) => <th scope="col">{model.name}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => {
              const best = () => bestCellIndex(row)
              return (
                <tr>
                  <th scope="row">
                    <strong>{row.label}</strong>
                    <span>{row.description}</span>
                  </th>
                  <For each={row.cells}>
                    {(cell, index) => (
                      <td data-best={best() === index() ? "true" : undefined}>
                        <strong>{cell.value}</strong>
                        <Show when={cell.detail}>{(detail) => <span>{detail()}</span>}</Show>
                      </td>
                    )}
                  </For>
                </tr>
              )
            }}
          </For>
        </tbody>
      </table>
    </div>
  )
}

function resolvedCatalogEntry(catalog: ModelCatalog | undefined, lab: string, model: string) {
  if (!catalog) return undefined
  return findModelCatalogEntry(catalog, model, lab) ?? null
}

function buildComparisonModel(
  labParam: string,
  modelParam: string,
  catalog: ModelCatalogEntry | null,
  stats: StatsModelComparisonEntry | null,
): ComparisonModel {
  return {
    name: catalog?.name ?? stats?.model ?? formatParamName(modelParam),
    lab: catalog?.lab ?? stats?.provider ?? catalogSlug(labParam),
    labName: formatCatalogLabName(catalog?.lab ?? stats?.provider ?? labParam),
    slug: catalog?.slug ?? stats?.slug ?? catalogSlug(modelParam),
    catalog,
    stats,
  }
}

function comparisonCatalogEntry(model: ComparisonModel): ModelCatalogEntry {
  if (model.catalog) return model.catalog
  return {
    id: `${catalogSlug(model.lab)}/${catalogSlug(model.slug)}`,
    lab: catalogSlug(model.lab),
    slug: catalogSlug(model.slug),
    name: model.name,
    modalities: { input: [], output: [] },
    openWeights: false,
    reasoning: false,
    toolCall: false,
    attachment: false,
    temperature: false,
    weights: [],
    benchmarks: [],
  }
}

function uniqueCatalogModels(models: ModelCatalogEntry[]) {
  return Object.values(
    models.reduce<Record<string, ModelCatalogEntry>>((result, model) => {
      result[model.id] = result[model.id] ?? model
      return result
    }, {}),
  )
}

function buildComparisonRows(first: ComparisonModel, second: ComparisonModel): ComparisonRow[] {
  return [
    comparisonRow(
      "Recent Rank",
      "Lower is better.",
      {
        value: first.stats?.rank == null ? "No usage" : `#${first.stats.rank}`,
        score: first.stats?.rank ?? undefined,
      },
      {
        value: second.stats?.rank == null ? "No usage" : `#${second.stats.rank}`,
        score: second.stats?.rank ?? undefined,
      },
      "lower",
    ),
    comparisonRow(
      "Token Share",
      "Share of recent OpenCode usage.",
      { value: first.stats ? formatPercent(first.stats.tokenShare) : "No usage", score: first.stats?.tokenShare },
      { value: second.stats ? formatPercent(second.stats.tokenShare) : "No usage", score: second.stats?.tokenShare },
      "higher",
    ),
    comparisonRow(
      "Tokens",
      "Recent token volume.",
      { value: first.stats ? formatTokens(first.stats.totals.tokens) : "No usage", score: first.stats?.totals.tokens },
      {
        value: second.stats ? formatTokens(second.stats.totals.tokens) : "No usage",
        score: second.stats?.totals.tokens,
      },
      "higher",
    ),
    comparisonRow(
      "Sessions",
      "Recent session count.",
      {
        value: first.stats ? formatInteger(first.stats.totals.sessions) : "No usage",
        score: first.stats?.totals.sessions,
      },
      {
        value: second.stats ? formatInteger(second.stats.totals.sessions) : "No usage",
        score: second.stats?.totals.sessions,
      },
      "higher",
    ),
    comparisonRow(
      "Cost / 1M Tokens",
      "Lower is better.",
      {
        value: first.stats ? formatMoney(first.stats.totals.costPerMillion) : "No usage",
        score: positiveScore(first.stats?.totals.costPerMillion),
      },
      {
        value: second.stats ? formatMoney(second.stats.totals.costPerMillion) : "No usage",
        score: positiveScore(second.stats?.totals.costPerMillion),
      },
      "lower",
    ),
    comparisonRow(
      "Cost / Session",
      "Lower is better.",
      {
        value: first.stats ? formatSessionCost(first.stats.totals.costPerSession) : "No usage",
        score: positiveScore(first.stats?.totals.costPerSession),
      },
      {
        value: second.stats ? formatSessionCost(second.stats.totals.costPerSession) : "No usage",
        score: positiveScore(second.stats?.totals.costPerSession),
      },
      "lower",
    ),
    comparisonRow(
      "Cache Ratio",
      "Higher is better.",
      {
        value: first.stats ? formatPercent(first.stats.totals.cacheRatio) : "No usage",
        score: first.stats?.totals.cacheRatio,
      },
      {
        value: second.stats ? formatPercent(second.stats.totals.cacheRatio) : "No usage",
        score: second.stats?.totals.cacheRatio,
      },
      "higher",
    ),
    comparisonRow(
      "Context Window",
      "Higher limit is better.",
      {
        value: formatCatalogLimit(first.catalog?.limit?.context),
        score: first.catalog?.limit?.context,
      },
      {
        value: formatCatalogLimit(second.catalog?.limit?.context),
        score: second.catalog?.limit?.context,
      },
      "higher",
    ),
    comparisonRow(
      "Output Limit",
      "Higher limit is better.",
      {
        value: formatCatalogLimit(first.catalog?.limit?.output),
        score: first.catalog?.limit?.output,
      },
      {
        value: formatCatalogLimit(second.catalog?.limit?.output),
        score: second.catalog?.limit?.output,
      },
      "higher",
    ),
    comparisonRow(
      "Release Date",
      "Newer release is highlighted.",
      {
        value: formatCatalogDate(first.catalog?.releaseDate),
        score: catalogDateScore(first.catalog?.releaseDate),
      },
      {
        value: formatCatalogDate(second.catalog?.releaseDate),
        score: catalogDateScore(second.catalog?.releaseDate),
      },
      "higher",
    ),
    comparisonRow(
      "Reasoning",
      "Supports reasoning.",
      booleanCell(first.catalog?.reasoning),
      booleanCell(second.catalog?.reasoning),
      "higher",
    ),
    comparisonRow(
      "Tool Calling",
      "Supports tool calls.",
      booleanCell(first.catalog?.toolCall),
      booleanCell(second.catalog?.toolCall),
      "higher",
    ),
    comparisonRow(
      "Attachments",
      "Supports attachments.",
      booleanCell(first.catalog?.attachment),
      booleanCell(second.catalog?.attachment),
      "higher",
    ),
    comparisonRow(
      "Open Weights",
      "Open weights available.",
      booleanCell(first.catalog?.openWeights),
      booleanCell(second.catalog?.openWeights),
      "higher",
    ),
  ]
}

function comparisonRow(
  label: string,
  description: string,
  first: ComparisonCell,
  second: ComparisonCell,
  direction: ComparisonDirection,
): ComparisonRow {
  return { label, description, direction, cells: [first, second] }
}

function bestCellIndex(row: ComparisonRow) {
  const [first, second] = row.cells.map((cell) => cell.score)
  if (first === undefined || second === undefined || first === second) return undefined
  if (row.direction === "higher") return first > second ? 0 : 1
  return first < second ? 0 : 1
}

function buildRelatedPairs(
  catalog: ModelCatalog | undefined,
  first: ComparisonModel,
  second: ComparisonModel,
): ComparisonPair[] {
  const current = [comparisonRef(first), comparisonRef(second)] as const
  const alternatives = (catalog?.models ?? [])
    .filter((model) => model.id !== first.catalog?.id && model.id !== second.catalog?.id)
    .slice(0, 4)
    .map(modelRefFromCatalog)

  return uniqueComparisonPairs([
    ...alternatives.slice(0, 3).flatMap((model, index) => [
      { first: current[0], second: model, detail: index === 0 ? "Nearby alternative" : "Related comparison" },
      { first: current[1], second: model, detail: index === 0 ? "Nearby alternative" : "Related comparison" },
    ]),
  ]).slice(0, 6)
}

function comparisonRef(model: ComparisonModel): ComparisonModelRef {
  return {
    name: model.name,
    lab: model.lab,
    slug: model.slug,
    labName: model.labName,
    metric: model.stats ? `#${model.stats.rank}` : "Catalog",
  }
}

function positiveScore(value: number | undefined) {
  return value && value > 0 ? value : undefined
}

function booleanCell(value: boolean | undefined): ComparisonCell {
  if (value === undefined) return { value: "Unknown" }
  return { value: value ? "Yes" : "No", score: value ? 1 : 0 }
}

function catalogDateScore(value: string | undefined) {
  if (!value) return undefined
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value)
  if (!match) return undefined
  return Date.UTC(Number(match[1]), match[2] ? Number(match[2]) - 1 : 0, match[3] ? Number(match[3]) : 1)
}

function formatParamName(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim()
}

function formatCatalogLimit(value: number | undefined) {
  return value === undefined ? "Unknown" : formatTokens(value)
}

function formatCatalogDate(value: string | undefined) {
  if (!value) return "Unknown"
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value)
  if (!match) return value
  const year = Number(match[1])
  const month = match[2] ? Number(match[2]) - 1 : 0
  const day = match[3] ? Number(match[3]) : 1
  return new Intl.DateTimeFormat("en", {
    month: match[2] ? "short" : undefined,
    day: match[3] ? "numeric" : undefined,
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, day)))
}

function formatTokens(value: number) {
  if (value >= 1_000_000_000_000)
    return `${trimNumber(value / 1_000_000_000_000, value >= 10_000_000_000_000 ? 0 : 1)}T`
  if (value >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000, value >= 10_000_000_000 ? 0 : 1)}B`
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${trimNumber(value / 1_000, value >= 10_000 ? 0 : 1)}K`
  return String(Math.round(value))
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en").format(value)
}

function formatPercent(value: number) {
  return `${trimNumber(value, value >= 10 ? 1 : 2)}%`
}

function formatMoney(value: number) {
  if (value >= 1) return `$${trimNumber(value, 2)}`
  if (value > 0) return `$${value.toFixed(4)}`
  return "$0"
}

function formatSessionCost(value: number) {
  if (value >= 1) return `$${trimNumber(value, 2)}`
  if (value >= 0.01) return `$${value.toFixed(2)}`
  if (value > 0) return `$${value.toFixed(4)}`
  return "$0"
}

function trimNumber(value: number, digits: number) {
  return Number(value.toFixed(digits)).toLocaleString("en")
}
