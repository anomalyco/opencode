import "../index.css"
import { Meta, Title } from "@solidjs/meta"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { geoEquirectangular, geoPath } from "d3-geo"
import { scaleSqrt } from "d3-scale"
import countryCodesSource from "i18n-iso-countries/codes.json?raw"
import { feature, mesh } from "topojson-client"
import countriesTopologySource from "world-atlas/countries-50m.json?raw"
import {
  getStatsModelData,
  type CountryEntry,
  type ModelPeerEntry,
  type ModelUsagePoint,
  type StatsModelData,
  type UsageRange,
} from "@opencode-ai/stats-core/domain/home"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import type { FeatureCollection, GeometryObject, GeoJsonProperties } from "geojson"
import type { GeometryCollection, Topology } from "topojson-specification"
import { LocaleLinks } from "../../component/locale-links"
import { useI18n } from "../../context/i18n"
import { useLanguage } from "../../context/language"
import { localizedUrl } from "../../lib/language"
import {
  findModelCatalogEntry,
  formatCatalogLabName,
  getModelCatalog,
  type ModelCatalogCost,
  type ModelCatalogEntry,
} from "../model-catalog"
import { SectionHeading } from "../section-heading"
import { runStatsEffect } from "../../stats-runtime"
import { setStatsPageCacheHeaders } from "../stats-cache"
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

const statsUnfurlPath = "banner.png"
const geoMapWidth = 960
const geoMapHeight = 430

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
  marker: geoCountryMarker(country),
}))
const worldBorderPath = worldPath(mesh(worldTopology, worldCountryGeometries, (a, b) => a !== b)) ?? ""

const getModelData = query(async (lab: string, model: string) => {
  "use server"
  return runStatsEffect(getStatsModelData(model, lab))
}, "getStatsModelData")

export default function StatsModel() {
  const i18n = useI18n()
  const language = useLanguage()
  const event = getRequestEvent()
  setStatsPageCacheHeaders(event?.response.headers)
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
  const modelName = createMemo(() => catalogEntry()?.name ?? stats()?.model ?? modelParam() ?? i18n.t("model.fallback"))
  const labName = createMemo(() => formatCatalogLabName(catalogEntry()?.lab ?? stats()?.provider ?? labParam()))
  const modelTitle = createMemo(() => i18n.t("model.title", { model: modelName() }))
  const modelDescription = createMemo(() => i18n.t("model.description", { model: modelName() }))
  const modelPath = createMemo(
    () =>
      `/data/${catalogEntry()?.id ?? [labParam(), stats()?.slug ?? modelParam()].filter((part) => part.length > 0).join("/")}`,
  )
  const modelUrl = createMemo(() => localizedUrl(language.locale(), modelPath()))
  const statsUnfurlUrl = new URL(statsUnfurlPath, localizedUrl("en", "/data/")).toString()
  const modelHeaderLinks = createMemo<readonly HeaderLink[]>(() => [
    { href: "#overview", label: i18n.t("nav.overview") },
    { href: "#usage", label: i18n.t("nav.usage") },
    { href: "#users", label: i18n.t("nav.users") },
    { href: "#efficiency", label: i18n.t("nav.efficiency") },
    { href: "#geo-breakdown", label: i18n.t("nav.geoBreakdown") },
    { href: "#peers", label: i18n.t("nav.peers") },
  ])
  const modelFooterLinks = createMemo<readonly HeaderLink[]>(() => [
    { href: import.meta.env.BASE_URL, label: i18n.t("nav.dataHome") },
    { href: `${import.meta.env.BASE_URL}#top-models`, label: i18n.t("nav.topModels") },
    { href: `${import.meta.env.BASE_URL}#session-cost`, label: i18n.t("nav.sessionCost") },
    { href: `${import.meta.env.BASE_URL}#token-cost`, label: i18n.t("nav.tokenCost") },
    { href: `${import.meta.env.BASE_URL}#cache-ratio`, label: i18n.t("nav.cacheRatio") },
    { href: `${import.meta.env.BASE_URL}#market-share`, label: i18n.t("nav.marketShare") },
    { href: `${import.meta.env.BASE_URL}#geo-breakdown`, label: i18n.t("nav.geoBreakdown") },
  ])
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
      <LocaleLinks path={modelPath()} />
      <Meta property="og:type" content="website" />
      <Meta property="og:site_name" content="OpenCode" />
      <Meta property="og:title" content={modelTitle()} />
      <Meta property="og:description" content={modelDescription()} />
      <Meta property="og:url" content={modelUrl()} />
      <Meta property="og:image" content={statsUnfurlUrl} />
      <Meta property="og:image:type" content="image/png" />
      <Meta property="og:image:width" content="1200" />
      <Meta property="og:image:height" content="630" />
      <Meta property="og:image:alt" content={i18n.t("app.unfurlAlt")} />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={modelTitle()} />
      <Meta name="twitter:description" content={modelDescription()} />
      <Meta name="twitter:image" content={statsUnfurlUrl} />
      <Meta name="twitter:image:alt" content={i18n.t("app.unfurlAlt")} />
      <Header githubStars={githubStars() ?? "150K"} links={modelHeaderLinks()} brandHref={import.meta.env.BASE_URL} />
      <div data-component="container">
        <div data-component="content">
          <Show when={catalogEntry() || stats() !== undefined} fallback={<ModelLoading />}>
            <Show when={catalogEntry() || stats()} fallback={<ModelNotFound lab={labParam()} model={modelParam()} />}>
              <>
                <ModelHero data={stats() ?? null} catalog={catalogEntry() ?? null} labName={labName()} />
                <ModelOverview data={stats() ?? null} />
                <ModelUsageSection data={stats()?.usage ?? []} />
                <ModelUsersSection data={stats()?.usage ?? []} />
                <ModelEfficiencySection data={stats() ?? null} catalog={catalogEntry() ?? null} />
                <ModelGeoBreakdownSection data={stats()?.country ?? emptyCountryRecord()} />
                <ModelPeersSection data={stats() ?? null} />
              </>
            </Show>
          </Show>
        </div>
        <Footer
          themePreference={themePreference()}
          onThemePreferenceChange={updateThemePreference}
          links={modelFooterLinks()}
        />
      </div>
    </main>
  )
}

