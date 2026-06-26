import "../index.css"
import { Meta, Title } from "@solidjs/meta"
import {
  getStatsLabData,
  type LabUsageModelEntry,
  type ModelUsagePoint,
  type StatsLabData,
} from "@opencode-ai/stats-core/domain/home"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { LocaleLinks } from "../../component/locale-links"
import { useI18n } from "../../context/i18n"
import { useLanguage } from "../../context/language"
import { localizedUrl } from "../../lib/language"
import {
  findModelCatalogLab,
  formatCatalogLabName,
  getModelCatalog,
  type ModelCatalogEntry,
  type ModelCatalogLab,
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

const getLabData = query(async (lab: string) => {
  "use server"
  return runStatsEffect(getStatsLabData(lab))
}, "getStatsLabData")

export default function StatsLab() {
  const i18n = useI18n()
  const language = useLanguage()
  const event = getRequestEvent()
  setStatsPageCacheHeaders(event?.response.headers)
  const params = useParams()
  const labParam = createMemo(() => params.lab ?? "")
  const catalog = createAsync(() => getModelCatalog())
  const lab = createMemo(() => {
    const data = catalog()
    if (!data) return undefined
    return findModelCatalogLab(data, labParam()) ?? null
  })
  const stats = createAsync(() => {
    const entry = lab()
    if (catalog() === undefined || entry === undefined) return Promise.resolve(undefined)
    if (!entry) return Promise.resolve(null)
    return getLabData(entry.id)
  })
  const githubStars = createAsync(() => getGitHubStars())
  const [themePreference, setThemePreference] = createSignal<ThemePreference>("system")
  const labName = createMemo(() => lab()?.name ?? formatCatalogLabName(labParam()))
  const labTitle = createMemo(() => i18n.t("lab.title", { lab: labName() }))
  const labDescription = createMemo(() => i18n.t("lab.description", { lab: labName() }))
  const labPath = createMemo(() => `/data/${lab()?.id ?? labParam()}`)
  const labUrl = createMemo(() => localizedUrl(language.locale(), labPath()))
  const statsUnfurlUrl = new URL(statsUnfurlPath, localizedUrl("en", "/data/")).toString()
  const labHeaderLinks = createMemo<readonly HeaderLink[]>(() => [
    { href: "#overview", label: i18n.t("nav.overview") },
    { href: "#usage", label: i18n.t("nav.usage") },
    { href: "#models", label: i18n.t("nav.models") },
  ])
  const labFooterLinks = createMemo<readonly HeaderLink[]>(() => [
    { href: import.meta.env.BASE_URL, label: i18n.t("nav.dataHome") },
    { href: `${import.meta.env.BASE_URL}#top-models`, label: i18n.t("nav.topModels") },
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
      <Title>{labTitle()}</Title>
      <Meta name="description" content={labDescription()} />
      <LocaleLinks path={labPath()} />
      <Meta property="og:type" content="website" />
      <Meta property="og:site_name" content="OpenCode" />
      <Meta property="og:title" content={labTitle()} />
      <Meta property="og:description" content={labDescription()} />
      <Meta property="og:url" content={labUrl()} />
      <Meta property="og:image" content={statsUnfurlUrl} />
      <Meta property="og:image:type" content="image/png" />
      <Meta property="og:image:width" content="1200" />
      <Meta property="og:image:height" content="630" />
      <Meta property="og:image:alt" content={i18n.t("app.unfurlAlt")} />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={labTitle()} />
      <Meta name="twitter:description" content={labDescription()} />
      <Meta name="twitter:image" content={statsUnfurlUrl} />
      <Meta name="twitter:image:alt" content={i18n.t("app.unfurlAlt")} />
      <Header githubStars={githubStars() ?? "150K"} links={labHeaderLinks()} brandHref={import.meta.env.BASE_URL} />
      <div data-component="container">
        <div data-component="content">
          <Show when={catalog() !== undefined} fallback={<LabLoading />}>
            <Show when={lab()} fallback={<LabNotFound lab={labParam()} />}>
              {(data) => (
                <>
                  <LabHero lab={data()} stats={stats() ?? null} />
                  <LabUsageSection lab={data()} data={stats() ?? null} />
                  <LabModelsSection lab={data()} usage={stats()?.models ?? []} />
                </>
              )}
            </Show>
          </Show>
        </div>
        <Footer
          themePreference={themePreference()}
          onThemePreferenceChange={updateThemePreference}
          links={labFooterLinks()}
        />
      </div>
    </main>
  )
}

function LabLoading() {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <section id="overview" data-section="lab-hero">
      <div data-slot="model-hero-grid">
        <div data-slot="model-hero-copy">
          <a data-slot="model-back-link" href={language.route(import.meta.env.BASE_URL)}>
            {i18n.t("footer.modelData")}
          </a>
          <h1>
            <a data-slot="heading-link" href="#overview">
              {i18n.t("lab.loadingTitle")}
            </a>
          </h1>
          <p>{i18n.t("lab.loadingDescription")}</p>
        </div>
      </div>
    </section>
  )
}

function LabNotFound(props: { lab: string }) {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <section id="overview" data-section="lab-hero">
      <div data-slot="model-hero-grid">
        <div data-slot="model-hero-copy">
          <a data-slot="model-back-link" href={language.route(import.meta.env.BASE_URL)}>
            {i18n.t("footer.modelData")}
          </a>
          <h1>
            <a data-slot="heading-link" href="#overview">
              {formatCatalogLabName(props.lab)}
            </a>
          </h1>
          <p>{i18n.t("lab.notFound")}</p>
        </div>
      </div>
    </section>
  )
}

