import "../index.css"
import { Link, Meta, Title } from "@solidjs/meta"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { geoEquirectangular, geoPath } from "d3-geo"
import { scaleSqrt } from "d3-scale"
import countryCodesSource from "i18n-iso-countries/codes.json?raw"
import { feature, mesh } from "topojson-client"
import countriesTopologySource from "world-atlas/countries-110m.json?raw"
import {
  getStatsModelData,
  type CountryEntry,
  type ModelPeerEntry,
  type ModelUsagePoint,
  type StatsModelData,
  type UsageRange,
} from "@opencode-ai/stats-core/domain/home"
import { runtime } from "@opencode-ai/stats-core/runtime"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import type { FeatureCollection, GeometryObject, GeoJsonProperties } from "geojson"
import type { GeometryCollection, Topology } from "topojson-specification"
import { findModelCatalogEntry, formatCatalogLabName, getModelCatalog, type ModelCatalogEntry } from "../model-catalog"
import {
  applyThemePreference,
  Footer,
  getGitHubStars,
  Header,
  isThemePreference,
  themeStorageKey,
  type HeaderLink,
  type ThemePreference,
} from "../stats-shell"

const statsModelFallbackUrl = "https://stats.opencode.ai"
const modelHeaderLinks: readonly HeaderLink[] = [
  { href: "#overview", label: "Overview" },
  { href: "#usage", label: "Usage" },
  { href: "#efficiency", label: "Efficiency" },
  { href: "#geo-breakdown", label: "Geo Breakdown" },
  { href: "#peers", label: "Peers" },
]
const modelFooterLinks: readonly HeaderLink[] = [
  { href: import.meta.env.BASE_URL, label: "Stats Home" },
  { href: `${import.meta.env.BASE_URL}#top-models`, label: "Top Models" },
  { href: `${import.meta.env.BASE_URL}#leaderboard`, label: "Leaderboard" },
  { href: `${import.meta.env.BASE_URL}#session-cost`, label: "Session Cost" },
  { href: `${import.meta.env.BASE_URL}#token-cost`, label: "Token Cost" },
  { href: `${import.meta.env.BASE_URL}#market-share`, label: "Market Share" },
  { href: `${import.meta.env.BASE_URL}#geo-breakdown`, label: "Geo Breakdown" },
]
const geoMapWidth = 960
const geoMapHeight = 430
const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" })

type IsoCountryCode = readonly [string, string, string]
type WorldCountryProperties = GeoJsonProperties & { name?: string }
type WorldTopology = Topology<{ countries: GeometryCollection<WorldCountryProperties> }>

const countryNumericIds = new Map(
  (JSON.parse(countryCodesSource) as IsoCountryCode[]).map((country) => [country[0], country[2]] as const),
)
const worldTopology = JSON.parse(countriesTopologySource) as WorldTopology
const worldCountryGeometries: GeometryCollection<WorldCountryProperties> = {
  ...worldTopology.objects.countries,
  geometries: worldTopology.objects.countries.geometries.filter((country) => String(country.id ?? "") !== "010"),
}
const worldCountries = feature<WorldCountryProperties>(worldTopology, worldCountryGeometries) as FeatureCollection<
  GeometryObject,
  WorldCountryProperties
>
const worldProjection = geoEquirectangular().fitExtent(
  [
    [10, 12],
    [geoMapWidth - 10, geoMapHeight - 12],
  ],
  worldCountries,
)
const worldPath = geoPath(worldProjection)
const worldCountryPaths = worldCountries.features.map((country) => ({
  id: String(country.id ?? "").padStart(3, "0"),
  path: worldPath(country) ?? "",
}))
const worldBorderPath = worldPath(mesh(worldTopology, worldCountryGeometries, (a, b) => a !== b)) ?? ""

const getModelData = query(async (lab: string, model: string) => {
  "use server"
  return runtime.runPromise(getStatsModelData(model, lab))
}, "getStatsModelData")

