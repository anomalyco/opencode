import "./index.css"
import { Link, Meta, Title } from "@solidjs/meta"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import ibmPlexMonoRegularLatin1 from "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Regular-Latin1.woff2?url"
import ibmPlexMonoMediumLatin1 from "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Medium-Latin1.woff2?url"
import ibmPlexMonoSemiBoldLatin1 from "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-SemiBold-Latin1.woff2?url"
import ibmPlexMonoBoldLatin1 from "@ibm/plex/IBM-Plex-Mono/fonts/split/woff2/IBMPlexMono-Bold-Latin1.woff2?url"
import opencodeWordmarkDark from "../asset/logo-ornate-dark.svg"
import statsUnfurlRankings from "../asset/unfurl-rankings.png?url"
import {
  getStatsHomeData,
  type LeaderboardEntry,
  type MarketDay,
  type StatsHomeData,
  type SessionCostEntry,
  type TokenCostEntry,
  type UsagePoint,
} from "@opencode-ai/stats-core/domain/home"
import { runtime } from "@opencode-ai/stats-core/runtime"
import { createAsync, query } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { getRequestEvent } from "solid-js/web"

const products = ["All Users", "Zen", "Go"] as const
const tokenProducts = ["Zen", "Go"] as const
const ranges = ["1D", "1W", "2W", "1M", "2M"] as const
const rangeLabels: Record<UsageRange, string> = {
  "1D": "1 Day",
  "1W": "1 Week",
  "2W": "2 Weeks",
  "1M": "1 Month",
  "2M": "2 Months",
}
const statsHomeTitle = "OpenCode Stats"
const statsHomeDescription = "OpenCode usage, market share, token cost, and session cost stats."
const statsHomeFallbackUrl = "https://stats.opencode.ai"
const statsUnfurlAlt = "OpenCode Stats wordmark on a dark patterned background"
const headerLinks = [
  { href: "#top-models", label: "Top Models" },
  { href: "#leaderboard", label: "Leaderboard" },
  { href: "#market-share", label: "Market Share" },
  { href: "#token-cost", label: "Token Cost" },
  { href: "#session-cost", label: "Session Cost" },
] as const
const githubLink = {
  href: "https://github.com/anomalyco/opencode",
  apiHref: "https://api.github.com/repos/anomalyco/opencode",
  label: "GitHub",
  fallbackStars: "150K",
  ariaLabel: "Star OpenCode on GitHub",
}
const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const usageColors = [
  "#ed6aff",
  "#a684ff",
  "#7c86ff",
  "#51a2ff",
  "#00d3f2",
  "#00d5be",
  "#00bc7d",
  "#9ae600",
  "#ffb900",
  "#ff8904",
  "#ff6467",
]
const marketColors = ["#ed6aff", "#a684ff", "#7c86ff", "#51a2ff", "#00d3f2", "#00d5be", "#00bc7d", "#9ae600", "#ffb900"]

type UsageProduct = (typeof products)[number]
type TokenProduct = (typeof tokenProducts)[number]
type UsageRange = (typeof ranges)[number]

const getData = query(async () => {
  "use server"
  return runtime.runPromise(getStatsHomeData())
}, "getStatsHomeData")