function ModelLoading() {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <>
      <section id="overview" data-section="model-hero">
        <div data-slot="model-hero-grid">
          <div data-slot="model-hero-copy">
            <a data-slot="model-back-link" href={language.route(import.meta.env.BASE_URL)}>
              {i18n.t("footer.modelData")}
            </a>
            <h1>
              <a data-slot="heading-link" href="#overview">
                {i18n.t("model.loadingTitle")}
              </a>
            </h1>
            <p>{i18n.t("model.loadingDescription")}</p>
          </div>
        </div>
      </section>
      <section data-section="model-panel">
        <ModelEmptyState title={i18n.t("model.loadingTitle")} description={i18n.t("model.loadingProfile")} />
      </section>
    </>
  )
}

function ModelNotFound(props: { lab: string; model: string }) {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <>
      <section id="overview" data-section="model-hero">
        <div data-slot="model-hero-grid">
          <div data-slot="model-hero-copy">
            <a data-slot="model-back-link" href={language.route(import.meta.env.BASE_URL)}>
              {i18n.t("footer.modelData")}
            </a>
            <h1>
              <a data-slot="heading-link" href="#overview">
                {props.model || i18n.t("model.fallback")}
              </a>
            </h1>
            <p>{i18n.t("model.noMatched", { id: props.lab ? `${props.lab}/${props.model}` : props.model })}</p>
          </div>
        </div>
      </section>
      <section data-section="model-panel">
        <ModelEmptyState title={i18n.t("model.noDataTitle")} description={i18n.t("model.noDataDescription")} />
      </section>
    </>
  )
}

