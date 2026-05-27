import "./index.css"
import { Meta, Title } from "@solidjs/meta"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import {
  type CountryEntry,
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
import { scaleBand, scaleLinear } from "d3-scale"
import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import logoDark from "../asset/logo-ornate-dark.svg"
import logoLight from "../asset/logo-ornate-light.svg"

const products = ["All Users", "Zen", "Go", "Enterprise"] as const
const tokenProducts = ["Zen", "Go", "Enterprise"] as const
const ranges = ["1D", "1W", "1M", "3M", "YTD", "ALL"] as const
const usageColors = ["#ff5d64", "#ff8a00", "#8bef00", "#12c8b3", "#18c7dc", "#6c7dff", "#9d73f7"]
const marketColors = ["#ed6aff", "#a684ff", "#7c86ff", "#51a2ff", "#00d3f2", "#00d5be", "#00bc7d", "#9ae600", "#ffb900"]
const countryPositions = [
  { x: 112, y: 96 },
  { x: 284, y: 144 },
  { x: 472, y: 92 },
  { x: 642, y: 154 },
  { x: 800, y: 96 },
  { x: 172, y: 234 },
  { x: 362, y: 250 },
  { x: 552, y: 236 },
  { x: 744, y: 252 },
  { x: 48, y: 184 },
  { x: 892, y: 198 },
  { x: 456, y: 176 },
] as const

type UsageProduct = (typeof products)[number]
type TokenProduct = (typeof tokenProducts)[number]
type UsageRange = (typeof ranges)[number]

const getData = query(async () => {
  "use server"
  return runtime.runPromise(getStatsHomeData())
}, "getStatsHomeData")

export default function StatsHome() {
  getRequestEvent()?.response.headers.set(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
  )
  const data = createAsync(() => getData())

  return (
    <main data-page="stats">
      <Title>OpenCode Stats</Title>
      <Meta name="description" content="OpenCode usage, market share, token cost, and session cost stats." />
      <div data-component="container">
        <Header />
        <div data-component="content">
          <Show when={data()} fallback={<StatsLoading />}>
            {(stats) => (
              <>
                <Hero updatedAt={stats().updatedAt} />
                <UsageSection data={stats().usage} />
                <LeaderboardSection data={stats().leaderboard} />
                <MarketShareSection data={stats().market} />
                <TokenCostSection data={stats().tokenCost} />
                <SessionCostSection data={stats().sessionCost} />
                <CountrySection data={stats().country} />
                <Newsletter />
              </>
            )}
          </Show>
        </div>
        <Footer />
      </div>
      <Legal />
    </main>
  )
}

function Hero(props: { updatedAt: string | null }) {
  return (
    <section data-section="hero">
      <div>
        <h1>OpenCode Stats</h1>
        <p data-slot="meta">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
            <rect x="3" y="3" width="10" height="10" fill="currentColor" />
            <rect x="7" y="6.5" width="2" height="4.5" fill="var(--stats-layer-2)" />
            <rect x="7" y="5" width="2" height="1" fill="var(--stats-layer-2)" />
          </svg>
          <span>OpenCode data</span> <b>·</b>{" "}
          <em>{props.updatedAt ? `Updated ${formatUpdatedAt(props.updatedAt)}` : "No rows yet"}</em>
        </p>
      </div>
      <p>See how model usage, provider share, cost, and geography move across OpenCode traffic.</p>
    </section>
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

function ChartSection(props: { title: string; description?: string; controls?: JSX.Element; children: JSX.Element }) {
  return (
    <section data-section="chart">
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

function EmptyState(props: { title: string; description: string }) {
  return (
    <div data-component="empty-state">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  )
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "just now"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date)
}

function UsageSection(props: { data: StatsHomeData["usage"] }) {
  const [product, setProduct] = createSignal<UsageProduct>("All Users")
  const [range, setRange] = createSignal<UsageRange>("1W")
  const data = createMemo(() => props.data[product()][range()])

  return (
    <ChartSection title="Usage">
      <Show
        when={data().some((item) => usageTotal(item) > 0)}
        fallback={<EmptyState title="No usage data" description="No model_stat rows matched this product and range." />}
      >
        <UsageChart data={data()} />
      </Show>
      <div data-slot="chart-footer">
        <StatsFilters product={product()} range={range()} onProductSelect={setProduct} onRangeSelect={setRange} />
      </div>
    </ChartSection>
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

function UsageChart(props: { data: UsagePoint[] }) {
  const [activeIndex, setActiveIndex] = createSignal<number>()
  const [activeSegment, setActiveSegment] = createSignal<number>()
  const height = 434
  const width = 920
  const headerOffset = 46
  const segmentGap = 2
  const maxTotal = createMemo(() => Math.max(1, Math.max(...props.data.map((item) => usageTotal(item))) * 1.02))
  const activePoint = createMemo(() => props.data[activeIndex() ?? -1])
  const y = createMemo(() => scaleLinear([0, maxTotal()], [height, 0]))
  const x = createMemo(() =>
    scaleBand(
      props.data.map((_, index) => String(index)),
      [0, width],
    ).paddingInner(0.08),
  )
  const activeBar = createMemo(() => {
    const index = activeIndex()
    const point = activePoint()
    if (index === undefined) return
    if (!point) return
    return {
      point,
      x: x()(String(index)) ?? 0,
      width: x().bandwidth(),
    }
  })

  return (
    <div data-component="usage-chart">
      <svg viewBox={`0 0 ${width} ${height + headerOffset}`} role="img" aria-label="Stacked usage chart">
        <defs>
          <pattern id="stats-usage-dot-grid" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect x="1" y="1" width="2" height="2" fill="var(--stats-dot)" />
          </pattern>
        </defs>
        <For each={props.data}>
          {(day, dayIndex) => {
            const barX = x()(String(dayIndex())) ?? 0
            const barWidth = x().bandwidth()
            const stackTop = y()(usageTotal(day))
            return (
              <g
                role="button"
                tabIndex={0}
                aria-label={`${day.date} ${formatTokens(usageTotal(day))}`}
                data-active={activeIndex() === dayIndex() ? "true" : undefined}
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
                }}
              >
                <rect
                  x={barX}
                  y="0"
                  width={barWidth}
                  height={height + headerOffset}
                  fill="transparent"
                  pointer-events="all"
                />
                <text x={barX} y="17" class="chart-total">
                  {formatTokens(usageTotal(day))}
                </text>
                <text x={barX} y="34" class="chart-date">
                  {day.date}
                </text>
                <rect x={barX} y={headerOffset} width={barWidth} height={stackTop} fill="url(#stats-usage-dot-grid)" />
                <For each={day.segments}>
                  {(segment, index) => {
                    const previous = day.segments.slice(0, index()).reduce((sum, item) => sum + item.value, 0)
                    const segmentHeight = y()(previous) - y()(previous + segment.value)
                    const segmentInset = index() === day.segments.length - 1 ? 0 : segmentGap
                    return (
                      <rect
                        x={barX}
                        y={headerOffset + y()(previous + segment.value) + segmentInset}
                        width={barWidth}
                        height={Math.max(segmentHeight - segmentInset, 0)}
                        data-segment-active={
                          activeIndex() === dayIndex() && activeSegment() === index() ? "true" : undefined
                        }
                        opacity={getUsageSegmentOpacity(activeIndex() === dayIndex(), activeSegment(), index())}
                        fill={activeIndex() === dayIndex() ? usageColors[index()] : "var(--stats-bar-idle)"}
                        onPointerEnter={(event) => {
                          event.stopPropagation()
                          setActiveIndex(dayIndex())
                          setActiveSegment(index())
                        }}
                      />
                    )
                  }}
                </For>
              </g>
            )
          }}
        </For>
      </svg>
      <Show when={activeBar()}>
        {(bar) => (
          <div
            data-component="chart-tooltip"
            data-placement={bar().x > width * 0.62 ? "left" : "right"}
            style={getUsageTooltipStyle(bar().x, bar().width, width)}
          >
            <strong>{bar().point.date}</strong>
            <span>{formatTokens(usageTotal(bar().point))} total</span>
            <div data-slot="tooltip-divider" />
            <For each={bar().point.segments}>
              {(segment, index) => (
                <p data-active={activeSegment() === index() ? "true" : undefined}>
                  <span data-slot="tooltip-label">
                    <i style={{ background: usageColors[index()] }} /> {segment.model}
                  </span>
                  <b>{formatTokens(segment.value)}</b>
                </p>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  )
}

function getUsageTooltipStyle(barX: number, barWidth: number, width: number) {
  if (barX > width * 0.62) return { left: "auto", right: `${((width - barX + 12) / width) * 100}%` }
  return { left: `${((barX + barWidth + 12) / width) * 100}%`, right: "auto" }
}

function getUsageSegmentOpacity(isActiveBar: boolean, activeSegment: number | undefined, index: number) {
  if (!isActiveBar) return 1
  if (activeSegment === undefined) return 1
  return activeSegment === index ? 1 : 0.38
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
    <ChartSection
      title="Leaderboard"
      description="Shown are the sum of prompt and completion tokens per model, including reasoning tokens."
    >
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
    </ChartSection>
  )
}

function Leaderboard(props: { data: LeaderboardEntry[] }) {
  return (
    <div data-component="leaderboard" aria-label="Model token leaderboard">
      <div data-slot="leaderboard-grid">
        <div data-slot="leaderboard-featured">
          <For each={props.data.slice(0, 3)}>{(entry) => <LeaderboardCard entry={entry} size="featured" />}</For>
        </div>
        <div data-slot="leaderboard-compact">
          <For each={props.data.slice(3)}>{(entry) => <LeaderboardCard entry={entry} size="compact" />}</For>
        </div>
      </div>
    </div>
  )
}

function LeaderboardCard(props: { entry: LeaderboardEntry; size: "featured" | "compact" }) {
  return (
    <article data-component="leader-card" data-size={props.size}>
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
  const data = createMemo(() => props.data[range()])
  const selectedIndex = createMemo(() => Math.min(activeIndex(), Math.max(data().length - 1, 0)))
  const activeDay = createMemo(() => data()[selectedIndex()])

  return (
    <ChartSection title="Market Share" description="Compare token share by model author.">
      <Show
        when={activeDay()}
        fallback={<EmptyState title="No market data" description="No model_stat rows matched this range." />}
      >
        {(day) => (
          <>
            <MarketShare data={data()} activeIndex={selectedIndex()} onActiveIndexChange={setActiveIndex} />
            <MarketShareList data={day().authors} />
          </>
        )}
      </Show>
      <div data-slot="market-footer">
        <p>
          <span>[*]</span>
          <strong>{activeDay()?.date ?? "No data"}</strong>
        </p>
        <FilterPills items={ranges} selected={range()} label="Date range" variant="range" onSelect={setRange} />
      </div>
    </ChartSection>
  )
}

function MarketShare(props: { data: MarketDay[]; activeIndex: number; onActiveIndexChange: (index: number) => void }) {
  return (
    <div data-component="market-share" role="img" aria-label="Market share by model author">
      <div data-slot="market-labels">
        <For each={props.data}>
          {(day, index) => (
            <button
              type="button"
              data-active={props.activeIndex === index() ? "true" : undefined}
              onClick={() => props.onActiveIndexChange(index())}
            >
              <span>{formatTrillions(day.total)}</span>
              <span>{day.date}</span>
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
              data-active={props.activeIndex === index() ? "true" : undefined}
              onClick={() => props.onActiveIndexChange(index())}
            >
              <For each={day.authors}>
                {(author, authorIndex) => (
                  <span
                    style={{
                      "background-color": props.activeIndex === index() ? marketColors[authorIndex()] : undefined,
                      "flex-grow": author.share,
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

function MarketShareList(props: { data: MarketDay["authors"] }) {
  return (
    <ol data-component="market-share-list">
      <For each={props.data}>
        {(item, index) => (
          <li>
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

function formatTrillions(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}T`
}

function TokenCostSection(props: { data: StatsHomeData["tokenCost"] }) {
  const [product, setProduct] = createSignal<TokenProduct>("Zen")
  const [activeIndex, setActiveIndex] = createSignal(2)
  const data = createMemo(() => props.data[product()])
  const selectedIndex = createMemo(() => Math.min(activeIndex(), Math.max(data().length - 1, 0)))

  return (
    <ChartSection title="Token Cost" description="Price per 1M tokens.">
      <Show
        when={data().length > 0}
        fallback={
          <EmptyState title="No token cost data" description="No cost-bearing model_stat rows matched this product." />
        }
      >
        <TokenCostChart data={data()} activeIndex={selectedIndex()} onActiveIndexChange={setActiveIndex} />
      </Show>
      <div data-slot="token-footer">
        <FilterPills
          items={tokenProducts}
          selected={product()}
          label="Product filter"
          variant="product"
          onSelect={setProduct}
        />
      </div>
    </ChartSection>
  )
}

function TokenCostChart(props: {
  data: TokenCostEntry[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
}) {
  const max = createMemo(() => Math.max(1, ...props.data.map((item) => item.total)))
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
          <div data-component="token-tooltip" style={{ top: `${props.activeIndex * 28 + 2}px` }}>
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
  return (
    <i data-component="metric-bar" data-active={props.active ? "true" : undefined}>
      <b style={{ "flex-grow": Math.max(props.value / Math.max(props.max, 1), 0.05) }} />
      <em />
    </i>
  )
}

function SessionCostSection(props: { data: StatsHomeData["sessionCost"] }) {
  const [product, setProduct] = createSignal<TokenProduct>("Zen")
  const [activeIndex, setActiveIndex] = createSignal(2)
  const data = createMemo(() => props.data[product()])
  const selectedIndex = createMemo(() => Math.min(activeIndex(), Math.max(data().length - 1, 0)))

  return (
    <ChartSection title="Session Cost" description="Average cost per session.">
      <Show
        when={data().length > 0}
        fallback={
          <EmptyState
            title="No session cost data"
            description="No session-bearing model_stat rows matched this product."
          />
        }
      >
        <SessionCostChart data={data()} activeIndex={selectedIndex()} onActiveIndexChange={setActiveIndex} />
      </Show>
      <div data-slot="token-footer">
        <FilterPills
          items={tokenProducts}
          selected={product()}
          label="Product filter"
          variant="product"
          onSelect={setProduct}
        />
      </div>
    </ChartSection>
  )
}

function SessionCostChart(props: {
  data: SessionCostEntry[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
}) {
  const maxCost = createMemo(() => Math.max(1, ...props.data.map((item) => item.cost)))
  const maxTokens = createMemo(() => Math.max(1, ...props.data.map((item) => item.tokens)))
  const active = createMemo(() => props.data[props.activeIndex] ?? props.data[0])

  return (
    <div data-component="session-cost">
      <div data-slot="session-heading">
        <span />
        <p>COST / SESSION</p>
        <p>TOKENS / SESSIONS</p>
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
            style={{ top: `${props.activeIndex * 28 + 21}px` }}
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

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  return `${Math.round(value / 1_000)}K`
}

function formatSessionCost(value: number) {
  return `$${value.toFixed(4)}`
}

function CountrySection(props: { data: StatsHomeData["country"] }) {
  const [range, setRange] = createSignal<UsageRange>("1W")
  const data = createMemo(() => props.data[range()])

  return (
    <ChartSection title="Token by Country" description="Country-level token totals from geo_stat.">
      <Show
        when={data().length > 0}
        fallback={<EmptyState title="No country data" description="No geo_stat rows matched this range." />}
      >
        <CountryChart data={data()} />
      </Show>
      <div data-slot="country-footer">
        <p>
          <span>[*]</span>
          <strong>Top countries by tokens</strong>
        </p>
        <FilterPills items={ranges} selected={range()} label="Date range" variant="range" onSelect={setRange} />
      </div>
    </ChartSection>
  )
}

function CountryChart(props: { data: CountryEntry[] }) {
  const [activeIndex, setActiveIndex] = createSignal(0)
  const selectedIndex = createMemo(() => Math.min(activeIndex(), Math.max(props.data.length - 1, 0)))
  const active = createMemo(() => props.data[selectedIndex()])
  const max = createMemo(() => Math.max(0.0001, ...props.data.map((item) => item.tokens)))

  return (
    <div data-component="country-map">
      <svg viewBox="0 0 920 320" role="img" aria-label="Country token share bubble chart">
        <For each={props.data.slice(0, countryPositions.length)}>
          {(item, index) => {
            const position = countryPositions[index()]
            const radius = 18 + Math.sqrt(item.tokens / max()) * 58
            return (
              <g
                role="button"
                tabIndex={0}
                aria-label={`${formatCountry(item.country)} ${formatTokens(item.tokens)}`}
                data-active={selectedIndex() === index() ? "true" : undefined}
                onPointerEnter={() => setActiveIndex(index())}
                onClick={() => setActiveIndex(index())}
                onFocus={() => setActiveIndex(index())}
              >
                <circle cx={position.x} cy={position.y} r={radius} />
                <text x={position.x} y={position.y + 4} text-anchor="middle">
                  {item.country}
                </text>
              </g>
            )
          }}
        </For>
      </svg>
      <Show when={active()}>
        {(item) => (
          <div data-component="map-tooltip">
            <strong>{formatCountry(item().country)}</strong>
            <span>{item().continent || "Unknown region"}</span>
            <p>
              <b>{formatTokens(item().tokens)}</b>
              <em>{item().share.toFixed(1)}%</em>
            </p>
          </div>
        )}
      </Show>
      <CountryList data={props.data.slice(0, 8)} activeIndex={selectedIndex()} onActiveIndexChange={setActiveIndex} />
    </div>
  )
}

function CountryList(props: {
  data: CountryEntry[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
}) {
  return (
    <ol data-component="country-list">
      <For each={props.data}>
        {(item, index) => (
          <li>
            <button
              type="button"
              data-active={props.activeIndex === index() ? "true" : undefined}
              onClick={() => props.onActiveIndexChange(index())}
              onPointerEnter={() => props.onActiveIndexChange(index())}
            >
              <span>{String(item.rank).padStart(2, "0")}</span>
              <strong>{formatCountry(item.country)}</strong>
              <em>{formatTokens(item.tokens)}</em>
              <b>{item.share.toFixed(1)}%</b>
            </button>
          </li>
        )}
      </For>
    </ol>
  )
}

function formatCountry(country: string) {
  const known: Record<string, string> = {
    AU: "Australia",
    BR: "Brazil",
    CA: "Canada",
    CN: "China",
    DE: "Germany",
    FR: "France",
    GB: "United Kingdom",
    IN: "India",
    JP: "Japan",
    KR: "South Korea",
    NL: "Netherlands",
    SG: "Singapore",
    US: "United States",
    ZZ: "Unknown",
  }
  return known[country] ?? country
}

function Newsletter() {
  return (
    <section data-section="newsletter">
      <div>
        <h2>Be the first to know when we release new products</h2>
        <p>Join the waitlist for early access.</p>
      </div>
      <form>
        <input type="email" placeholder="Email address" />
        <button>Subscribe</button>
      </form>
    </section>
  )
}

function Header() {
  return (
    <section data-component="top">
      <a data-slot="brand" href="https://opencode.ai/" aria-label="OpenCode home">
        <img data-slot="logo light" src={logoLight} alt="OpenCode" width="234" height="42" />
        <img data-slot="logo dark" src={logoDark} alt="OpenCode" width="234" height="42" />
      </a>
      <nav data-component="nav-desktop" aria-label="Main navigation">
        <ul>
          <li>
            <a href="https://github.com/sst/opencode" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </li>
          <li>
            <a href="https://opencode.ai/docs">Docs</a>
          </li>
          <li>
            <a href="https://opencode.ai/zen">Zen</a>
          </li>
          <li>
            <a href="https://opencode.ai/go">Go</a>
          </li>
          <li>
            <a href="https://opencode.ai/enterprise">Enterprise</a>
          </li>
          <li>
            <a href="https://opencode.ai/download" data-slot="cta-button">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path
                  d="M12.1875 9.75L9.00001 12.9375L5.8125 9.75M9.00001 2.0625L9 12.375M14.4375 15.9375H3.5625"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="square"
                />
              </svg>
              Download
            </a>
          </li>
        </ul>
      </nav>
    </section>
  )
}

function Footer() {
  return (
    <footer data-component="footer">
      <div data-slot="cell">
        <a href="https://github.com/sst/opencode" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </div>
      <div data-slot="cell">
        <a href="https://opencode.ai/docs">Docs</a>
      </div>
      <div data-slot="cell">
        <a href="https://opencode.ai/changelog">Changelog</a>
      </div>
      <div data-slot="cell">
        <a href="https://x.com/opencode_ai">X</a>
      </div>
    </footer>
  )
}

function Legal() {
  return (
    <div data-component="legal">
      <span>
        ©{new Date().getFullYear()} <a href="https://anoma.ly">Anomaly</a>
      </span>
      <span>
        <a href="https://opencode.ai/brand">Brand</a>
      </span>
      <span>
        <a href="https://opencode.ai/legal/privacy-policy">Privacy</a>
      </span>
      <span>
        <a href="https://opencode.ai/legal/terms-of-service">Terms</a>
      </span>
    </div>
  )
}