export default function StatsModel() {
  const event = getRequestEvent()
  event?.response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400")
  const params = useParams()
  const labParam = createMemo(() => params.lab ?? "")
  const modelParam = createMemo(() => params.model ?? "")
  const catalog = createAsync(() => getModelCatalog())
  const catalogEntry = createMemo(() => {
    const data = catalog()
    if (!data) return undefined
    return findModelCatalogEntry(data, modelParam(), labParam()) ?? null
  })
  const stats = createAsync(() => {
    const entry = catalogEntry()
    if (catalog() === undefined || entry === undefined) return Promise.resolve(undefined)
    if (!entry && (!labParam() || !modelParam())) return Promise.resolve(null)
    return getModelData(labParam(), entry?.slug ?? modelParam())
  })
  const githubStars = createAsync(() => getGitHubStars())
  const [themePreference, setThemePreference] = createSignal<ThemePreference>("system")
  const modelName = createMemo(() => catalogEntry()?.name ?? stats()?.model ?? modelParam() ?? "Model")
  const labName = createMemo(() => formatCatalogLabName(catalogEntry()?.lab ?? stats()?.provider ?? labParam()))
  const modelTitle = createMemo(() => `${modelName()} Stats`)
  const modelDescription = createMemo(() =>
    stats()
      ? `${modelName()} usage, rank, token mix, cost, geo breakdown, and peer stats across OpenCode.`
      : `${modelName()} model facts, limits, and OpenCode usage availability.`,
  )
  const modelUrl = createMemo(() =>
    new URL(
      `${import.meta.env.BASE_URL}${catalogEntry()?.id ?? `${labParam()}/${stats()?.slug ?? modelParam()}`}`,
      event?.request.url ?? (typeof window === "undefined" ? statsModelFallbackUrl : window.location.href),
    ).toString(),
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
      <Title>{modelTitle()}</Title>
      <Meta name="description" content={modelDescription()} />
      <Link rel="canonical" href={modelUrl()} />
      <Meta property="og:type" content="website" />
      <Meta property="og:site_name" content="OpenCode" />
      <Meta property="og:title" content={modelTitle()} />
      <Meta property="og:description" content={modelDescription()} />
      <Meta property="og:url" content={modelUrl()} />
      <Meta name="twitter:card" content="summary" />
      <Meta name="twitter:title" content={modelTitle()} />
      <Meta name="twitter:description" content={modelDescription()} />
      <Header githubStars={githubStars() ?? "150K"} links={modelHeaderLinks} brandHref={import.meta.env.BASE_URL} />
      <div data-component="container">
        <div data-component="content">
          <Show when={catalogEntry() || stats() !== undefined} fallback={<ModelLoading />}>
            <Show when={catalogEntry() || stats()} fallback={<ModelNotFound lab={labParam()} model={modelParam()} />}>
              <>
                <ModelHero data={stats() ?? null} catalog={catalogEntry() ?? null} labName={labName()} />
                <ModelOverview data={stats() ?? null} />
                <ModelUsageSection data={stats()?.usage ?? []} />
                <ModelEfficiencySection data={stats() ?? null} />
                <ModelGeoBreakdownSection data={stats()?.country ?? emptyCountryRecord()} />
                <ModelPeersSection data={stats() ?? null} />
              </>
            </Show>
          </Show>
        </div>
        <Footer
          themePreference={themePreference()}
          onThemePreferenceChange={updateThemePreference}
          links={modelFooterLinks}
        />
      </div>
    </main>
  )
}

function ModelLoading() {
  return (
    <>
      <section id="overview" data-section="model-hero">
        <div data-slot="model-hero-grid">
          <div data-slot="model-hero-copy">
            <a data-slot="model-back-link" href={import.meta.env.BASE_URL}>
              Stats
            </a>
            <h1>Model Stats</h1>
            <p>Reading model aggregates from model_stat.</p>
          </div>
        </div>
      </section>
      <section data-section="model-panel">
        <ModelEmptyState title="Loading model stats" description="Reading the model profile." />
      </section>
    </>
  )
}