function LabHero(props: { lab: ModelCatalogLab; stats: StatsLabData | null }) {
  const i18n = useI18n()
  const language = useLanguage()
  const latest = createMemo(
    () =>
      props.lab.models
        .map((model) => model.releaseDate)
        .filter((value): value is string => value !== undefined)
        .toSorted((a, b) => new Date(b).getTime() - new Date(a).getTime())[0],
  )
  const featuredModels = createMemo(() => props.lab.models.slice(0, 3).map((model) => model.name))

  return (
    <section id="overview" data-section="lab-hero">
      <a data-slot="model-back-link" href={language.route(import.meta.env.BASE_URL)}>
        {i18n.t("footer.modelData")}
      </a>
      <div data-slot="model-hero-grid">
        <div data-slot="model-hero-copy">
          <h1>
            <a data-slot="heading-link" href="#overview">
              {props.lab.name}
            </a>
          </h1>
          <div data-slot="model-hero-pattern" aria-hidden="true" />
          <p>
            {i18n.t("lab.heroPrefix", { count: props.lab.models.length, lab: props.lab.name })}
            <Show when={featuredModels().length > 0}>
              {" "}
              {i18n.t("lab.heroIncluding", { models: formatList(featuredModels(), language.tag(language.locale())) })}
            </Show>
            . {i18n.t("lab.heroSuffix")}
          </p>
        </div>
        <div data-component="model-rank-panel">
          <span>{i18n.t("lab.tokensProcessed")}</span>
          <strong>{props.stats ? formatTokens(props.stats.totals.tokens) : i18n.t("lab.pending")}</strong>
          <p>
            {props.stats
              ? i18n.t("lab.shareOfUsage", { share: formatPercent(props.stats.tokenShare) })
              : latest()
                ? i18n.t("lab.latestRelease", {
                    date: formatCatalogDate(latest(), language.tag(language.locale()), i18n.t("home.unknown")),
                  })
                : i18n.t("lab.usageAfterActivity")}
          </p>
        </div>
      </div>
    </section>
  )
}