const getGitHubStars = query(async () => {
  "use server"
  return fetch(githubLink.apiHref, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((body: unknown) =>
      body && typeof body === "object" && "stargazers_count" in body && typeof body.stargazers_count === "number"
        ? compactNumberFormatter.format(body.stargazers_count)
        : githubLink.fallbackStars,
    )
    .catch(() => githubLink.fallbackStars)
}, "getGitHubStars")

export default function StatsHome() {
  const event = getRequestEvent()
  event?.response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400")
  const statsHomeUrl = new URL(
    import.meta.env.BASE_URL,
    event?.request.url ?? (typeof window === "undefined" ? statsHomeFallbackUrl : window.location.href),
  ).toString()
  const statsUnfurlUrl = new URL(statsUnfurlRankings, statsHomeUrl).toString()
  const data = createAsync(() => getData())
  const githubStars = createAsync(() => getGitHubStars())

  return (
    <main data-page="stats">
      <Title>{statsHomeTitle}</Title>
      <Meta name="description" content={statsHomeDescription} />
      <Link rel="canonical" href={statsHomeUrl} />
      <Meta property="og:type" content="website" />
      <Meta property="og:site_name" content="OpenCode" />
      <Meta property="og:title" content={statsHomeTitle} />
      <Meta property="og:description" content={statsHomeDescription} />
      <Meta property="og:url" content={statsHomeUrl} />
      <Meta property="og:image" content={statsUnfurlUrl} />
      <Meta property="og:image:type" content="image/png" />
      <Meta property="og:image:width" content="1200" />
      <Meta property="og:image:height" content="630" />
      <Meta property="og:image:alt" content={statsUnfurlAlt} />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={statsHomeTitle} />
      <Meta name="twitter:description" content={statsHomeDescription} />
      <Meta name="twitter:image" content={statsUnfurlUrl} />
      <Meta name="twitter:image:alt" content={statsUnfurlAlt} />
      <Link rel="preload" href={ibmPlexMonoRegularLatin1} as="font" type="font/woff2" crossorigin="anonymous" />
      <Link rel="preload" href={ibmPlexMonoMediumLatin1} as="font" type="font/woff2" crossorigin="anonymous" />
      <Link rel="preload" href={ibmPlexMonoSemiBoldLatin1} as="font" type="font/woff2" crossorigin="anonymous" />
      <Link rel="preload" href={ibmPlexMonoBoldLatin1} as="font" type="font/woff2" crossorigin="anonymous" />
      <Header githubStars={githubStars() ?? githubLink.fallbackStars} />
      <div data-component="container">
        <div data-component="content">
          <Show when={data()} fallback={<StatsLoading />}>
            {(stats) => (
              <>
                <Hero updatedAt={stats().updatedAt} />
                <TopModelsSection data={stats().usage} />
                <LeaderboardSection data={stats().leaderboard} />
                <MarketShareSection data={stats().market} />
                <TokenCostSection data={stats().tokenCost} />
                <SessionCostSection data={stats().sessionCost} />
              </>
            )}
          </Show>
        </div>
        <Footer />
      </div>
    </main>
  )
}

function Hero(props: { updatedAt: string | null }) {
  const [timeZone, setTimeZone] = createSignal("UTC")
  const [previousTimeZone, setPreviousTimeZone] = createSignal("UTC")
  const [isTicking, setIsTicking] = createSignal(false)
  const updatedAtParts = (timeZone: string) =>
    props.updatedAt ? formatUpdatedAtParts(props.updatedAt, timeZone) : { date: "No rows yet", time: "" }
  const previousUpdatedAt = createMemo(() => updatedAtParts(previousTimeZone()))
  const currentUpdatedAt = createMemo(() => updatedAtParts(timeZone()))
  const currentUpdatedLabel = createMemo(() =>
    props.updatedAt ? `Updated ${formatUpdatedAtLabel(currentUpdatedAt())}` : "No rows yet",
  )
  const isDateTicking = createMemo(() => isTicking() && previousUpdatedAt().date !== currentUpdatedAt().date)
  const isTimeTicking = createMemo(() => isTicking() && previousUpdatedAt().time !== currentUpdatedAt().time)

  onMount(() => {
    if (!props.updatedAt) return
    const nextTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    if (nextTimeZone === "UTC") return
    if (
      formatUpdatedAtLabel(formatUpdatedAtParts(props.updatedAt, nextTimeZone)) ===
      formatUpdatedAtLabel(updatedAtParts("UTC"))
    )
      return
    const timeouts: number[] = []
    timeouts.push(
      window.setTimeout(() => {
        setPreviousTimeZone(timeZone())
        setTimeZone(nextTimeZone)
        setIsTicking(true)
        timeouts.push(
          window.setTimeout(() => {
            setPreviousTimeZone(nextTimeZone)
            setIsTicking(false)
          }, 720),
        )
      }, 480),
    )
    onCleanup(() => timeouts.forEach((timeout) => window.clearTimeout(timeout)))
  })

  return (
    <section data-section="hero">
      <p data-slot="hero-meta" aria-live="polite" aria-atomic="true" aria-label={currentUpdatedLabel()}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M13 13H3V3H13V13ZM6.46777 6.81641V7.81641H7.5791V11.3721H8.5791V6.81641H6.46777ZM7.30078 4.62891V5.62891H8.85645V4.62891H7.30078Z"
            fill="currentColor"
          />
        </svg>
        {props.updatedAt ? (
          <>
            <span data-slot="hero-meta-label" aria-hidden="true">
              Updated
            </span>
            <span data-slot="hero-meta-time" aria-hidden="true">
              <HeroMetaTickerPart
                previous={previousUpdatedAt().date}
                current={currentUpdatedAt().date}
                ticking={isDateTicking()}
              />
              <span data-slot="hero-meta-separator">,</span>
              <HeroMetaTickerPart
                previous={previousUpdatedAt().time}
                current={currentUpdatedAt().time}
                ticking={isTimeTicking()}
              />
            </span>
          </>
        ) : (
          <span data-slot="hero-meta-empty">No rows yet</span>
        )}
      </p>
      <div data-slot="hero-canvas">
        <div data-slot="hero-pattern" aria-hidden="true" />
        <h1>Model Stats</h1>
        <p data-slot="hero-copy">
          See which models are winning real usage, how the mix <br data-slot="hero-copy-break" />
          shifts over time, and where momentum is moving each week.
        </p>
      </div>
    </section>
  )
}

function HeroMetaTickerPart(props: { previous: string; current: string; ticking: boolean }) {
  return (
    <span data-slot="hero-meta-ticker" data-ticking={props.ticking}>
      <span data-slot="hero-meta-ticker-track">
        <span data-slot="hero-meta-ticker-item">{props.previous}</span>
        <span data-slot="hero-meta-ticker-item">{props.current}</span>
      </span>
    </span>
  )
}

function StatsLoading() {
  return (
    <>
      <Hero updatedAt={null} />
      <ChartSection title="Usage">
        <EmptyState title="Loading stats" description="Reading model aggregates from model_stat." />
      </ChartSection>
    </>
  )
}

function ChartSection(props: {
  id?: string
  title: string
  description?: string
  controls?: JSX.Element
  children: JSX.Element
}) {
  return (
    <section id={props.id} data-section="chart">
      <div data-slot="section-header">
        <div>
          <h2>{props.title}</h2>
          {props.description && <p>{props.description}</p>}
        </div>
        {props.controls}
      </div>
      {props.children}
    </section>
  )
}

function SectionTitle(props: { title: string; description: string }) {
  return (
    <p data-slot="section-title">
      <strong>{props.title}.</strong> <span>{props.description}</span>
    </p>
  )
}

function SectionBridge(props: { label: string; href: string }) {
  return (
    <a data-component="section-bridge" href={props.href}>
      <span>LEAN MORE</span>
      <i />
      <strong>{props.label}</strong>
      <b>▸</b>
    </a>
  )
}

function EmptyState(props: { title: string; description: string }) {
  return (
    <div data-component="empty-state">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  )
}

function formatUpdatedAtParts(value: string, timeZone: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: "just now", time: "" }
  return {
    date: new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      timeZone,
    }).format(date),
    time: new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(date),
  }
}

function formatUpdatedAtLabel(value: { date: string; time: string }) {
  if (!value.time) return value.date
  return `${value.date}, ${value.time}`
}

