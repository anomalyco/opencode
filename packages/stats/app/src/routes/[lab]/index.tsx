import "../index.css"
import { Meta, Title } from "@solidjs/meta"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import {
  getStatsLabData,
  getStatsHomeData,
  type LabUsageModelEntry,
  type MarketDay,
  type ModelUsagePoint,
  type StatsHomeData,
  type StatsLabData,
} from "@opencode-ai/stats-core/domain/home"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, createSignal, createUniqueId, For, onMount, Show, type JSX } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { LocaleLinks } from "../../component/locale-links"
import { useI18n } from "../../context/i18n"
import { useLanguage } from "../../context/language"
import { localizedUrl } from "../../lib/language"
import {
  catalogSlug,
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

const getHomeData = query(async () => {
  "use server"
  return runStatsEffect(getStatsHomeData())
}, "getStatsHomeData")

type LabModelTooltipState = {
  model: ModelCatalogEntry
  placement: "left" | "right"
  usage: LabUsageModelEntry | undefined
  x: number
  y: number
}

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
  const homeStats = createAsync((): Promise<StatsHomeData | undefined> => getHomeData())
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
            <Show when={lab()} fallback={<LabNotFound lab={labParam()} labs={catalog()?.labs ?? []} />}>
              {(data) => (
                <>
                  <LabHero lab={data()} labs={catalog()?.labs ?? []} />
                  <LabOverview lab={data()} data={stats() ?? null} />
                  <LabUsageSection lab={data()} data={stats() ?? null} />
                  <LabModelsSection lab={data()} usage={stats()?.models ?? []} />
                  <LabRelatedSection
                    lab={data()}
                    labs={catalog()?.labs ?? []}
                    market={homeStats()?.market["2M"] ?? []}
                  />
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
  return (
    <section id="overview" data-section="lab-hero">
      <LabHeroBreadcrumb label={i18n.t("lab.loadingTitle")} />
      <LabHeroTitleRow label={i18n.t("lab.loadingTitle")} />
    </section>
  )
}

function LabNotFound(props: { lab: string; labs: ModelCatalogLab[] }) {
  const i18n = useI18n()
  const labName = () => formatCatalogLabName(props.lab)
  return (
    <section id="overview" data-section="lab-hero">
      <LabHeroBreadcrumb label={labName()} labs={props.labs} />
      <LabHeroTitleRow label={labName()} />
      <p data-slot="lab-hero-state">{i18n.t("lab.notFound")}</p>
    </section>
  )
}

function LabHero(props: { lab: ModelCatalogLab; labs: ModelCatalogLab[] }) {
  return (
    <section id="overview" data-section="lab-hero">
      <LabHeroBreadcrumb label={props.lab.name} labs={props.labs} />
      <LabHeroTitleRow icon={props.lab.id} label={props.lab.name} />
    </section>
  )
}

function LabHeroBreadcrumb(props: { label: string; labs?: ModelCatalogLab[] }) {
  const language = useLanguage()
  const labs = () => props.labs ?? []
  return (
    <nav data-component="lab-hero-breadcrumb" aria-label="Data breadcrumb">
      <a data-slot="lab-hero-crumb" href={language.route(import.meta.env.BASE_URL)}>
        Data
      </a>
      <span data-slot="lab-hero-separator">/</span>
      <Show
        when={labs().length > 0}
        fallback={
          <span data-slot="lab-hero-crumb" data-current="true" aria-current="page">
            <span>{props.label}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.75 6.25L8 9.5L11.25 6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </span>
        }
      >
        <details data-component="lab-hero-menu">
          <summary data-slot="lab-hero-crumb" data-current="true" aria-current="page">
            <span>{props.label}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.75 6.25L8 9.5L11.25 6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </summary>
          <div data-slot="lab-hero-options">
            <For each={labs()}>
              {(lab) => (
                <a
                  data-slot="lab-hero-option"
                  data-current={lab.name === props.label ? "true" : undefined}
                  href={language.route(`${import.meta.env.BASE_URL}${lab.id}`)}
                >
                  {lab.name}
                </a>
              )}
            </For>
          </div>
        </details>
      </Show>
    </nav>
  )
}

function LabHeroTitleRow(props: { icon?: string; label: string }) {
  return (
    <div data-slot="lab-hero-title-row">
      <span data-slot="lab-hero-avatar" data-empty={props.icon ? undefined : "true"}>
        <Show when={props.icon}>{(icon) => <ProviderIcon aria-hidden="true" id={getProviderIconId(icon())} />}</Show>
      </span>
      <h1>{props.label}</h1>
      <div data-slot="lab-hero-pattern" aria-hidden="true" />
    </div>
  )
}

function LabOverview(props: { lab: ModelCatalogLab; data: StatsLabData | null }) {
  const i18n = useI18n()
  const language = useLanguage()
  const featuredModels = createMemo(() => props.lab.models.slice(0, 3).map((model) => model.name))
  return (
    <section data-section="lab-overview">
      <div data-slot="lab-overview-copy">
        <ProviderIcon data-slot="lab-overview-watermark" aria-hidden="true" id={getProviderIconId(props.lab.id)} />
        <p>
          {i18n.t("lab.heroPrefix", { count: props.lab.models.length, lab: props.lab.name })}
          <Show when={featuredModels().length > 0}>
            {" "}
            {i18n.t("lab.heroIncluding", { models: formatList(featuredModels(), language.tag(language.locale())) })}
          </Show>
          . {i18n.t("lab.heroSuffix")}
        </p>
      </div>
      <LabOverviewMetric
        label="Tokens processed"
        value={props.data ? formatTokens(props.data.totals.tokens) : i18n.t("lab.pending")}
      />
      <LabOverviewMetric
        label="Recent usage"
        value={props.data ? formatWholePercent(props.data.tokenShare) : i18n.t("lab.pending")}
      />
    </section>
  )
}

function LabOverviewMetric(props: { label: string; value: string }) {
  return (
    <article data-component="lab-overview-metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  )
}

function LabUsageSection(props: { lab: ModelCatalogLab; data: StatsLabData | null }) {
  const i18n = useI18n()
  const activeLineClipId = createUniqueId()
  const activeLineMaskId = createUniqueId()
  const [activeIndex, setActiveIndex] = createSignal<number>()
  const usage = createMemo(() => props.data?.usage ?? [])
  const tokenMax = createMemo(() => Math.max(0, ...usage().map((item) => item.tokens)) || 1)
  const userMax = createMemo(() => Math.max(0, ...usage().map((item) => item.users)) || 1)
  const linePoints = createMemo(() =>
    usage().map((point, index) => ({
      point,
      x: usagePointX(index, usage().length),
      y: usageLineY(point.users, userMax()),
    })),
  )
  const userLinePath = createMemo(() => usageLinePath(linePoints()))
  const activeLineBreak = createMemo(() => {
    const index = activeIndex()
    if (index === undefined) return undefined
    const points = linePoints()
    if (points.length < 2) return undefined
    return usageColumnBounds(index, points.length)
  })
  const activeLineClip = createMemo(() => {
    const index = activeIndex()
    if (index === undefined) return undefined
    const points = linePoints()
    if (points.length < 2) return undefined
    return usageColumnInnerBounds(index, points.length)
  })
  const monthTicks = createMemo(() => labUsageMonthTicks(usage()))
  const activePoint = createMemo(() => {
    const index = activeIndex()
    if (index === undefined) return undefined
    return usage()[index]
  })
  const activeTooltip = createMemo(() => {
    const index = activeIndex()
    const point = activePoint()
    if (index === undefined || !point) return undefined
    const bounds = usageColumnBounds(index, usage().length)
    return {
      bounds,
      index,
      point,
      userY: linePoints()[index]?.y ?? 100,
    }
  })

  return (
    <section id="usage" data-section="model-panel">
      <SectionHeading href="#usage" title={i18n.t("nav.usage")} description={i18n.t("lab.usageDescription")} />
      <Show
        when={usage().some((item) => item.tokens > 0)}
        fallback={<LabEmptyState title={i18n.t("lab.noUsageTitle")} description={i18n.t("lab.noUsageDescription")} />}
      >
        <div
          data-component="model-usage-chart"
          data-variant="lab-usage"
          data-dense-labels={isLabUsageDense(usage().length) ? "true" : undefined}
          role="img"
          aria-label={`${props.lab.name} daily token volume and unique active user chart`}
          style={{ "--model-usage-count": usage().length } as JSX.CSSProperties}
          onPointerLeave={(event) => {
            if (event.pointerType === "touch") return
            setActiveIndex(undefined)
          }}
        >
          <div data-slot="lab-usage-plot">
            <Show when={userLinePath()}>
              {(path) => (
                <>
                  <svg
                    data-slot="lab-usage-line"
                    data-layer="base"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <Show when={activeLineBreak()} fallback={<path data-slot="lab-usage-line-base" d={path()} />}>
                      {(lineBreak) => (
                        <>
                          <defs>
                            <mask id={activeLineMaskId} maskUnits="userSpaceOnUse">
                              <rect x="0" y="-2" width="100" height="104" fill="white" />
                              <rect x={lineBreak().x} y="-2" width={lineBreak().width} height="104" fill="black" />
                            </mask>
                          </defs>
                          <path data-slot="lab-usage-line-base" d={path()} mask={`url(#${activeLineMaskId})`} />
                        </>
                      )}
                    </Show>
                  </svg>
                  <Show when={activeLineClip()}>
                    {(clip) => (
                      <svg
                        data-slot="lab-usage-line"
                        data-layer="active"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <defs>
                          <clipPath id={activeLineClipId} clipPathUnits="userSpaceOnUse">
                            <rect x={clip().x} y="-2" width={clip().width} height="104" />
                          </clipPath>
                        </defs>
                        <path data-slot="lab-usage-line-active" d={path()} clip-path={`url(#${activeLineClipId})`} />
                      </svg>
                    )}
                  </Show>
                </>
              )}
            </Show>
            <div data-slot="lab-usage-bars">
              <For each={usage()}>
                {(point, index) => (
                  <div
                    data-slot="lab-usage-column"
                    role="button"
                    tabIndex={0}
                    aria-label={`${point.date} ${formatTokens(point.tokens)} ${i18n.t("lab.tokens")}, ${formatUsers(point.users)} ${i18n.t("format.users")}`}
                    data-active={activeIndex() === index() ? "true" : undefined}
                    data-muted={activeIndex() !== undefined && activeIndex() !== index() ? "true" : undefined}
                    style={
                      {
                        "--lab-usage-token-height": `${usageStripHeight(point.tokens, tokenMax())}px`,
                        "--lab-usage-user-y": `${linePoints()[index()]?.y ?? 100}`,
                      } as JSX.CSSProperties
                    }
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
                    <div data-slot="lab-usage-token-bar" />
                  </div>
                )}
              </For>
            </div>
            <Show when={activeTooltip()} keyed>
              {(active) => {
                return (
                  <div
                    data-component="chart-tooltip"
                    data-placement={active.index > usage().length * 0.62 ? "left" : "right"}
                    style={
                      {
                        "--lab-usage-tooltip-left": `${active.bounds.x}%`,
                        "--lab-usage-tooltip-right": `${active.bounds.x + active.bounds.width}%`,
                        "--lab-usage-user-y": `${active.userY}`,
                      } as JSX.CSSProperties
                    }
                  >
                    <strong>{formatUsageTooltipDate(active.point.date)}</strong>
                    <span>
                      {formatTokens(active.point.tokens)} {i18n.t("lab.tokens")}
                    </span>
                    <div data-slot="tooltip-divider" />
                    <p>
                      <span data-slot="tooltip-label">
                        <i data-kind="tokens" /> {i18n.t("lab.dailyTokens")}
                      </span>
                      <b>{formatTokens(active.point.tokens)}</b>
                    </p>
                    <p>
                      <span data-slot="tooltip-label">
                        <i data-kind="users" /> {i18n.t("model.uniqueUsers")}
                      </span>
                      <b>{formatUsers(active.point.users)}</b>
                    </p>
                  </div>
                )
              }}
            </Show>
          </div>
          <div data-slot="lab-usage-months" aria-hidden="true">
            <For each={monthTicks()}>
              {(tick) => (
                <span
                  data-align={tick.align}
                  style={{ "--lab-usage-month-left": `${tick.left}%` } as JSX.CSSProperties}
                >
                  {tick.label}
                </span>
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
  const [activeTooltip, setActiveTooltip] = createSignal<LabModelTooltipState>()
  const usageBySlug = createMemo(() => new Map(props.usage.map((item) => [item.slug, item])))
  return (
    <section id="models" data-section="model-panel" data-variant="lab-models">
      <div data-slot="lab-model-heading">
        <SectionHeading href="#models" title={i18n.t("nav.models")} description={i18n.t("lab.recentUsageAndLimits")} />
        <button data-slot="lab-model-compare" type="button" aria-label="Compare models" hidden>
          <span data-slot="lab-model-compare-icon" aria-hidden="true" />
          <span>Compare</span>
        </button>
      </div>
      <div data-slot="lab-model-pattern" aria-hidden="true" />
      <div
        data-component="lab-model-table"
        role="table"
        aria-label={i18n.t("lab.modelsTitle", { lab: props.lab.name })}
      >
        <div data-slot="lab-model-table-track">
          <div data-slot="lab-model-table-head" role="row">
            <span data-column="model" role="columnheader">
              {i18n.t("nav.models")}
            </span>
            <span data-column="usage" role="columnheader">
              {i18n.t("lab.usage")}
            </span>
            <span data-column="share" role="columnheader">
              {i18n.t("lab.share")}
            </span>
            <span data-column="context" role="columnheader">
              {i18n.t("model.context")}
            </span>
            <span data-column="output" role="columnheader">
              {i18n.t("model.output")}
            </span>
            <span data-column="release" role="columnheader">
              {i18n.t("model.release")}
            </span>
          </div>
          <For each={props.lab.models}>
            {(model) => (
              <LabModelRow model={model} usage={usageBySlug().get(model.slug)} onTooltipChange={setActiveTooltip} />
            )}
          </For>
        </div>
      </div>
      <Show when={activeTooltip()} keyed>
        {(state) => <LabModelTooltip state={state} />}
      </Show>
    </section>
  )
}

function LabModelRow(props: {
  model: ModelCatalogEntry
  onTooltipChange: (state: LabModelTooltipState | undefined) => void
  usage: LabUsageModelEntry | undefined
}) {
  const i18n = useI18n()
  const language = useLanguage()
  const showTooltip = (x: number, y: number) => {
    const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth
    const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight
    props.onTooltipChange({
      model: props.model,
      placement: viewportWidth > 0 && x > viewportWidth - 280 ? "left" : "right",
      usage: props.usage,
      x,
      y: viewportHeight > 0 ? Math.min(Math.max(y, 96), viewportHeight - 128) : y,
    })
  }
  const showPointerTooltip: JSX.EventHandler<HTMLAnchorElement, PointerEvent> = (event) => {
    if (event.pointerType === "touch") return
    showTooltip(event.clientX, event.clientY)
  }
  const showFocusTooltip: JSX.EventHandler<HTMLAnchorElement, FocusEvent> = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    showTooltip(rect.left + rect.width * 0.58, rect.top + rect.height / 2)
  }
  return (
    <a
      data-component="lab-model-row"
      href={language.route(`${import.meta.env.BASE_URL}${props.model.id}`)}
      role="row"
      aria-label={props.model.name}
      onBlur={() => props.onTooltipChange(undefined)}
      onFocus={showFocusTooltip}
      onPointerEnter={showPointerTooltip}
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return
        props.onTooltipChange(undefined)
      }}
      onPointerMove={showPointerTooltip}
    >
      <span data-slot="lab-model-cell" data-column="model" role="cell">
        <span data-slot="lab-model-avatar" aria-hidden="true">
          <ProviderIcon id={getProviderIconId(props.model.lab)} />
        </span>
        <strong>{props.model.name}</strong>
      </span>
      <span data-slot="lab-model-cell" data-column="usage" role="cell">
        {props.usage ? formatTokens(props.usage.tokens) : "-"}
      </span>
      <span data-slot="lab-model-cell" data-column="share" role="cell">
        {props.usage ? formatPercent(props.usage.share) : "-"}
      </span>
      <span data-slot="lab-model-cell" data-column="context" role="cell">
        {formatCatalogLimit(props.model.limit?.context, i18n.t("home.unknown"))}
      </span>
      <span data-slot="lab-model-cell" data-column="output" role="cell">
        {formatCatalogLimit(props.model.limit?.output, i18n.t("home.unknown"))}
      </span>
      <span data-slot="lab-model-cell" data-column="release" role="cell">
        {formatCatalogDate(props.model.releaseDate, language.tag(language.locale()), i18n.t("home.unknown"))}
      </span>
    </a>
  )
}

function LabModelTooltip(props: { state: LabModelTooltipState }) {
  const i18n = useI18n()
  return (
    <div
      data-component="lab-model-tooltip"
      data-placement={props.state.placement}
      style={
        {
          "--lab-model-tooltip-x": `${props.state.x}px`,
          "--lab-model-tooltip-y": `${props.state.y}px`,
        } as JSX.CSSProperties
      }
    >
      <div data-slot="lab-model-tooltip-summary">
        <div data-slot="lab-model-tooltip-head">
          <span data-slot="lab-model-tooltip-avatar" aria-hidden="true">
            <ProviderIcon id={getProviderIconId(props.state.model.lab)} />
          </span>
          <strong>{props.state.model.name}</strong>
        </div>
        <p>{props.state.model.description ?? "Recent OpenCode Go usage, share, context, and output limits."}</p>
      </div>
      <div data-slot="tooltip-divider" />
      <div data-slot="lab-model-tooltip-metrics">
        <p>
          <span>{i18n.t("lab.usage")}</span>
          <b>{props.state.usage ? formatTokens(props.state.usage.tokens) : "-"}</b>
        </p>
        <p>
          <span>{i18n.t("lab.share")}</span>
          <b>{props.state.usage ? formatPercent(props.state.usage.share) : "-"}</b>
        </p>
        <p>
          <span>{i18n.t("model.context")}</span>
          <b>{formatCatalogLimit(props.state.model.limit?.context, i18n.t("home.unknown"))}</b>
        </p>
        <p>
          <span>{i18n.t("model.output")}</span>
          <b>{formatCatalogLimit(props.state.model.limit?.output, i18n.t("home.unknown"))}</b>
        </p>
      </div>
    </div>
  )
}

function LabRelatedSection(props: { lab: ModelCatalogLab; labs: ModelCatalogLab[]; market: MarketDay[] }) {
  const related = createMemo(() => relatedLabs(props.lab, props.labs, props.market))
  return (
    <section id="related-labs" data-section="model-panel" data-variant="lab-related">
      <SectionHeading href="#related-labs" title="Related labs" description="Explore more." />
      <div data-component="lab-related-list">
        <For each={related()}>{(entry) => <LabRelatedCard entry={entry} />}</For>
      </div>
    </section>
  )
}

function LabRelatedCard(props: { entry: RelatedLabEntry }) {
  const language = useLanguage()
  const featured = () => props.entry.lab.models[0]
  const otherCount = () => Math.max(props.entry.lab.models.length - 1, 0)
  const modelSummary = () => {
    const model = featured()
    if (!model) return props.entry.lab.name
    const count = otherCount()
    if (count === 0) return model.name
    return `${model.name} + ${count} other ${count === 1 ? "model" : "models"}`
  }
  const activeBars = () => {
    if (props.entry.share <= 0) return 0
    return Math.max(1, Math.min(20, Math.round(props.entry.share / 5)))
  }
  return (
    <a
      data-component="lab-related-card"
      data-tone={relatedTone(props.entry.share)}
      href={language.route(`${import.meta.env.BASE_URL}${props.entry.lab.id}`)}
    >
      <ProviderIcon data-slot="lab-related-watermark" aria-hidden="true" id={getProviderIconId(props.entry.lab.id)} />
      <div data-slot="lab-related-heading">
        <span data-slot="lab-related-avatar" aria-hidden="true">
          <ProviderIcon id={getProviderIconId(props.entry.lab.id)} />
        </span>
        <strong>{props.entry.lab.name}</strong>
      </div>
      <p data-slot="lab-related-copy">{labRelatedDescription(props.entry.lab)}</p>
      <p data-slot="lab-related-models">{modelSummary()}</p>
      <div data-slot="lab-related-divider" />
      <div data-slot="lab-related-usage">
        <span>Used by {formatWholePercent(props.entry.share)}</span>
        <i aria-hidden="true">
          <For each={Array.from({ length: 20 })}>
            {(_, index) => <b data-active={index() < activeBars() ? "true" : undefined} />}
          </For>
        </i>
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

type RelatedLabEntry = { lab: ModelCatalogLab; share: number; tokens: number }

function relatedLabs(current: ModelCatalogLab, labs: ModelCatalogLab[], market: MarketDay[]): RelatedLabEntry[] {
  const stats = relatedLabStats(labs, market)
  return labs
    .filter((lab) => lab.id !== current.id)
    .map((lab) => stats.get(lab.id) ?? { lab, share: 0, tokens: 0 })
    .toSorted((a, b) => b.tokens - a.tokens || a.lab.name.localeCompare(b.lab.name))
    .slice(0, 3)
}

function relatedLabStats(labs: ModelCatalogLab[], market: MarketDay[]) {
  const labByKey = new Map<string, ModelCatalogLab>()
  labs.forEach((lab) => {
    labByKey.set(lab.id, lab)
    labByKey.set(catalogSlug(lab.name), lab)
    labByKey.set(catalogSlug(formatCatalogLabName(lab.id)), lab)
  })

  const tokensByLab = new Map<string, number>()
  const total = market.reduce((sum, day) => {
    day.authors.forEach((author) => {
      const lab = labByKey.get(catalogSlug(author.author))
      if (!lab) return
      tokensByLab.set(lab.id, (tokensByLab.get(lab.id) ?? 0) + author.tokens)
    })
    return sum + day.total
  }, 0)

  return new Map(
    labs.map((lab) => {
      const tokens = tokensByLab.get(lab.id) ?? 0
      return [lab.id, { lab, tokens, share: total > 0 ? (tokens / total) * 100 : 0 }]
    }),
  )
}

function labRelatedDescription(lab: ModelCatalogLab) {
  return lab.description ?? ""
}

function relatedTone(share: number) {
  if (share >= 50) return "high"
  if (share > 0 && share < 10) return "low"
  return "mid"
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

function formatWholePercent(value: number) {
  return `${Math.round(value).toLocaleString("en")}%`
}

function formatTokens(value: number) {
  if (value >= 1_000_000_000_000)
    return `${trimNumber(value / 1_000_000_000_000, value >= 10_000_000_000_000 ? 0 : 1)}T`
  if (value >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000, value >= 10_000_000_000 ? 0 : 1)}B`
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${trimNumber(value / 1_000, value >= 10_000 ? 0 : 1)}K`
  return String(Math.round(value))
}

function formatUsers(value: number) {
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${trimNumber(value / 1_000, value >= 10_000 ? 0 : 1)}K`
  return new Intl.NumberFormat("en").format(Math.round(value))
}

function formatUsageTooltipDate(value: string) {
  const match = /^([A-Z]{3})\s+(\d{1,2})$/.exec(value)
  if (!match) return value
  return `${monthName(match[1])} ${Number(match[2])} ${new Date().getFullYear()}`
}

function monthName(value: string) {
  const names: Record<string, string> = {
    JAN: "Jan",
    FEB: "Feb",
    MAR: "Mar",
    APR: "Apr",
    MAY: "May",
    JUN: "Jun",
    JUL: "Jul",
    AUG: "Aug",
    SEP: "Sep",
    OCT: "Oct",
    NOV: "Nov",
    DEC: "Dec",
  }
  return names[value] ?? value
}

function trimNumber(value: number, digits: number) {
  return Number(value.toFixed(digits)).toLocaleString("en")
}

function usageStripHeight(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0
  return Math.max(1, (value / max) * 40)
}

function usageLineY(value: number, max: number) {
  if (value <= 0 || max <= 0) return 100
  return Math.max(0, 100 - (value / max) * 100)
}

function usagePointX(index: number, count: number) {
  if (count <= 1) return 50
  return ((index + 0.5) / count) * 100
}

function usageColumnBounds(index: number, count: number) {
  if (count <= 0) return { x: 0, width: 100 }
  return { x: (index / count) * 100, width: 100 / count }
}

function usageColumnInnerBounds(index: number, count: number) {
  const bounds = usageColumnBounds(index, count)
  const inset = Math.min(bounds.width * 0.1, 0.24)
  return { x: bounds.x + inset, width: Math.max(0.001, bounds.width - inset * 2) }
}

type UsageLinePoint = { x: number; y: number }

function usageLinePath(points: UsageLinePoint[]) {
  if (points.length === 0) return ""
  if (points.length === 1) return `M ${pathNumber(points[0].x)} ${pathNumber(points[0].y)}`

  return points.slice(0, -1).reduce(
    (path, point, index) => {
      const next = points[index + 1]
      const previous = points[index - 1] ?? point
      const afterNext = points[index + 2] ?? next
      const controlA = {
        x: point.x + (next.x - previous.x) / 6,
        y: clampUsagePercent(point.y + (next.y - previous.y) / 6),
      }
      const controlB = {
        x: next.x - (afterNext.x - point.x) / 6,
        y: clampUsagePercent(next.y - (afterNext.y - point.y) / 6),
      }
      return `${path} C ${pathNumber(controlA.x)} ${pathNumber(controlA.y)}, ${pathNumber(controlB.x)} ${pathNumber(controlB.y)}, ${pathNumber(next.x)} ${pathNumber(next.y)}`
    },
    `M ${pathNumber(points[0].x)} ${pathNumber(points[0].y)}`,
  )
}

function pathNumber(value: number) {
  return Number(value.toFixed(3))
}

function clampUsagePercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function labUsageMonthTicks(points: ModelUsagePoint[]) {
  const seen = new Set<string>()
  return points.flatMap((point, index) => {
    const label = point.date.split(" ")[0]
    if (!label || seen.has(label)) return []
    seen.add(label)
    return [
      {
        label,
        left: usagePointX(index, points.length),
        align: index === 0 ? "start" : index >= points.length - 2 ? "end" : "center",
      },
    ]
  })
}

function isLabUsageDense(count: number) {
  return count > 20
}

function getProviderIconId(provider: string) {
  const id = provider.toLowerCase().replace(/[^a-z0-9]+/g, "")
  if (id === "moonshot") return "moonshotai"
  if (id === "zhipu") return "zhipuai"
  return id
}