function LabUsageSection(props: { lab: ModelCatalogLab; data: StatsLabData | null }) {
  const i18n = useI18n()
  const [activeIndex, setActiveIndex] = createSignal<number>()
  const usage = createMemo(() => props.data?.usage ?? [])
  const max = createMemo(() => Math.max(0, ...usage().map((item) => item.tokens)) || 1)
  const activePoint = createMemo(() => {
    const index = activeIndex()
    if (index === undefined) return undefined
    return usage()[index]
  })

  return (
    <section id="usage" data-section="model-panel">
      <SectionHeading
        href="#usage"
        title={i18n.t("lab.usageTitle", { lab: props.lab.name })}
        description={i18n.t("lab.usageDescription")}
      />
      <Show
        when={usage().some((item) => item.tokens > 0)}
        fallback={<LabEmptyState title={i18n.t("lab.noUsageTitle")} description={i18n.t("lab.noUsageDescription")} />}
      >
        <div
          data-component="model-usage-chart"
          data-dense-labels={isLabUsageDense(usage().length) ? "true" : undefined}
          role="img"
          aria-label={i18n.t("lab.dailyTokenChart", { lab: props.lab.name })}
          style={{ "--model-usage-count": usage().length } as JSX.CSSProperties}
          onPointerLeave={(event) => {
            if (event.pointerType === "touch") return
            setActiveIndex(undefined)
          }}
        >
          <div data-slot="model-usage-axis" aria-hidden="true">
            <For each={usage()}>
              {(point, index) => (
                <div
                  data-active={activeIndex() === index() ? "true" : undefined}
                  data-label-hidden={isLabUsageLabelHidden(index(), usage().length) ? "true" : undefined}
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
            <For each={usage()}>
              {(point, index) => (
                <div
                  data-slot="model-usage-column"
                  role="button"
                  tabIndex={0}
                  aria-label={`${point.date} ${formatTokens(point.tokens)} ${i18n.t("lab.tokens")}`}
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
                    style={{ "--model-usage-fill": `${usageHeight(point.tokens, max())}%` } as JSX.CSSProperties}
                  />
                  <Show when={activeIndex() === index() && activePoint()}>
                    {(active) => (
                      <div
                        data-component="chart-tooltip"
                        data-placement={index() > usage().length * 0.62 ? "left" : "right"}
                      >
                        <strong>{active().date}</strong>
                        <span>
                          {formatTokens(active().tokens)} {i18n.t("lab.tokens")}
                        </span>
                        <div data-slot="tooltip-divider" />
                        <p>
                          <span data-slot="tooltip-label">
                            <i /> {i18n.t("lab.dailyTokens")}
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

function LabModelsSection(props: { lab: ModelCatalogLab; usage: LabUsageModelEntry[] }) {
  const i18n = useI18n()
  const usageBySlug = createMemo(() => new Map(props.usage.map((item) => [item.slug, item])))
  return (
    <section id="models" data-section="model-panel">
      <SectionHeading
        href="#models"
        title={i18n.t("lab.modelsTitle", { lab: props.lab.name })}
        description={i18n.t("lab.recentUsageAndLimits")}
      />
      <div data-component="lab-model-grid">
        <For each={props.lab.models}>
          {(model) => <LabModelCard model={model} usage={usageBySlug().get(model.slug)} />}
        </For>
      </div>
    </section>
  )
}

function LabModelCard(props: { model: ModelCatalogEntry; usage: LabUsageModelEntry | undefined }) {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <a data-component="lab-model-card" href={language.route(`${import.meta.env.BASE_URL}${props.model.id}`)}>
      <strong>{props.model.name}</strong>
      <div data-slot="lab-model-card-meta">
        <p>
          <b>{i18n.t("lab.usage")}</b>
          <em>{props.usage ? formatTokens(props.usage.tokens) : "—"}</em>
        </p>
        <p>
          <b>{i18n.t("lab.share")}</b>
          <em>{props.usage ? formatPercent(props.usage.share) : "—"}</em>
        </p>
        <p>
          <b>{i18n.t("model.context")}</b>
          <em>{formatCatalogLimit(props.model.limit?.context, i18n.t("home.unknown"))}</em>
        </p>
        <p>
          <b>{i18n.t("model.output")}</b>
          <em>{formatCatalogLimit(props.model.limit?.output, i18n.t("home.unknown"))}</em>
        </p>
        <p>
          <b>{i18n.t("model.release")}</b>
          <em>{formatCatalogDate(props.model.releaseDate, language.tag(language.locale()), i18n.t("home.unknown"))}</em>
        </p>
      </div>
    </a>
  )
}

function LabEmptyState(props: { title: string; description: string }) {
  return (
    <div data-component="empty-state" data-compact="true">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  )
}

function formatCatalogLimit(value: number | undefined, unknown: string) {
  return value === undefined ? unknown : formatTokens(value)
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

function formatList(values: string[], locale = "en") {
  if (values.length <= 1) return values[0] ?? ""
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(values)
}

function formatPercent(value: number) {
  return `${trimNumber(value, value >= 10 ? 1 : 2)}%`
}

function formatTokens(value: number) {
  if (value >= 1_000_000_000_000)
    return `${trimNumber(value / 1_000_000_000_000, value >= 10_000_000_000_000 ? 0 : 1)}T`
  if (value >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000, value >= 10_000_000_000 ? 0 : 1)}B`
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${trimNumber(value / 1_000, value >= 10_000 ? 0 : 1)}K`
  return String(Math.round(value))
}

function trimNumber(value: number, digits: number) {
  return Number(value.toFixed(digits)).toLocaleString("en")
}

function usageHeight(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0
  return Math.max(4, (value / max) * 100)
}

function isLabUsageDense(count: number) {
  return count > 20
}

function isLabUsageLabelHidden(index: number, count: number) {
  if (count <= 14) return false
  const cadence = count > 45 ? 7 : count > 28 ? 4 : 2
  return index % cadence !== 0 && index !== count - 1
}