function TopModelsSection(props: { data: StatsHomeData["usage"] }) {
  const [product, setProduct] = createSignal<UsageProduct>("All Users")
  const [range, setRange] = createSignal<UsageRange>("1W")
  const [sheet, setSheet] = createSignal<"product" | "range">()
  const data = createMemo(() => props.data[product()][range()])

  createEffect(() => {
    if (!sheet()) return
    if (typeof document === "undefined") return
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheet(undefined)
    }
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  return (
    <section id="top-models" data-section="top-models">
      <h2 data-slot="top-models-title">
        <strong>Top models.</strong> <span>Usage of models across OpenCode.</span>
      </h2>
      <div data-slot="top-models-mobile-controls">
        <MobileFilterButton
          label="Product filter"
          value={product()}
          expanded={sheet() === "product"}
          onClick={() => setSheet(sheet() === "product" ? undefined : "product")}
        />
        <MobileFilterButton
          label="Date range"
          value={range()}
          expanded={sheet() === "range"}
          onClick={() => setSheet(sheet() === "range" ? undefined : "range")}
        />
      </div>
      <Show
        when={data().some((item) => usageTotal(item) > 0)}
        fallback={<EmptyState title="No usage data" description="No model_stat rows matched this product and range." />}
      >
        <TopModelsChart data={data()} range={range()} />
      </Show>
      <div data-slot="chart-footer">
        <StatsFilters product={product()} range={range()} onProductSelect={setProduct} onRangeSelect={setRange} />
      </div>
      <Show when={sheet()}>
        {(kind) => (
          <MobileFilterSheet
            kind={kind()}
            product={product()}
            range={range()}
            onProductSelect={(value) => {
              setProduct(value)
              setSheet(undefined)
            }}
            onRangeSelect={(value) => {
              setRange(value)
              setSheet(undefined)
            }}
            onClose={() => setSheet(undefined)}
          />
        )}
      </Show>
    </section>
  )
}

function MobileFilterButton(props: { label: string; value: string; expanded: boolean; onClick: () => void }) {
  return (
    <button
      data-slot="mobile-filter-button"
      type="button"
      aria-label={props.label}
      aria-expanded={props.expanded ? "true" : "false"}
      onClick={props.onClick}
    >
      <span>{props.value}</span>
      <ChevronDown />
    </button>
  )
}

function MobileFilterSheet(props: {
  kind: "product" | "range"
  product: UsageProduct
  range: UsageRange
  onProductSelect: (product: UsageProduct) => void
  onRangeSelect: (range: UsageRange) => void
  onClose: () => void
}) {
  return (
    <div data-component="mobile-filter-sheet" role="presentation" onClick={props.onClose}>
      <div
        data-slot="filter-sheet-panel"
        role="radiogroup"
        aria-label={props.kind === "product" ? "Product filter" : "Date range"}
      >
        <Show
          when={props.kind === "product"}
          fallback={
            <For each={ranges}>
              {(item) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={props.range === item}
                  data-active={props.range === item ? "true" : undefined}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onRangeSelect(item)
                  }}
                >
                  {rangeLabels[item]}
                </button>
              )}
            </For>
          }
        >
          <For each={products}>
            {(item) => (
              <button
                type="button"
                role="radio"
                aria-checked={props.product === item}
                data-active={props.product === item ? "true" : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onProductSelect(item)
                }}
              >
                {item}
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

function ChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M5 7L8 10L11 7" stroke="currentColor" />
    </svg>
  )
}

function StatsFilters(props: {
  product: UsageProduct
  range: UsageRange
  onProductSelect: (product: UsageProduct) => void
  onRangeSelect: (range: UsageRange) => void
}) {
  return (
    <>
      <FilterPills
        items={products}
        selected={props.product}
        label="Product filter"
        variant="product"
        onSelect={props.onProductSelect}
      />
      <FilterPills
        items={ranges}
        selected={props.range}
        label="Date range"
        variant="range"
        onSelect={props.onRangeSelect}
      />
    </>
  )
}

function FilterPills<T extends string>(props: {
  items: readonly T[]
  selected: T
  label: string
  variant: "product" | "range"
  onSelect: (item: T) => void
}) {
  return (
    <div data-component="usage-filter" data-variant={props.variant} role="radiogroup" aria-label={props.label}>
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.selected === item}
            data-active={props.selected === item ? "true" : undefined}
            onClick={() => props.onSelect(item)}
          >
            {item}
          </button>
        )}
      </For>
    </div>
  )
}