function ModelNotFound(props: { lab: string; model: string }) {
  return (
    <>
      <section id="overview" data-section="model-hero">
        <div data-slot="model-hero-grid">
          <div data-slot="model-hero-copy">
            <a data-slot="model-back-link" href={import.meta.env.BASE_URL}>
              Stats
            </a>
            <h1>{props.model || "Model"}</h1>
            <p>No model facts or model_stat rows matched {props.lab ? `${props.lab}/${props.model}` : props.model}.</p>
          </div>
        </div>
      </section>
      <section data-section="model-panel">
        <ModelEmptyState title="No model data" description="Try opening a model from the leaderboard." />
      </section>
    </>
  )
}

function ModelHero(props: { data: StatsModelData | null; catalog: ModelCatalogEntry | null; labName: string }) {
  const labId = () => props.catalog?.lab ?? props.data?.provider ?? props.labName
  const modelId = () => props.catalog?.id ?? props.data?.model ?? "Model"
  const weights = () => props.catalog?.weights[0]
  return (
    <section id="overview" data-section="model-hero">
      <a data-slot="model-back-link" href={import.meta.env.BASE_URL}>
        Stats
      </a>
      <div data-slot="model-hero-grid">
        <div data-slot="model-hero-copy">
          <div data-slot="model-hero-tags">
            <a data-slot="hero-meta" href={`${import.meta.env.BASE_URL}${providerSlug(labId())}`}>
              <ProviderIcon aria-hidden="true" id={getProviderIconId(labId())} />
              <span>{props.labName}</span>
            </a>
            <span data-slot="model-id-tag">{modelId()}</span>
          </div>
          <h1>{props.catalog?.name ?? props.data?.model ?? "Model"}</h1>
          <Show
            when={props.data}
            fallback={
              <p>Model facts from the shared model index. OpenCode usage appears once this model has activity.</p>
            }
          >
            {(data) => (
              <p>
                Ranked #{data().rank} across recent OpenCode token usage with {formatPercent(data().tokenShare)} of
                observed volume.
              </p>
            )}
          </Show>
          <Show when={props.catalog?.openWeights && weights()}>
            {(weight) => (
              <a data-slot="model-weight-link" href={weight().url} target="_blank" rel="noopener noreferrer">
                Model weights: {weight().label}
              </a>
            )}
          </Show>
        </div>
        <Show when={props.data} fallback={<ModelCatalogCallout catalog={props.catalog} />}>
          {(data) => (
            <div data-component="model-rank-panel">
              <span>Current Rank</span>
              <strong>#{data().rank}</strong>
              <p>{formatRankMoveLabel(data().previousRank, data().rank)}</p>
            </div>
          )}
        </Show>
      </div>
      <div data-slot="model-hero-pattern" aria-hidden="true" />
      <Show when={props.catalog}>{(catalog) => <ModelCatalogPanel data={catalog()} />}</Show>
    </section>
  )
}

function ModelCatalogCallout(props: { catalog: ModelCatalogEntry | null }) {
  return (
    <div data-component="model-rank-panel">
      <span>Model Profile</span>
      <strong>{props.catalog?.releaseDate ? formatCatalogDate(props.catalog.releaseDate) : "Listed"}</strong>
      <p>No OpenCode usage in the current stats window.</p>
    </div>
  )
}

function ModelCatalogPanel(props: { data: ModelCatalogEntry }) {
  return (
    <aside data-component="model-catalog" aria-label="Model facts">
      <div data-slot="model-catalog-grid">
        <CatalogDatum label="Context" value={formatCatalogLimit(props.data.limit?.context)} />
        <CatalogDatum label="Output" value={formatCatalogLimit(props.data.limit?.output)} />
        <CatalogDatum label="Knowledge" value={formatCatalogDate(props.data.knowledge)} />
        <CatalogDatum label="Release" value={formatCatalogDate(props.data.releaseDate)} />
        <CatalogDatum label="Inputs" value={formatCatalogModalities(props.data.modalities.input)} />
      </div>
    </aside>
  )
}

