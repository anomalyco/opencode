import "../index.css"
import { Link, Meta, Title } from "@solidjs/meta"
import {
  getStatsLabData,
  type LabUsageModelEntry,
  type ModelUsagePoint,
  type StatsLabData,
} from "@opencode-ai/stats-core/domain/home"
import { runtime } from "@opencode-ai/stats-core/runtime"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import {
  findModelCatalogLab,
  formatCatalogLabName,
  getModelCatalog,
  type ModelCatalogEntry,
  type ModelCatalogLab,
} from "../model-catalog"
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

const statsLabFallbackUrl = "https://stats.opencode.ai"
const labHeaderLinks: readonly HeaderLink[] = [
  { href: "#overview", label: "Overview" },
  { href: "#usage", label: "Usage" },
  { href: "#models", label: "Models" },
]
const labFooterLinks: readonly HeaderLink[] = [
  { href: import.meta.env.BASE_URL, label: "Stats Home" },
  { href: `${import.meta.env.BASE_URL}#top-models`, label: "Top Models" },
  { href: `${import.meta.env.BASE_URL}#market-share`, label: "Market Share" },
  { href: `${import.meta.env.BASE_URL}#geo-breakdown`, label: "Geo Breakdown" },
]

const getLabData = query(async (lab: string) => {
  "use server"
  return runtime.runPromise(getStatsLabData(lab))
}, "getStatsLabData")

export default function StatsLab() {
  const event = getRequestEvent()
  event?.response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400")
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
  const labTitle = createMemo(() => `${labName()} Models`)
  const labDescription = createMemo(
    () =>
      `Explore ${labName()} models used in OpenCode, with recent token usage, context windows, release dates, and model-specific stats.`,
  )
  const labUrl = createMemo(() =>
    new URL(
      `${import.meta.env.BASE_URL}${lab()?.id ?? labParam()}`,
      event?.request.url ?? (typeof window === "undefined" ? statsLabFallbackUrl : window.location.href),
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
      <Title>{labTitle()}</Title>
      <Meta name="description" content={labDescription()} />
      <Link rel="canonical" href={labUrl()} />
      <Meta property="og:type" content="website" />
      <Meta property="og:site_name" content="OpenCode" />
      <Meta property="og:title" content={labTitle()} />
      <Meta property="og:description" content={labDescription()} />
      <Meta property="og:url" content={labUrl()} />
      <Meta name="twitter:card" content="summary" />
      <Meta name="twitter:title" content={labTitle()} />
      <Meta name="twitter:description" content={labDescription()} />
      <Header githubStars={githubStars() ?? "150K"} links={labHeaderLinks} brandHref={import.meta.env.BASE_URL} />
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
          links={labFooterLinks}
        />
      </div>
    </main>
  )
}

function LabLoading() {
  return (
    <section id="overview" data-section="lab-hero">
      <div data-slot="model-hero-grid">
        <div data-slot="model-hero-copy">
          <a data-slot="model-back-link" href={import.meta.env.BASE_URL}>
            Stats
          </a>
          <h1>Model Lab</h1>
          <p>Reading model availability and recent OpenCode usage.</p>
        </div>
      </div>
    </section>
  )
}

function LabNotFound(props: { lab: string }) {
  return (
    <section id="overview" data-section="lab-hero">
      <div data-slot="model-hero-grid">
        <div data-slot="model-hero-copy">
          <a data-slot="model-back-link" href={import.meta.env.BASE_URL}>
            Stats
          </a>
          <h1>{formatCatalogLabName(props.lab)}</h1>
          <p>No models matched this lab.</p>
        </div>
      </div>
    </section>
  )
}

function LabHero(props: { lab: ModelCatalogLab; stats: StatsLabData | null }) {
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
      <a data-slot="model-back-link" href={import.meta.env.BASE_URL}>
        Stats
      </a>
      <div data-slot="model-hero-grid">
        <div data-slot="model-hero-copy">
          <h1>{props.lab.name}</h1>
          <div data-slot="model-hero-pattern" aria-hidden="true" />
          <p>
            Explore {props.lab.models.length} {props.lab.name} models used in OpenCode
            <Show when={featuredModels().length > 0}> including {formatList(featuredModels())}</Show>. Compare recent
            token usage, context windows, release dates, and model-specific stats.
          </p>
        </div>
        <div data-component="model-rank-panel">
          <span>Tokens Processed</span>
          <strong>{props.stats ? formatTokens(props.stats.totals.tokens) : "Pending"}</strong>
          <p>
            {props.stats
              ? `${formatPercent(props.stats.tokenShare)} of recent OpenCode usage`
              : latest()
                ? `Latest release ${formatCatalogDate(latest())}`
                : "Usage appears after model activity lands"}
          </p>
        </div>
      </div>
    </section>
  )
}

function LabUsageSection(props: { lab: ModelCatalogLab; data: StatsLabData | null }) {
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
      <p data-slot="section-title">
        <strong>{props.lab.name} token usage.</strong>{" "}
        <span>Daily OpenCode token volume over the last two months.</span>
      </p>
      <Show
        when={usage().some((item) => item.tokens > 0)}
        fallback={
          <LabEmptyState
            title="No usage yet"
            description="Recent token usage appears here once this lab has activity."
          />
        }
      >
        <div
          data-component="model-usage-chart"
          data-dense-labels={isLabUsageDense(usage().length) ? "true" : undefined}
          role="img"
          aria-label={`${props.lab.name} daily token usage chart`}
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
                    style={{ "--model-usage-fill": `${usageHeight(point.tokens, max())}%` } as JSX.CSSProperties}
                  />
                  <Show when={activeIndex() === index() && activePoint()}>
                    {(active) => (
                      <div
                        data-component="chart-tooltip"
                        data-placement={index() > usage().length * 0.62 ? "left" : "right"}
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

function LabModelsSection(props: { lab: ModelCatalogLab; usage: LabUsageModelEntry[] }) {
  const usageBySlug = createMemo(() => new Map(props.usage.map((item) => [item.slug, item])))
  return (
    <section id="models" data-section="model-panel">
      <p data-slot="section-title">
        <strong>{props.lab.name} models.</strong> <span>Recent usage and limits.</span>
      </p>
      <div data-component="lab-model-grid">
        <For each={props.lab.models}>
          {(model) => <LabModelCard model={model} usage={usageBySlug().get(model.slug)} />}
        </For>
      </div>
    </section>
  )
}

function LabModelCard(props: { model: ModelCatalogEntry; usage: LabUsageModelEntry | undefined }) {
  return (
    <a data-component="lab-model-card" href={`${import.meta.env.BASE_URL}${props.model.id}`}>
      <strong>{props.model.name}</strong>
      <div data-slot="lab-model-card-meta">
        <p>
          <b>Usage</b>
          <em>{props.usage ? formatTokens(props.usage.tokens) : "—"}</em>
        </p>
        <p>
          <b>Share</b>
          <em>{props.usage ? formatPercent(props.usage.share) : "—"}</em>
        </p>
        <p>
          <b>Context</b>
          <em>{formatCatalogLimit(props.model.limit?.context)}</em>
        </p>
        <p>
          <b>Output</b>
          <em>{formatCatalogLimit(props.model.limit?.output)}</em>
        </p>
        <p>
          <b>Release</b>
          <em>{formatCatalogDate(props.model.releaseDate)}</em>
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

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? ""
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`
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