function TopModelsChart(props: { data: UsagePoint[]; range: UsageRange }) {
  const [activeIndex, setActiveIndex] = createSignal<number>()
  const [activeSegment, setActiveSegment] = createSignal<number>()
  const maxTotal = createMemo(() => getTopModelsMaxTotal(props.data))
  const activePoint = createMemo(() => props.data[activeIndex() ?? -1])

  return (
    <div
      data-component="top-models-chart"
      data-range={props.range}
      role="img"
      aria-label="Stacked top model usage chart"
    >
      <div data-slot="top-models-axis" aria-hidden="true">
        <For each={props.data}>
          {(day, index) => (
            <div
              data-active={activeIndex() === index() ? "true" : undefined}
              data-mobile-hidden={isTopModelsMobileAxisHidden(index(), props.data.length) ? "true" : undefined}
            >
              <span data-slot="axis-label">
                <span data-slot="axis-total">{formatTokens(usageTotal(day))}</span>
                <span data-slot="axis-date">
                  <span data-slot="axis-date-full">{day.date}</span>
                  <span data-slot="axis-date-mobile">{formatTopModelsMobileDate(day.date, props.range)}</span>
                </span>
              </span>
            </div>
          )}
        </For>
      </div>
      <div data-slot="top-models-bars">
        <For each={props.data}>
          {(day, dayIndex) => (
            <div
              data-slot="top-models-bar"
              role="button"
              tabIndex={0}
              aria-label={`${day.date} ${formatTokens(usageTotal(day))}`}
              data-active={activeIndex() === dayIndex() ? "true" : undefined}
              data-muted={activeIndex() !== undefined && activeIndex() !== dayIndex() ? "true" : undefined}
              style={{ "--top-models-bar-height": `${getTopModelsBarHeight(usageTotal(day), maxTotal())}%` }}
              onPointerDown={(event) => {
                if (event.pointerType !== "touch") return
                setActiveIndex(dayIndex())
                setActiveSegment(undefined)
              }}
              onPointerEnter={() => {
                setActiveIndex(dayIndex())
                setActiveSegment(undefined)
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "touch") return
                setActiveIndex(undefined)
                setActiveSegment(undefined)
              }}
              onClick={() => setActiveIndex(dayIndex())}
              onFocus={() => {
                setActiveIndex(dayIndex())
                setActiveSegment(undefined)
              }}
              onBlur={() => {
                setActiveIndex(undefined)
                setActiveSegment(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                setActiveIndex(dayIndex())
                setActiveSegment(undefined)
              }}
            >
              <div data-slot="top-models-stack" style={{ "grid-template-rows": getTopModelsSegmentRows(day) }}>
                <For each={visibleTopModelsSegments(day)}>
                  {(item) => (
                    <i
                      data-series={item.index}
                      data-active={activeSegment() === item.index ? "true" : undefined}
                      style={{
                        background: getTopModelsSegmentColor(
                          item.index,
                          activeIndex() !== undefined && activeIndex() !== dayIndex(),
                          activeSegment(),
                        ),
                      }}
                      onPointerEnter={(event) => {
                        event.stopPropagation()
                        setActiveIndex(dayIndex())
                        setActiveSegment(item.index)
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        setActiveIndex(dayIndex())
                        setActiveSegment(item.index)
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        setActiveIndex(dayIndex())
                        setActiveSegment(item.index)
                      }}
                    />
                  )}
                </For>
              </div>
              <Show when={activeIndex() === dayIndex() && activePoint()}>
                {(point) => (
                  <div
                    data-component="chart-tooltip"
                    data-placement={dayIndex() > props.data.length * 0.62 ? "left" : "right"}
                  >
                    <strong>{point().date}</strong>
                    <span>{formatTokens(usageTotal(point()))} total</span>
                    <div data-slot="tooltip-divider" />
                    <For each={visibleTopModelsSegments(point())}>
                      {(item) => (
                        <p
                          data-active={activeSegment() === item.index ? "true" : undefined}
                          data-muted={
                            activeSegment() !== undefined && activeSegment() !== item.index ? "true" : undefined
                          }
                        >
                          <span data-slot="tooltip-label">
                            <i style={{ background: usageColors[item.index] }} /> {item.segment.model}
                          </span>
                          <b>{formatTokens(item.segment.value)}</b>
                        </p>
                      )}
                    </For>
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

function getTopModelsBarHeight(total: number, max: number) {
  if (total <= 0) return 0
  return Math.max(2, Math.min(100, (total / max) * 100))
}

function getTopModelsMaxTotal(data: UsagePoint[]) {
  const max = Math.max(0, ...data.map((item) => usageTotal(item)))
  if (max === 0) return 1
  if (data.length === 1) return max * 1.75
  return max
}

function getTopModelsSegmentRows(point: UsagePoint) {
  const total = usageTotal(point)
  if (total <= 0) return ""
  return visibleTopModelsSegments(point)
    .map((item) => `${(item.segment.value / total) * 100}%`)
    .join(" ")
}

function visibleTopModelsSegments(point: UsagePoint) {
  return point.segments.map((segment, index) => ({ segment, index })).filter((item) => item.segment.value > 0)
}

function getTopModelsSegmentColor(index: number, muted: boolean, activeSegment: number | undefined) {
  if (activeSegment !== undefined)
    return activeSegment === index ? (usageColors[index] ?? "var(--stats-text)") : "var(--stats-layer-2)"
  if (muted) return "var(--stats-layer-2)"
  return usageColors[index] ?? "var(--stats-text)"
}

function isTopModelsMobileAxisHidden(index: number, count: number) {
  return count > 7 && index % 2 === 1
}

function formatTopModelsMobileDate(label: string, range: UsageRange) {
  if (range === "1M" || range === "2M") return label.split(" - ")[0] ?? label
  return label
}

function usageTotal(point: UsagePoint) {
  return point.segments.reduce((sum, item) => sum + item.value, 0)
}

function formatTokens(value: number) {
  if (value >= 1) return `${value.toFixed(value >= 10 ? 0 : 1)}T`
  return `${Math.round(value * 1000)}B`
}

function LeaderboardSection(props: { data: StatsHomeData["leaderboard"] }) {
  const [product, setProduct] = createSignal<UsageProduct>("All Users")
  const [range, setRange] = createSignal<UsageRange>("1W")
  const data = createMemo(() => props.data[product()][range()])

  return (
    <section id="leaderboard" data-section="leaderboard">
      <SectionTitle
        title="Leaderboard"
        description="Shown are the sum of prompt and completion tokens per model, including reasoning tokens."
      />
      <Show
        when={data().length > 0}
        fallback={
          <EmptyState title="No leaderboard data" description="No model_stat rows matched this product and range." />
        }
      >
        <Leaderboard data={data()} />
      </Show>
      <div data-slot="chart-footer">
        <StatsFilters product={product()} range={range()} onProductSelect={setProduct} onRangeSelect={setRange} />
      </div>
    </section>
  )
}

function Leaderboard(props: { data: LeaderboardEntry[] }) {
  const featured = createMemo(() => props.data.slice(0, 3))
  const columns = createMemo(() =>
    [0, 1, 2].map((index) => props.data.slice(3 + index * 5, 8 + index * 5)).filter((column) => column.length > 0),
  )

  return (
    <div data-component="leaderboard" role="list" aria-label="Model token leaderboard">
      <div data-slot="leaderboard-featured">
        <For each={featured()}>{(entry) => <LeaderboardCard entry={entry} size="featured" />}</For>
      </div>
      <div data-slot="leaderboard-pattern" aria-hidden="true" />
      <div data-slot="leaderboard-compact">
        <For each={columns()}>
          {(column) => (
            <div data-slot="leaderboard-column">
              <For each={column}>{(entry) => <LeaderboardCard entry={entry} size="compact" />}</For>
            </div>
          )}
        </For>
      </div>
      <div data-slot="leaderboard-mobile" aria-label="Scrollable model token leaderboard">
        <For each={props.data}>{(entry) => <LeaderboardCard entry={entry} size="featured" />}</For>
      </div>
    </div>
  )
}

function LeaderboardCard(props: { entry: LeaderboardEntry; size: "featured" | "compact" }) {
  return (
    <article
      data-component="leader-card"
      data-size={props.size}
      role="listitem"
      aria-label={`${String(props.entry.rank).padStart(2, "0")} ${props.entry.model} by ${props.entry.author}`}
    >
      <span data-slot="rank">{String(props.entry.rank).padStart(2, "0")}</span>
      <ProviderIcon data-slot="leader-watermark" aria-hidden="true" id={getProviderIconId(props.entry.author)} />
      <div data-slot="leader-body">
        <ProviderIcon data-slot="leader-avatar" aria-hidden="true" id={getProviderIconId(props.entry.author)} />
        <div data-slot="leader-copy">
          <div>
            <strong>{props.entry.model}</strong>
            <span>{formatBillions(props.entry.tokens)}</span>
          </div>
          <div>
            <span>{props.entry.author}</span>
            <span data-slot="delta" data-negative={props.entry.change < 0 ? "true" : undefined}>
              {formatChange(props.entry.change)}
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}

function getProviderIconId(author: string) {
  if (author === "MiniMax") return "minimax"
  if (author === "Moonshot") return "moonshotai"
  if (author === "Zhipu") return "zhipuai"
  return author.toLowerCase()
}

function formatBillions(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}T`
  return `${value}B`
}

function formatChange(value: number) {
  if (value > 0) return `+${value}%`
  return `${value}%`
}

function MarketShareSection(props: { data: StatsHomeData["market"] }) {
  const [range, setRange] = createSignal<UsageRange>("1W")
  const [activeIndex, setActiveIndex] = createSignal(2)
  const [activeAuthor, setActiveAuthor] = createSignal<string>()
  const [inspecting, setInspecting] = createSignal(false)
  const data = createMemo(() => props.data[range()])
  const selectedIndex = createMemo(() => Math.min(activeIndex(), Math.max(data().length - 1, 0)))
  const activeDay = createMemo(() => data()[selectedIndex()])

  return (
    <section
      id="market-share"
      data-section="market-share"
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return
        setActiveAuthor(undefined)
        setInspecting(false)
      }}
    >
      <SectionBridge label="LEADERBOARD" href="#leaderboard" />
      <SectionTitle title="Market Share" description="Compare token share by model author." />
      <Show
        when={activeDay()}
        fallback={<EmptyState title="No market data" description="No model_stat rows matched this range." />}
      >
        {(day) => (
          <>
            <MarketShare
              data={data()}
              activeIndex={selectedIndex()}
              activeAuthor={activeAuthor()}
              inspecting={inspecting()}
              onActiveIndexChange={(index) => {
                setActiveIndex(index)
                setInspecting(true)
              }}
              onActiveAuthorChange={(author) => {
                setActiveAuthor(author)
                setInspecting(true)
              }}
            />
            <MarketShareList
              data={day().authors}
              activeAuthor={activeAuthor()}
              onActiveAuthorChange={(author) => {
                setActiveAuthor(author)
                setInspecting(true)
              }}
            />
          </>
        )}
      </Show>
      <div data-slot="market-footer">
        <p>
          <span>[*]</span>
          <strong>{inspecting() ? formatMarketDate(activeDay()) : formatMarketRange(data())}</strong>
        </p>
        <FilterPills
          items={ranges}
          selected={range()}
          label="Date range"
          variant="range"
          onSelect={(item) => {
            setRange(item)
            setActiveAuthor(undefined)
            setInspecting(false)
          }}
        />
      </div>
    </section>
  )
}

function MarketShare(props: {
  data: MarketDay[]
  activeIndex: number
  activeAuthor: string | undefined
  inspecting: boolean
  onActiveIndexChange: (index: number) => void
  onActiveAuthorChange: (author: string) => void
}) {
  return (
    <div
      data-component="market-share"
      role="img"
      aria-label="Market share by model author"
      style={{ "--market-count": props.data.length } as JSX.CSSProperties}
    >
      <div data-slot="market-labels">
        <For each={props.data}>
          {(day, index) => (
            <button
              type="button"
              data-active={props.inspecting && props.activeIndex === index() ? "true" : undefined}
              data-mobile-hidden={isMarketMobileLabelHidden(index(), props.data.length) ? "true" : undefined}
              onClick={() => props.onActiveIndexChange(index())}
              onPointerEnter={() => props.onActiveIndexChange(index())}
            >
              <span data-slot="market-axis-label">
                <span data-slot="market-total">{formatTrillions(day.total)}</span>
                <span data-slot="market-date">
                  <span data-slot="market-date-full">{day.date}</span>
                  <span data-slot="market-date-mobile">{formatMarketMobileDate(day.date)}</span>
                </span>
              </span>
            </button>
          )}
        </For>
      </div>
      <div data-slot="market-bars">
        <For each={props.data}>
          {(day, index) => (
            <button
              type="button"
              aria-label={`${day.date} ${formatTrillions(day.total)}`}
              data-active={props.inspecting && props.activeIndex === index() ? "true" : undefined}
              onClick={() => props.onActiveIndexChange(index())}
              onPointerEnter={() => props.onActiveIndexChange(index())}
            >
              <For each={day.authors}>
                {(author, authorIndex) => (
                  <span
                    data-active={props.activeAuthor === author.author ? "true" : undefined}
                    data-muted={
                      props.activeAuthor !== undefined && props.activeAuthor !== author.author ? "true" : undefined
                    }
                    style={{
                      "background-color": getMarketSegmentColor(
                        author.author,
                        marketColors[authorIndex()] ?? "var(--stats-text)",
                        props.activeAuthor,
                      ),
                      "flex-grow": author.share,
                    }}
                    onPointerEnter={(event) => {
                      event.stopPropagation()
                      props.onActiveIndexChange(index())
                      props.onActiveAuthorChange(author.author)
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      props.onActiveIndexChange(index())
                      props.onActiveAuthorChange(author.author)
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onActiveIndexChange(index())
                      props.onActiveAuthorChange(author.author)
                    }}
                  />
                )}
              </For>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function MarketShareList(props: {
  data: MarketDay["authors"]
  activeAuthor: string | undefined
  onActiveAuthorChange: (author: string) => void
}) {
  return (
    <ol data-component="market-share-list">
      <For each={props.data}>
        {(item, index) => (
          <li
            role="button"
            tabIndex={0}
            aria-label={`${item.author} ${formatTrillions(item.tokens)} ${item.share.toFixed(1)} percent`}
            data-active={props.activeAuthor === item.author ? "true" : undefined}
            onPointerEnter={() => props.onActiveAuthorChange(item.author)}
            onFocus={() => props.onActiveAuthorChange(item.author)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              props.onActiveAuthorChange(item.author)
            }}
          >
            <span>{String(index() + 1).padStart(2, "0")}</span>
            <i style={{ background: marketColors[index()] }} />
            <strong>{item.author}</strong>
            <em>{formatTrillions(item.tokens)}</em>
            <b>{item.share.toFixed(1)}%</b>
          </li>
        )}
      </For>
    </ol>
  )
}

function getMarketSegmentColor(author: string, color: string, activeAuthor: string | undefined) {
  if (!activeAuthor) return color
  if (activeAuthor === author) return color
  return "var(--stats-bar-idle)"
}

function isMarketMobileLabelHidden(index: number, count: number) {
  return count > 7 && index % 2 === 1
}

function formatMarketMobileDate(label: string) {
  return marketDateParts(label).start
}

function formatTrillions(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}T`
}

function formatMarketDate(day: MarketDay | undefined) {
  if (!day) return "No data"
  return formatMarketDateLabel(day.date)
}

function formatMarketRange(data: MarketDay[]) {
  const first = data[0]?.date
  const last = data[data.length - 1]?.date
  if (!first || !last) return "No data"
  const start = marketDateParts(first).start
  const end = marketDateParts(last).end
  if (start === end) return formatMarketDateLabel(start)
  return `${start} ${new Date().getFullYear()} → ${end} ${new Date().getFullYear()}`
}

function formatMarketDateLabel(label: string) {
  const parts = marketDateParts(label)
  const year = new Date().getFullYear()
  if (parts.start === parts.end) return `${parts.start} ${year}`
  return `${parts.start} ${year} → ${parts.end} ${year}`
}

function marketDateParts(label: string) {
  const [start, end] = label.split(" - ")
  return { start: start ?? label, end: end ?? start ?? label }
}

function TokenCostSection(props: { data: StatsHomeData["tokenCost"] }) {
  const [product, setProduct] = createSignal<TokenProduct>("Zen")
  const [activeIndex, setActiveIndex] = createSignal(2)
  const data = createMemo(() => props.data[product()])
  const visible = createMemo(() => data().slice(0, 13))
  const selectedIndex = createMemo(() => Math.min(activeIndex(), Math.max(visible().length - 1, 0)))

  return (
    <section id="token-cost" data-section="token-cost">
      <SectionBridge label="MARKET SHARE" href="#market-share" />
      <SectionTitle title="Token Cost" description="Price per 1M tokens." />
      <Show
        when={visible().length > 0}
        fallback={
          <EmptyState title="No token cost data" description="No cost-bearing model_stat rows matched this product." />
        }
      >
        <TokenCostChart data={visible()} activeIndex={selectedIndex()} onActiveIndexChange={setActiveIndex} />
      </Show>
      <div data-slot="token-footer">
        <FilterPills
          items={tokenProducts}
          selected={product()}
          label="Product filter"
          variant="product"
          onSelect={setProduct}
        />
        <LiveIndicator />
      </div>
    </section>
  )
}

function TokenCostChart(props: {
  data: TokenCostEntry[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
}) {
  const max = createMemo(() => Math.max(0, ...props.data.map((item) => item.total)) || 1)
  const active = createMemo(() => props.data[props.activeIndex] ?? props.data[0])

  return (
    <div data-component="token-cost">
      <For each={props.data}>
        {(item, index) => (
          <button
            type="button"
            data-component="token-row"
            data-active={props.activeIndex === index() ? "true" : undefined}
            onClick={() => props.onActiveIndexChange(index())}
            onPointerEnter={() => props.onActiveIndexChange(index())}
          >
            <strong>{formatDollars(item.total)}</strong>
            <span>{item.model}</span>
            <MetricBar value={item.total} max={max()} active={props.activeIndex === index()} />
          </button>
        )}
      </For>
      <Show when={active()}>
        {(item) => (
          <div data-component="token-tooltip" style={{ top: `${props.activeIndex * 36 + 2}px` }}>
            <p>
              <span>Input</span>
              <strong>{formatDollars(item().input)}</strong>
            </p>
            <p>
              <span>Output</span>
              <strong>{formatDollars(item().output)}</strong>
            </p>
            <p>
              <span>Cached</span>
              <strong>{formatDollars(item().cached)}</strong>
            </p>
          </div>
        )}
      </Show>
    </div>
  )
}

function formatDollars(value: number) {
  return `$${value.toFixed(2)}`
}

function MetricBar(props: { value: number; max: number; active: boolean }) {
  const fill = createMemo(() => Math.min(1, Math.max(props.value / props.max, props.value > 0 ? 0.03 : 0)))
  return (
    <i
      data-component="metric-bar"
      data-active={props.active ? "true" : undefined}
      style={{ "--metric-bar-fill": `${fill() * 100}%` } as JSX.CSSProperties}
    >
      <b />
      <em />
    </i>
  )
}

function SessionCostSection(props: { data: StatsHomeData["sessionCost"] }) {
  const [product, setProduct] = createSignal<TokenProduct>("Zen")
  const [activeIndex, setActiveIndex] = createSignal(2)
  const data = createMemo(() => props.data[product()])
  const visible = createMemo(() => data().slice(0, 16))
  const selectedIndex = createMemo(() => Math.min(activeIndex(), Math.max(visible().length - 1, 0)))

  return (
    <section id="session-cost" data-section="session-cost">
      <SectionBridge label="TOKEN COST" href="#token-cost" />
      <SectionTitle title="Session Cost" description="Average cost per session." />
      <Show
        when={visible().length > 0}
        fallback={
          <EmptyState
            title="No session cost data"
            description="No session-bearing model_stat rows matched this product."
          />
        }
      >
        <SessionCostChart data={visible()} activeIndex={selectedIndex()} onActiveIndexChange={setActiveIndex} />
      </Show>
      <div data-slot="token-footer">
        <FilterPills
          items={tokenProducts}
          selected={product()}
          label="Product filter"
          variant="product"
          onSelect={setProduct}
        />
        <LiveIndicator />
      </div>
    </section>
  )
}

function SessionCostChart(props: {
  data: SessionCostEntry[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
}) {
  const maxCost = createMemo(() => Math.max(0, ...props.data.map((item) => item.cost)) || 1)
  const maxTokens = createMemo(() => Math.max(0, ...props.data.map((item) => item.tokens)) || 1)
  const active = createMemo(() => props.data[props.activeIndex] ?? props.data[0])

  return (
    <div data-component="session-cost">
      <div data-slot="session-heading">
        <strong aria-hidden="true" />
        <span aria-hidden="true" />
        <p>COST / SESSION</p>
        <p>TOKENS / SESSION</p>
      </div>
      <For each={props.data}>
        {(item, index) => (
          <button
            type="button"
            data-component="token-row"
            data-variant="session"
            data-active={props.activeIndex === index() ? "true" : undefined}
            onClick={() => props.onActiveIndexChange(index())}
            onPointerEnter={() => props.onActiveIndexChange(index())}
          >
            <strong>{formatSessionCost(item.cost)}</strong>
            <span>{item.model}</span>
            <MetricBar value={item.cost} max={maxCost()} active={props.activeIndex === index()} />
            <MetricBar value={item.tokens} max={maxTokens()} active={props.activeIndex === index()} />
          </button>
        )}
      </For>
      <Show when={active()}>
        {(item) => (
          <div
            data-component="token-tooltip"
            data-variant="session"
            style={{ top: `${props.activeIndex * 36 + 28}px` }}
          >
            <p>
              <span>Cost/Session</span>
              <strong>{formatSessionCost(item().cost)}</strong>
            </p>
            <p>
              <span>Tokens/Session</span>
              <strong>{formatTokenCount(item().tokens)}</strong>
            </p>
          </div>
        )}
      </Show>
    </div>
  )
}

function LiveIndicator() {
  return <span data-component="live-filter">Live</span>
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  return `${Math.round(value / 1_000)}K`
}

function formatSessionCost(value: number) {
  return `$${value.toFixed(4)}`
}

function Header(props: { githubStars: string }) {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [menuViewport, setMenuViewport] = createSignal(false)

  createEffect(() => {
    if (typeof window === "undefined") return
    const media = window.matchMedia("(max-width: 74.999rem)")
    const update = () => setMenuViewport(media.matches)
    update()
    media.addEventListener("change", update)
    onCleanup(() => media.removeEventListener("change", update))
  })

  createEffect(() => {
    if (!menuOpen()) return
    if (!menuViewport()) return
    if (typeof document === "undefined") return
    const page = document.querySelector<HTMLElement>('[data-page="stats"]')
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    const htmlOverflow = document.documentElement.style.overflow
    const pagePaddingRight = page?.style.paddingRight
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = "hidden"
    if (scrollbarWidth > 0 && page) page.style.paddingRight = `${scrollbarWidth}px`
    document.body.style.overflow = "hidden"
    onCleanup(() => {
      document.documentElement.style.overflow = htmlOverflow
      if (page && pagePaddingRight !== undefined) page.style.paddingRight = pagePaddingRight
      document.body.style.overflow = bodyOverflow
    })
  })

  return (
    <header data-component="top" data-menu-open={menuOpen() ? "true" : undefined}>
      <div data-slot="header-bar">
        <a data-slot="brand" href={import.meta.env.BASE_URL} aria-label="Stats home">
          <StatsWordmark />
        </a>
        <nav data-component="section-nav" aria-label="Stats sections">
          <ul>
            <For each={headerLinks}>
              {(link) => (
                <li>
                  <a href={link.href}>{link.label}</a>
                </li>
              )}
            </For>
          </ul>
        </nav>
        <div data-slot="header-actions">
          <a
            data-slot="header-button"
            data-variant="neutral"
            href={githubLink.href}
            target="_blank"
            rel="noreferrer"
            aria-label={`${githubLink.ariaLabel} (${props.githubStars} stars)`}
          >
            <strong>{githubLink.label}</strong>
            <span>[{props.githubStars}]</span>
          </a>
          <a data-slot="header-button" data-variant="contrast" href="https://opencode.ai/">
            <strong>Try OpenCode</strong>
          </a>
          <button
            data-slot="menu-button"
            type="button"
            aria-controls="stats-mobile-nav"
            aria-expanded={menuOpen() ? "true" : "false"}
            aria-label={menuOpen() ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <Show when={menuOpen()} fallback={<path d="M2 4.72H14M2 8.5H14M2 12.28H14" stroke="currentColor" />}>
                <path d="M4.44 4.44L11.56 11.56M11.56 4.44L4.44 11.56" stroke="currentColor" />
              </Show>
            </svg>
          </button>
        </div>
      </div>
      <nav id="stats-mobile-nav" data-slot="mobile-menu" aria-label="Stats sections" hidden={!menuOpen()}>
        <a
          data-slot="mobile-menu-item"
          data-variant="github"
          href={githubLink.href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${githubLink.ariaLabel} (${props.githubStars} stars)`}
        >
          <strong>{githubLink.label}</strong>
          <span>[{props.githubStars}]</span>
        </a>
        <For each={headerLinks}>
          {(link) => (
            <a data-slot="mobile-menu-item" href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label}
            </a>
          )}
        </For>
      </nav>
    </header>
  )
}

function StatsWordmark() {
  return (
    <span data-slot="stats-wordmark" aria-hidden="true">
      <StatsMark />
      <svg data-slot="brand-label" width="51" height="14" viewBox="0 0 50.8509 14" fill="none">
        <path
          d="M46.2359 14C45.2276 14 44.3356 13.819 43.56 13.4571C42.7973 13.0822 42.138 12.5328 41.5822 11.8089L43.1722 10.277C43.56 10.807 44.0124 11.2142 44.5295 11.4986C45.0466 11.7701 45.6283 11.9058 46.2747 11.9058C47.7225 11.9058 48.4464 11.2465 48.4464 9.92798C48.4464 9.38504 48.3172 8.97138 48.0586 8.68698C47.8001 8.40259 47.3735 8.19575 46.7788 8.06648L45.596 7.8338C44.3679 7.57525 43.463 7.13573 42.8813 6.51524C42.2996 5.89474 42.0088 5.02862 42.0088 3.9169C42.0088 2.62419 42.3901 1.6482 43.1528 0.98892C43.9284 0.32964 45.0272 0 46.4492 0C47.4187 0 48.2461 0.161588 48.9312 0.484764C49.6293 0.795014 50.2239 1.28624 50.7151 1.95845L49.1251 3.45152C48.789 2.99908 48.4076 2.66297 47.9811 2.44321C47.5545 2.21053 47.0309 2.09418 46.4104 2.09418C45.7253 2.09418 45.2211 2.22992 44.898 2.50139C44.5748 2.77285 44.4132 3.21237 44.4132 3.81995C44.4132 4.3241 44.536 4.71191 44.7816 4.98338C45.0401 5.25485 45.4538 5.45522 46.0226 5.58449L47.2054 5.83656C47.8647 5.97876 48.4206 6.15328 48.873 6.36011C49.3384 6.56694 49.7133 6.82548 49.9977 7.13573C50.295 7.44598 50.5083 7.8144 50.6376 8.241C50.7798 8.65466 50.8509 9.14589 50.8509 9.71468C50.8509 11.1108 50.4501 12.1773 49.6486 12.9141C48.8601 13.638 47.7225 14 46.2359 14Z"
          fill="currentColor"
        />
        <path
          d="M36.9543 2.34643V13.7675H34.5305V2.34643H31.1371V0.232856H40.367V2.34643H36.9543Z"
          fill="currentColor"
        />
        <path
          d="M28.6196 13.7675L27.6695 10.2384H23.3066L22.3565 13.7675H20.0296L23.9853 0.232856H27.049L31.0047 13.7675H28.6196ZM26.0407 4.57635L25.6141 2.42399H25.3426L24.916 4.57635L23.8883 8.27995H27.0878L26.0407 4.57635Z"
          fill="currentColor"
        />
        <path
          d="M16.4849 2.34643V13.7675H14.0611V2.34643H10.6678V0.232856H19.8977V2.34643H16.4849Z"
          fill="currentColor"
        />
        <path
          d="M4.65374 14C3.64543 14 2.75346 13.819 1.97784 13.4571C1.21514 13.0822 0.555863 12.5328 0 11.8089L1.59003 10.277C1.97784 10.807 2.43029 11.2142 2.94737 11.4986C3.46445 11.7701 4.04617 11.9058 4.69252 11.9058C6.14035 11.9058 6.86427 11.2465 6.86427 9.92798C6.86427 9.38504 6.735 8.97138 6.47646 8.68698C6.21791 8.40259 5.79132 8.19575 5.19668 8.06648L4.01385 7.8338C2.78578 7.57525 1.88089 7.13573 1.29917 6.51524C0.717452 5.89474 0.426593 5.02862 0.426593 3.9169C0.426593 2.62419 0.807941 1.6482 1.57064 0.98892C2.34626 0.32964 3.44506 0 4.86704 0C5.83657 0 6.6639 0.161588 7.34903 0.484764C8.04709 0.795014 8.64174 1.28624 9.13297 1.95845L7.54294 3.45152C7.20683 2.99908 6.82549 2.66297 6.39889 2.44321C5.9723 2.21053 5.44875 2.09418 4.82826 2.09418C4.14312 2.09418 3.63897 2.22992 3.31579 2.50139C2.99261 2.77285 2.83103 3.21237 2.83103 3.81995C2.83103 4.3241 2.95383 4.71191 3.19945 4.98338C3.45799 5.25485 3.87165 5.45522 4.44044 5.58449L5.62327 5.83656C6.28255 5.97876 6.83841 6.15328 7.29086 6.36011C7.75623 6.56694 8.13112 6.82548 8.41551 7.13573C8.71284 7.44598 8.92613 7.8144 9.0554 8.241C9.1976 8.65466 9.2687 9.14589 9.2687 9.71468C9.2687 11.1108 8.86796 12.1773 8.06648 12.9141C7.27793 13.638 6.14035 14 4.65374 14Z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}

function StatsMark() {
  return (
    <svg data-slot="brand-mark" width="19" height="24" viewBox="0 0 19 24" fill="none" aria-hidden="true">
      <path opacity="0.2" d="M14.25 19.2H4.75V9.6H14.25V19.2Z" fill="currentColor" />
      <path d="M14.25 4.8H4.75V19.2H14.25V4.8ZM19 24H0V0H19V24Z" fill="currentColor" />
    </svg>
  )
}

function OpenCodeMark() {
  return (
    <svg data-slot="opencode-mark" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M40 40H0V0H40V40Z" fill="var(--stats-logo-bg)" />
      <path d="M26 29H14V17H26V29Z" fill="var(--stats-logo-fill)" />
      <path d="M26 11H14V29H26V11ZM32 35H8V5H32V35Z" fill="var(--stats-logo-stroke)" />
    </svg>
  )
}

function Footer() {
  const [subscribeOpen, setSubscribeOpen] = createSignal(false)
  const modelStats = [
    { href: "#top-models", label: "Top Models" },
    { href: "#leaderboard", label: "Leaderboard" },
    { href: "#market-share", label: "Market Share" },
    { href: "#token-cost", label: "Token Cost" },
    { href: "#session-cost", label: "Session Cost" },
  ]
  const legal = [
    { href: "https://opencode.ai/legal/terms-of-service", label: "Terms of service" },
    { href: "https://opencode.ai/legal/privacy-policy", label: "Privacy policy" },
  ]
  const connect = [
    { href: "mailto:hello@opencode.ai", label: "Contact us" },
    { href: "https://opencode.ai/discord", label: "Community" },
    { href: "https://x.com/opencode", label: "X" },
    githubLink,
    { href: "https://www.youtube.com/@anomaly-co", label: "YouTube" },
  ]

  return (
    <footer data-component="footer">
      <SectionBridge label="SESSION COST" href="#session-cost" />
      <div data-slot="footer-grid">
        <a data-slot="footer-mark" href="https://opencode.ai" aria-label="OpenCode home">
          <OpenCodeMark />
        </a>
        <FooterColumn title="Model Stats" links={modelStats} />
        <FooterColumn title="Legal" links={legal} />
        <FooterColumn title="Connect" links={connect} />
        <div data-slot="footer-column">
          <h2>Newsletter</h2>
          <p>Be the first to know about new releases.</p>
          <button data-slot="subscribe-button" type="button" onClick={() => setSubscribeOpen(true)}>
            Subscribe
          </button>
        </div>
      </div>
      <div data-slot="footer-pattern" aria-hidden="true" />
      <div data-slot="footer-bottom">
        <div>
          <span>© 2026 Anomaly Innovations Inc.</span>
          <span data-slot="status">All systems Operational</span>
        </div>
      </div>
      <Show when={subscribeOpen()}>
        <SubscribeModal onClose={() => setSubscribeOpen(false)} />
      </Show>
    </footer>
  )
}

function SubscribeModal(props: { onClose: () => void }) {
  const [status, setStatus] = createSignal<"idle" | "pending" | "success" | "error">("idle")
  const [message, setMessage] = createSignal("")
  let input: HTMLInputElement | undefined

  onMount(() => {
    if (typeof document === "undefined") return
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    const focusTimeout = window.setTimeout(() => input?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      window.clearTimeout(focusTimeout)
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
      document.removeEventListener("keydown", onKeyDown)
      activeElement?.focus()
    })
  })

  return (
    <div data-component="subscribe-modal" role="dialog" aria-modal="true" aria-labelledby="subscribe-title">
      <div data-slot="modal-scrim" aria-hidden="true" onClick={props.onClose} />
      <div data-slot="modal-panel">
        <div data-slot="modal-brand">
          <img data-slot="modal-logo" src={opencodeWordmarkDark} alt="OpenCode" />
          <button data-slot="modal-close" type="button" aria-label="Close newsletter signup" onClick={props.onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4.44 4.44L11.56 11.56M11.56 4.44L4.44 11.56" stroke="currentColor" />
            </svg>
          </button>
        </div>
        <div data-slot="modal-body">
          <div data-slot="modal-intro">
            <h2 id="subscribe-title">OpenCode Newsletter</h2>
            <p>
              Be the first to know
              <br />
              about new releases.
            </p>
          </div>
          <form
            data-slot="subscribe-form"
            method="post"
            onSubmit={(event) => {
              event.preventDefault()
              setStatus("pending")
              setMessage("")
              fetch(`${import.meta.env.BASE_URL}api/newsletter`, {
                method: "POST",
                body: new FormData(event.currentTarget),
              }).then(
                async (response) => {
                  if (response.ok) {
                    event.currentTarget.reset()
                    setStatus("success")
                    return
                  }
                  setMessage(await newsletterErrorMessage(response))
                  setStatus("error")
                },
                () => {
                  setMessage("Failed to subscribe")
                  setStatus("error")
                },
              )
            }}
          >
            <input ref={input} type="email" name="email" placeholder="Email address" required />
            <button type="submit" disabled={status() === "pending"}>
              {status() === "pending" ? "Subscribing..." : "Subscribe"}
            </button>
          </form>
          <div data-slot="subscribe-feedback" aria-live="polite">
            <Show when={status() === "success"}>
              <p data-state="success">You're subscribed.</p>
            </Show>
            <Show when={status() === "error"}>
              <p data-state="error">{message()}</p>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

function newsletterErrorMessage(response: Response) {
  return response.json().then(
    (body: unknown) =>
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "Failed to subscribe",
    () => "Failed to subscribe",
  )
}

function FooterColumn(props: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div data-slot="footer-column">
      <h2>{props.title}</h2>
      <nav aria-label={props.title}>
        <For each={props.links}>
          {(link) => (
            <a href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              {link.label}
            </a>
          )}
        </For>
      </nav>
    </div>
  )
}