function CatalogDatum(props: { label: string; value: string }) {
  return (
    <article data-component="model-catalog-datum">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  )
}

function ModelOverview(props: { data: StatsModelData | null }) {
  return (
    <section data-section="model-panel">
      <SectionTitle title="Overview" description="Recent tokens, sessions, and market position." />
      <Show
        when={props.data}
        fallback={<ModelEmptyState title="No usage summary" description="This model has no OpenCode usage rows yet." />}
      >
        {(data) => (
          <div data-component="model-metric-grid">
            <MetricCard label="Tokens" value={formatTokens(data().totals.tokens)} detail="last two months" />
            <MetricCard label="Sessions" value={formatInteger(data().totals.sessions)} detail="completed sessions" />
            <MetricCard
              label="Token Share"
              value={formatPercent(data().tokenShare)}
              detail={`${data().totalModels} models`}
            />
            <MetricCard
              label="Momentum"
              value={formatChange(data().tokenChange)}
              detail="vs previous window"
              state={data().tokenChange < 0 ? "negative" : "positive"}
            />
          </div>
        )}
      </Show>
    </section>
  )
}

function ModelUsageSection(props: { data: ModelUsagePoint[] }) {
  const [activeIndex, setActiveIndex] = createSignal<number>()
  const max = createMemo(() => Math.max(0, ...props.data.map((item) => item.tokens)) || 1)
  const activePoint = createMemo(() => {
    const index = activeIndex()
    if (index === undefined) return undefined
    return props.data[index]
  })

  return (
    <section id="usage" data-section="model-panel">
      <SectionTitle title="Usage" description="Daily token volume over the recent two-month window." />
      <Show
        when={props.data.some((item) => item.tokens > 0)}
        fallback={<ModelEmptyState title="No usage" description="No usage landed in the current window." />}
      >
        <div
          data-component="model-usage-chart"
          data-dense-labels={isModelUsageDense(props.data.length) ? "true" : undefined}
          role="img"
          aria-label="Daily token usage chart"
          style={{ "--model-usage-count": props.data.length } as JSX.CSSProperties}
          onPointerLeave={(event) => {
            if (event.pointerType === "touch") return
            setActiveIndex(undefined)
          }}
        >
          <div data-slot="model-usage-axis" aria-hidden="true">
            <For each={props.data}>
              {(point, index) => (
                <div
                  data-active={activeIndex() === index() ? "true" : undefined}
                  data-label-hidden={isModelUsageLabelHidden(index(), props.data.length) ? "true" : undefined}
                >
                  <span data-slot="model-usage-label">
                    <span data-slot="model-usage-total">{formatTokens(point.tokens)}</span>
                    <span data-slot="model-usage-date">{point.date}</span>
                  </span>
                </div>
              )}
            </For>
          </div>
          <div data-slot="model-usage-bars">
            <For each={props.data}>
              {(point, index) => (
                <div
                  data-slot="model-usage-column"
                  role="button"
                  tabIndex={0}
                  aria-label={`${point.date} ${formatTokens(point.tokens)} tokens`}
                  data-active={activeIndex() === index() ? "true" : undefined}
                  data-muted={activeIndex() !== undefined && activeIndex() !== index() ? "true" : undefined}
                  onPointerDown={(event) => {
                    if (event.pointerType !== "touch") return
                    setActiveIndex(index())
                  }}
                  onPointerEnter={() => setActiveIndex(index())}
                  onPointerMove={(event) => {
                    if (event.pointerType === "touch") return
                    setActiveIndex(index())
                  }}
                  onClick={() => setActiveIndex(index())}
                  onFocus={() => setActiveIndex(index())}
                  onBlur={() => setActiveIndex(undefined)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    setActiveIndex(index())
                  }}
                >
                  <div
                    data-slot="model-usage-bar"
                    style={{ "--model-usage-fill": `${modelUsageHeight(point.tokens, max())}%` } as JSX.CSSProperties}
                  />
                  <Show when={activeIndex() === index() && activePoint()}>
                    {(active) => (
                      <div
                        data-component="chart-tooltip"
                        data-placement={index() > props.data.length * 0.62 ? "left" : "right"}
                      >
                        <strong>{active().date}</strong>
                        <span>{formatTokens(active().tokens)} tokens</span>
                        <div data-slot="tooltip-divider" />
                        <p>
                          <span data-slot="tooltip-label">
                            <i /> Daily tokens
                          </span>
                          <b>{formatTokens(active().tokens)}</b>
                        </p>
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </section>
  )
}

function ModelEfficiencySection(props: { data: StatsModelData | null }) {
  return (
    <section id="efficiency" data-section="model-panel">
      <SectionTitle title="Efficiency" description="Cost, cache behavior, and average session shape." />
      <Show
        when={props.data}
        fallback={
          <ModelEmptyState title="No efficiency data" description="Cost and cache stats appear after usage lands." />
        }
      >
        {(data) => (
          <div data-component="model-metric-grid" data-variant="dense">
            <MetricCard label="Cost" value={formatMoney(data().totals.cost)} detail="total spend" />
            <MetricCard label="Cost / 1M" value={formatMoney(data().totals.costPerMillion)} detail="all tokens" />
            <MetricCard
              label="Cost / Session"
              value={formatSessionCost(data().totals.costPerSession)}
              detail="average"
            />
            <MetricCard
              label="Tokens / Session"
              value={formatTokens(data().totals.tokensPerSession)}
              detail="average"
            />
            <MetricCard label="Cache Ratio" value={formatPercent(data().totals.cacheRatio)} detail="input tokens" />
          </div>
        )}
      </Show>
    </section>
  )
}

function ModelGeoBreakdownSection(props: { data: Record<UsageRange, CountryEntry[]> }) {
  const [activeCountry, setActiveCountry] = createSignal<string>()
  const data = createMemo(() => props.data["2M"])
  const countryById = createMemo(
    () =>
      new Map(
        data().flatMap((country) => {
          const id = countryNumericId(country.country)
          return id ? [[id, country] as const] : []
        }),
      ),
  )
  const maxTokens = createMemo(() => Math.max(0, ...data().map((country) => country.tokens)) || 1)
  const topCountries = createMemo(() => data().slice(0, 15))
  const active = createMemo(() => data().find((country) => country.country === activeCountry()) ?? data()[0])

  return (
    <section
      id="geo-breakdown"
      data-section="geo-breakdown"
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return
        setActiveCountry(undefined)
      }}
    >
      <SectionTitle title="Geo Breakdown" description="Model tokens used by country." />
      <Show
        when={data().length > 0}
        fallback={<ModelEmptyState title="No geo data" description="No geo_stat rows matched this model." />}
      >
        <div data-component="geo-breakdown">
          <div data-slot="geo-map-panel">
            <GeoWorldMap
              countryById={countryById()}
              activeCountry={activeCountry()}
              maxTokens={maxTokens()}
              onActiveCountryChange={setActiveCountry}
            />
            <Show when={active()}>
              {(country) => (
                <div data-slot="geo-active-country">
                  <span>#{String(country().rank).padStart(2, "0")}</span>
                  <strong>{formatCountryName(country().country)}</strong>
                  <p>
                    <b>{formatGeoTokens(country().tokens)}</b>
                    <em>{formatGeoShare(country().share)}</em>
                  </p>
                </div>
              )}
            </Show>
          </div>
          <GeoCountryList
            data={topCountries()}
            activeCountry={activeCountry()}
            maxTokens={maxTokens()}
            onActiveCountryChange={setActiveCountry}
          />
        </div>
      </Show>
    </section>
  )
}

function GeoWorldMap(props: {
  countryById: Map<string, CountryEntry>
  activeCountry: string | undefined
  maxTokens: number
  onActiveCountryChange: (country: string | undefined) => void
}) {
  const opacityScale = createMemo(() => scaleSqrt().domain([0, props.maxTokens]).range([0.26, 0.96]).clamp(true))
  const countryOpacity = (country: CountryEntry | undefined) => {
    if (!country) return 0
    const opacity = opacityScale()(country.tokens)
    if (!props.activeCountry || props.activeCountry === country.country) return opacity
    return Math.max(0.18, opacity * 0.36)
  }

  return (
    <svg
      data-component="geo-world-map"
      viewBox={`0 0 ${geoMapWidth} ${geoMapHeight}`}
      role="img"
      aria-label="World map of model token usage by country"
    >
      <title>Geo Breakdown map</title>
      <g data-slot="geo-countries">
        <For each={worldCountryPaths}>
          {(country) => {
            const entry = () => props.countryById.get(country.id)
            return (
              <path
                d={country.path}
                data-has-data={entry() ? "true" : undefined}
                data-active={entry()?.country === props.activeCountry ? "true" : undefined}
                style={{ "--geo-country-opacity": String(countryOpacity(entry())) } as JSX.CSSProperties}
                aria-hidden="true"
                onPointerEnter={() => {
                  const item = entry()
                  if (!item) return
                  props.onActiveCountryChange(item.country)
                }}
                onClick={() => {
                  const item = entry()
                  if (!item) return
                  props.onActiveCountryChange(item.country)
                }}
              />
            )
          }}
        </For>
      </g>
      <path data-slot="geo-borders" d={worldBorderPath} aria-hidden="true" />
    </svg>
  )
}

function GeoCountryList(props: {
  data: CountryEntry[]
  activeCountry: string | undefined
  maxTokens: number
  onActiveCountryChange: (country: string | undefined) => void
}) {
  const opacityScale = createMemo(() => scaleSqrt().domain([0, props.maxTokens]).range([0.26, 0.96]).clamp(true))

  return (
    <ol data-component="geo-country-list">
      <For each={props.data}>
        {(country) => (
          <li>
            <button
              type="button"
              data-active={props.activeCountry === country.country ? "true" : undefined}
              style={{ "--geo-row-opacity": String(opacityScale()(country.tokens)) } as JSX.CSSProperties}
              aria-label={`${formatCountryName(country.country)} ${formatGeoTokens(country.tokens)} ${formatGeoShare(
                country.share,
              )}`}
              onClick={() => props.onActiveCountryChange(country.country)}
              onPointerEnter={() => props.onActiveCountryChange(country.country)}
              onFocus={() => props.onActiveCountryChange(country.country)}
            >
              <span>{String(country.rank).padStart(2, "0")}</span>
              <i />
              <strong>{formatCountryName(country.country)}</strong>
              <em>{formatGeoTokens(country.tokens)}</em>
              <b>{formatGeoShare(country.share)}</b>
            </button>
          </li>
        )}
      </For>
    </ol>
  )
}

function ModelPeersSection(props: { data: StatsModelData | null }) {
  return (
    <section id="peers" data-section="model-panel">
      <SectionTitle title="Peers" description="Nearby models by recent token volume." />
      <Show
        when={props.data?.peers.length}
        fallback={<ModelEmptyState title="No peers" description="Peer rankings appear after usage lands." />}
      >
        <ol data-component="model-peer-list">
          <For each={props.data?.peers ?? []}>
            {(peer) => <PeerRow peer={peer} active={peer.model === props.data?.model} />}
          </For>
        </ol>
      </Show>
    </section>
  )
}

function MetricCard(props: { label: string; value: string; detail: string; state?: "positive" | "negative" }) {
  return (
    <article data-component="model-metric" data-state={props.state}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </article>
  )
}

function PeerRow(props: { peer: ModelPeerEntry; active: boolean }) {
  return (
    <li>
      <a
        href={`${import.meta.env.BASE_URL}${providerSlug(props.peer.provider)}/${props.peer.slug}`}
        data-active={props.active ? "true" : undefined}
      >
        <span>{String(props.peer.rank).padStart(2, "0")}</span>
        <ProviderIcon aria-hidden="true" id={getProviderIconId(props.peer.author)} />
        <strong>{props.peer.model}</strong>
        <em>{props.peer.author}</em>
        <b>{formatTokens(props.peer.tokens)}</b>
      </a>
    </li>
  )
}

function SectionTitle(props: { title: string; description: string }) {
  return (
    <p data-slot="section-title">
      <strong>{props.title}.</strong> <span>{props.description}</span>
    </p>
  )
}

function ModelEmptyState(props: { title: string; description: string; compact?: boolean }) {
  return (
    <div data-component="empty-state" data-compact={props.compact ? "true" : undefined}>
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  )
}

function getProviderIconId(author: string) {
  if (author === "MiniMax") return "minimax"
  if (author === "Moonshot") return "moonshotai"
  if (author === "Zhipu") return "zhipuai"
  return author.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function emptyCountryRecord(): Record<UsageRange, CountryEntry[]> {
  return {
    "1D": [],
    "1W": [],
    "2W": [],
    "1M": [],
    "2M": [],
    "3M": [],
    YTD: [],
    ALL: [],
  }
}

function countryNumericId(country: string) {
  return countryNumericIds.get(country.toUpperCase())?.padStart(3, "0")
}

function formatCountryName(country: string) {
  const code = country.toUpperCase()
  if (code === "ZZ") return "Unknown"
  if (!countryNumericId(code)) return code
  return countryDisplayNames.of(code) ?? code
}

function formatGeoTokens(value: number) {
  return formatTokens(value * 1_000_000_000_000)
}

function formatGeoShare(value: number) {
  return `${value.toFixed(value > 0 && value < 1 ? 1 : 0)}%`
}

function modelUsageHeight(tokens: number, max: number) {
  if (tokens <= 0) return 0
  return Math.max(2, Math.min(100, (tokens / max) * 100))
}

function isModelUsageDense(count: number) {
  return count > 20
}

function isModelUsageLabelHidden(index: number, count: number) {
  if (count <= 16) return false
  const interval = Math.ceil(count / 8)
  return index !== count - 1 && index % interval !== 0
}

function formatRankMove(previousRank: number, rank: number) {
  const change = previousRank - rank
  if (change > 0) return `+${change}`
  if (change < 0) return `${change}`
  return "Even"
}

function formatRankMoveLabel(previousRank: number | null, rank: number) {
  return previousRank === null ? "New in window" : `${formatRankMove(previousRank, rank)} vs previous window`
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
  return `${value.toFixed(value > 0 && value < 10 ? 1 : 0)}%`
}

function formatMoney(value: number) {
  if (value >= 1_000_000) return `$${trimNumber(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `$${trimNumber(value / 1_000, value >= 10_000 ? 0 : 1)}K`
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`
}

function formatSessionCost(value: number) {
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`
}

function formatChange(value: number) {
  if (value > 0) return `+${value}%`
  return `${value}%`
}

function formatCatalogLimit(value: number | undefined) {
  return value === undefined ? "Unknown" : formatTokens(value)
}

function formatCatalogModalities(value: string[]) {
  if (value.length === 0) return "Unknown"
  return value.map(formatCatalogModality).join(", ")
}

function formatCatalogModality(value: string) {
  if (value === "pdf") return "PDF"
  return value.charAt(0).toUpperCase() + value.slice(1)
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

function trimNumber(value: number, digits: number) {
  return Number(value.toFixed(digits)).toLocaleString("en")
}

function providerSlug(provider: string) {
  return provider
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
}