function ModelHero(props: { data: StatsModelData | null; catalog: ModelCatalogEntry | null; labName: string }) {
  const i18n = useI18n()
  const language = useLanguage()
  const labId = () => props.catalog?.lab ?? props.data?.provider ?? props.labName
  const modelId = () => props.catalog?.id ?? props.data?.model ?? i18n.t("model.fallback")
  const weights = () => props.catalog?.weights[0]
  return (
    <section id="overview" data-section="model-hero">
      <a data-slot="model-back-link" href={language.route(import.meta.env.BASE_URL)}>
        {i18n.t("footer.modelData")}
      </a>
      <div data-slot="model-hero-grid">
        <div data-slot="model-hero-copy">
          <div data-slot="model-hero-tags">
            <a data-slot="hero-meta" href={language.route(`${import.meta.env.BASE_URL}${providerSlug(labId())}`)}>
              <ProviderIcon aria-hidden="true" id={getProviderIconId(labId())} />
              <span>{props.labName}</span>
            </a>
            <span data-slot="model-id-tag">{modelId()}</span>
          </div>
          <h1>
            <a data-slot="heading-link" href="#overview">
              {props.catalog?.name ?? props.data?.model ?? i18n.t("model.fallback")}
            </a>
          </h1>
          <Show when={props.data} fallback={<p>{i18n.t("model.catalogFallback")}</p>}>
            {(data) => (
              <p>
                {data().rank === null ? i18n.t("model.unranked") : i18n.t("model.ranked", { rank: data().rank ?? "" })}{" "}
                {i18n.t("model.observedVolume", { share: formatPercent(data().tokenShare) })}
              </p>
            )}
          </Show>
          <Show when={props.catalog?.openWeights && weights()}>
            {(weight) => (
              <a data-slot="model-weight-link" href={weight().url} target="_blank" rel="noopener noreferrer">
                {i18n.t("model.weights", { label: weight().label })}
              </a>
            )}
          </Show>
        </div>
        <Show when={props.data} fallback={<ModelCatalogCallout catalog={props.catalog} />}>
          {(data) => (
            <div data-component="model-rank-panel">
              <span>{i18n.t("model.rank")}</span>
              <strong>{data().rank === null ? "—" : `#${data().rank}`}</strong>
              <p>{formatModelRankMoveLabel(data(), i18n)}</p>
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
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <div data-component="model-rank-panel">
      <span>{i18n.t("model.profile")}</span>
      <strong>
        {props.catalog?.releaseDate
          ? formatCatalogDate(props.catalog.releaseDate, language.tag(language.locale()), i18n.t("home.unknown"))
          : i18n.t("model.listed")}
      </strong>
      <p>{i18n.t("model.noCurrentUsage")}</p>
    </div>
  )
}

function ModelCatalogPanel(props: { data: ModelCatalogEntry }) {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <aside data-component="model-catalog" aria-label={i18n.t("model.facts")}>
      <div data-slot="model-catalog-grid">
        <CatalogDatum
          label={i18n.t("model.context")}
          value={formatCatalogLimit(props.data.limit?.context, i18n.t("home.unknown"))}
        />
        <CatalogDatum
          label={i18n.t("model.output")}
          value={formatCatalogLimit(props.data.limit?.output, i18n.t("home.unknown"))}
        />
        <CatalogDatum
          label={i18n.t("model.knowledge")}
          value={formatCatalogDate(props.data.knowledge, language.tag(language.locale()), i18n.t("home.unknown"))}
        />
        <CatalogDatum
          label={i18n.t("model.release")}
          value={formatCatalogDate(props.data.releaseDate, language.tag(language.locale()), i18n.t("home.unknown"))}
        />
        <CatalogDatum
          label={i18n.t("model.inputs")}
          value={formatCatalogModalities(props.data.modalities.input, i18n)}
        />
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
  const i18n = useI18n()
  return (
    <section id="model-overview" data-section="model-panel">
      <SectionTitle
        href="#model-overview"
        title={i18n.t("nav.overview")}
        description={i18n.t("model.overviewDescription")}
      />
      <Show
        when={props.data}
        fallback={
          <ModelEmptyState title={i18n.t("model.noSummaryTitle")} description={i18n.t("model.noSummaryDescription")} />
        }
      >
        {(data) => (
          <div data-component="model-metric-grid">
            <MetricCard
              label={i18n.t("model.tokens")}
              value={formatTokens(data().totals.tokens)}
              detail={i18n.t("model.lastTwoMonths")}
            />
            <MetricCard
              label={i18n.t("model.uniqueUsers")}
              value={formatUsers(data().totals.uniqueUsers)}
              detail={i18n.t("model.lastTwoMonths")}
            />
            <MetricCard
              label={i18n.t("model.sessions")}
              value={formatInteger(data().totals.sessions)}
              detail={i18n.t("model.completedSessions")}
            />
            <MetricCard
              label={i18n.t("model.tokenShare")}
              value={formatPercent(data().tokenShare)}
              detail={i18n.t("model.totalModels", { count: data().totalModels })}
            />
            <MetricCard
              label={i18n.t("model.momentum")}
              value={formatChange(data().tokenChange)}
              detail={i18n.t("model.vsPreviousWindow")}
              state={data().tokenChange < 0 ? "negative" : "positive"}
            />
          </div>
        )}
      </Show>
    </section>
  )
}

function ModelUsageSection(props: { data: ModelUsagePoint[] }) {
  const i18n = useI18n()
  return (
    <section id="usage" data-section="model-panel">
      <SectionTitle href="#usage" title={i18n.t("nav.usage")} description={i18n.t("model.usageDescription")} />
      <Show
        when={props.data.some((item) => item.tokens > 0)}
        fallback={
          <ModelEmptyState title={i18n.t("model.noUsageTitle")} description={i18n.t("model.noUsageDescription")} />
        }
      >
        <ModelColumnChart data={props.data} metric="tokens" ariaLabel={i18n.t("model.dailyTokenChart")} />
      </Show>
    </section>
  )
}

function ModelUsersSection(props: { data: ModelUsagePoint[] }) {
  const i18n = useI18n()
  return (
    <section id="users" data-section="model-panel">
      <SectionTitle href="#users" title={i18n.t("model.uniqueUsers")} description={i18n.t("model.usersDescription")} />
      <Show
        when={props.data.some((item) => item.users > 0)}
        fallback={
          <ModelEmptyState title={i18n.t("model.noUsersTitle")} description={i18n.t("model.noUsersDescription")} />
        }
      >
        <ModelColumnChart data={props.data} metric="users" ariaLabel={i18n.t("model.dailyUserChart")} />
      </Show>
    </section>
  )
}

function ModelColumnChart(props: { data: ModelUsagePoint[]; metric: "tokens" | "users"; ariaLabel: string }) {
  const i18n = useI18n()
  const [activeIndex, setActiveIndex] = createSignal<number>()
  const max = createMemo(() => Math.max(0, ...props.data.map((item) => modelUsageMetricValue(item, props.metric))) || 1)
  const activePoint = createMemo(() => {
    const index = activeIndex()
    if (index === undefined) return undefined
    return props.data[index]
  })

  return (
    <div
      data-component="model-usage-chart"
      data-metric={props.metric}
      data-dense-labels={isModelUsageDense(props.data.length) ? "true" : undefined}
      role="img"
      aria-label={props.ariaLabel}
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
                <span data-slot="model-usage-total">{formatModelUsageValue(point, props.metric)}</span>
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
              aria-label={`${point.date} ${formatModelUsageValue(point, props.metric)} ${modelUsageLabel(props.metric, i18n)}`}
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
                style={
                  {
                    "--model-usage-fill": `${modelUsageHeight(modelUsageMetricValue(point, props.metric), max())}%`,
                  } as JSX.CSSProperties
                }
              />
              <Show when={activeIndex() === index() && activePoint()}>
                {(active) => (
                  <div
                    data-component="chart-tooltip"
                    data-placement={index() > props.data.length * 0.62 ? "left" : "right"}
                  >
                    <strong>{active().date}</strong>
                    <span>
                      {formatModelUsageValue(active(), props.metric)} {modelUsageLabel(props.metric, i18n)}
                    </span>
                    <div data-slot="tooltip-divider" />
                    <p>
                      <span data-slot="tooltip-label">
                        <i /> {i18n.t("chart.daily")} {modelUsageLabel(props.metric, i18n)}
                      </span>
                      <b>{formatModelUsageValue(active(), props.metric)}</b>
                    </p>
                  </div>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function modelUsageMetricValue(point: ModelUsagePoint, metric: "tokens" | "users") {
  if (metric === "users") return point.users
  return point.tokens
}

function formatModelUsageValue(point: ModelUsagePoint, metric: "tokens" | "users") {
  if (metric === "users") return formatUsers(point.users)
  return formatTokens(point.tokens)
}

function modelUsageLabel(metric: "tokens" | "users", i18n: ReturnType<typeof useI18n>) {
  if (metric === "users") return i18n.t("format.users")
  return i18n.t("format.tokens")
}

function ModelEfficiencySection(props: { data: StatsModelData | null; catalog: ModelCatalogEntry | null }) {
  const i18n = useI18n()
  return (
    <section id="efficiency" data-section="model-panel">
      <SectionTitle
        href="#efficiency"
        title={i18n.t("nav.efficiency")}
        description={i18n.t("model.efficiencyDescription")}
      />
      <Show
        when={props.data}
        fallback={
          <ModelEmptyState
            title={i18n.t("model.noEfficiencyTitle")}
            description={i18n.t("model.noEfficiencyDescription")}
          />
        }
      >
        {(data) => (
          <div data-component="model-metric-grid" data-variant="dense">
            <MetricCard
              label={i18n.t("model.cost")}
              value={formatMoney(data().totals.cost)}
              detail={i18n.t("model.totalSpend")}
            />
            <MetricCard
              label={i18n.t("model.costPerMillion")}
              value={
                props.catalog?.cost ? formatCatalogPrice(props.catalog.cost) : formatMoney(data().totals.costPerMillion)
              }
              detail={props.catalog?.cost ? i18n.t("model.inputOutput") : i18n.t("model.observedTokens")}
            />
            <MetricCard
              label={i18n.t("model.costSession")}
              value={formatSessionCost(data().totals.costPerSession)}
              detail={i18n.t("model.average")}
            />
            <MetricCard
              label={i18n.t("model.tokensSession")}
              value={formatTokens(data().totals.tokensPerSession)}
              detail={i18n.t("model.average")}
            />
            <MetricCard
              label={i18n.t("model.cacheRatio")}
              value={formatPercent(data().totals.cacheRatio)}
              detail={i18n.t("model.inputTokens")}
            />
          </div>
        )}
      </Show>
    </section>
  )
}

function ModelGeoBreakdownSection(props: { data: Record<UsageRange, CountryEntry[]> }) {
  const i18n = useI18n()
  const language = useLanguage()
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
      <SectionTitle
        href="#geo-breakdown"
        title={i18n.t("nav.geoBreakdown")}
        description={i18n.t("model.geoDescription")}
      />
      <Show
        when={data().length > 0}
        fallback={<ModelEmptyState title={i18n.t("model.noGeoTitle")} description={i18n.t("model.noGeoDescription")} />}
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
                  <strong>{formatCountryName(country().country, language.tag(language.locale()), i18n)}</strong>
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
  const i18n = useI18n()
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
      aria-label={i18n.t("model.worldMap")}
    >
      <title>{i18n.t("home.geoMapTitle")}</title>
      <g data-slot="geo-countries">
        <For each={worldCountryPaths}>
          {(country) => {
            const entry = () => props.countryById.get(country.id)
            return (
              <path
                d={country.path}
                data-country-id={country.id}
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
      <g data-slot="geo-country-markers">
        <For each={worldCountryPaths}>
          {(country) => {
            const entry = () => props.countryById.get(country.id)
            return (
              <Show when={country.marker && entry() ? country.marker : undefined}>
                {(marker) => (
                  <circle
                    cx={marker().x}
                    cy={marker().y}
                    r={entry()?.country === props.activeCountry ? 3.4 : 2.4}
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
                )}
              </Show>
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
  const i18n = useI18n()
  const language = useLanguage()
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
              aria-label={`${formatCountryName(country.country, language.tag(language.locale()), i18n)} ${formatGeoTokens(country.tokens)} ${formatGeoShare(country.share)}`}
              onClick={() => props.onActiveCountryChange(country.country)}
              onPointerEnter={() => props.onActiveCountryChange(country.country)}
              onFocus={() => props.onActiveCountryChange(country.country)}
            >
              <span>{String(country.rank).padStart(2, "0")}</span>
              <i />
              <strong>{formatCountryName(country.country, language.tag(language.locale()), i18n)}</strong>
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
  const i18n = useI18n()
  return (
    <section id="peers" data-section="model-panel">
      <SectionTitle href="#peers" title={i18n.t("nav.peers")} description={i18n.t("model.peersDescription")} />
      <Show
        when={props.data?.peers.length}
        fallback={
          <ModelEmptyState title={i18n.t("model.noPeersTitle")} description={i18n.t("model.noPeersDescription")} />
        }
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
  const language = useLanguage()
  return (
    <li>
      <a
        href={language.route(`${import.meta.env.BASE_URL}${providerSlug(props.peer.provider)}/${props.peer.slug}`)}
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

function SectionTitle(props: { href: string; title: string; description: string }) {
  return <SectionHeading href={props.href} title={props.title} description={props.description} />
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

function geoCountryMarker(country: (typeof worldCountries.features)[number]) {
  const bounds = worldPath.bounds(country)
  const [x, y] = worldPath.centroid(country)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  if (bounds[1][0] - bounds[0][0] >= 3 && bounds[1][1] - bounds[0][1] >= 3) return undefined
  return { x, y }
}

function formatCountryName(country: string, locale: string, i18n: ReturnType<typeof useI18n>) {
  const code = country.toUpperCase()
  if (code === "ZZ") return i18n.t("home.unknown")
  if (!countryNumericId(code)) return code
  return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code
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

function formatRankMove(change: number) {
  if (change > 0) return `+${change}`
  return `${change}`
}

function formatModelRankMoveLabel(data: StatsModelData, i18n: ReturnType<typeof useI18n>) {
  if (data.rank === null) return i18n.t("model.noUsageLastWeek")
  if (data.previousRank === null) return i18n.t("model.newThisWeek")
  const change = data.previousRank - data.rank
  if (change === 0) return i18n.t("model.sameAsPreviousWeek")
  return i18n.t("model.vsPreviousWeek", { change: formatRankMove(change) })
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

function formatUsers(value: number) {
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${trimNumber(value / 1_000, value >= 10_000 ? 0 : 1)}K`
  return formatInteger(Math.round(value))
}

function formatPercent(value: number) {
  return `${value.toFixed(value > 0 && value < 10 ? 1 : 0)}%`
}

function formatMoney(value: number) {
  if (value >= 1_000_000) return `$${trimNumber(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `$${trimNumber(value / 1_000, value >= 10_000 ? 0 : 1)}K`
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`
}

function formatCatalogPrice(value: ModelCatalogCost) {
  return `${formatModelPrice(value.input)} / ${formatModelPrice(value.output)}`
}

function formatModelPrice(value: number) {
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`
  return formatMoney(value)
}

function formatSessionCost(value: number) {
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`
}

function formatChange(value: number) {
  if (value > 0) return `+${value}%`
  return `${value}%`
}

function formatCatalogLimit(value: number | undefined, unknown: string) {
  return value === undefined ? unknown : formatTokens(value)
}

function formatCatalogModalities(value: string[], i18n: ReturnType<typeof useI18n>) {
  if (value.length === 0) return i18n.t("home.unknown")
  return value.map((item) => formatCatalogModality(item, i18n)).join(", ")
}

function formatCatalogModality(value: string, i18n: ReturnType<typeof useI18n>) {
  if (value === "pdf") return i18n.t("model.pdf")
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatCatalogDate(value: string | undefined, locale: string, unknown: string) {
  if (!value) return unknown
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value)
  if (!match) return value
  const year = Number(match[1])
  const month = match[2] ? Number(match[2]) - 1 : 0
  const day = match[3] ? Number(match[3]) : 1
  return new Intl.DateTimeFormat(locale, {
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
