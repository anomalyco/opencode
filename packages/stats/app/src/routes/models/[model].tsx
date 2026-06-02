import "../index.css"
import { Link, Meta, Title } from "@solidjs/meta"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import {
  getStatsModelData,
  type ModelMixEntry,
  type ModelPeerEntry,
  type ModelProductEntry,
  type ModelUsagePoint,
  type StatsModelData,
} from "@opencode-ai/stats-core/domain/home"
import { runtime } from "@opencode-ai/stats-core/runtime"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { getRequestEvent } from "solid-js/web"
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
  { href: "#composition", label: "Composition" },
  { href: "#efficiency", label: "Efficiency" },
  { href: "#peers", label: "Peers" },
]
const modelFooterLinks: readonly HeaderLink[] = [
  { href: import.meta.env.BASE_URL, label: "Stats Home" },
  { href: `${import.meta.env.BASE_URL}#top-models`, label: "Top Models" },
  { href: `${import.meta.env.BASE_URL}#leaderboard`, label: "Leaderboard" },
  { href: `${import.meta.env.BASE_URL}#session-cost`, label: "Session Cost" },
  { href: `${import.meta.env.BASE_URL}#token-cost`, label: "Token Cost" },
  { href: `${import.meta.env.BASE_URL}#market-share`, label: "Market Share" },
]

const getModelData = query(async (model: string) => {
  "use server"
  return runtime.runPromise(getStatsModelData(model))
}, "getStatsModelData")

export default function StatsModel() {
  const event = getRequestEvent()
  event?.response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400")
  const params = useParams()
  const modelParam = createMemo(() => params.model ?? "")
  const data = createAsync(() => (modelParam() ? getModelData(modelParam()) : Promise.resolve(null)))
  const githubStars = createAsync(() => getGitHubStars())
  const [themePreference, setThemePreference] = createSignal<ThemePreference>("system")
  const modelTitle = createMemo(() => (data()?.model ? `${data()!.model} Stats` : "Model Stats"))
  const modelDescription = createMemo(() =>
    data()?.model
      ? `${data()!.model} usage, rank, token mix, cost, and peer stats across OpenCode.`
      : "Model usage, rank, token mix, cost, and peer stats across OpenCode.",
  )
  const modelUrl = createMemo(() =>
    new URL(
      `${import.meta.env.BASE_URL}models/${data()?.slug ?? modelParam()}`,
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
          <Show when={data() !== undefined} fallback={<ModelLoading />}>
            <Show when={data()} fallback={<ModelNotFound model={modelParam()} />}>
              {(stats) => (
                <>
                  <ModelHero data={stats()} />
                  <ModelOverview data={stats()} />
                  <ModelUsageSection data={stats().usage} />
                  <ModelCompositionSection tokenMix={stats().tokenMix} productMix={stats().productMix} />
                  <ModelEfficiencySection data={stats()} />
                  <ModelPeersSection data={stats()} />
                </>
              )}
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

function ModelNotFound(props: { model: string }) {
  return (
    <>
      <section id="overview" data-section="model-hero">
        <div data-slot="model-hero-grid">
          <div data-slot="model-hero-copy">
            <a data-slot="model-back-link" href={import.meta.env.BASE_URL}>
              Stats
            </a>
            <h1>{props.model || "Model"}</h1>
            <p>No model_stat rows matched this model.</p>
          </div>
        </div>
      </section>
      <section data-section="model-panel">
        <ModelEmptyState title="No model data" description="Try opening a model from the leaderboard." />
      </section>
    </>
  )
}

function ModelHero(props: { data: StatsModelData }) {
  return (
    <section id="overview" data-section="model-hero">
      <a data-slot="model-back-link" href={import.meta.env.BASE_URL}>
        Stats
      </a>
      <div data-slot="model-hero-grid">
        <div data-slot="model-hero-copy">
          <p data-slot="hero-meta">
            <ProviderIcon aria-hidden="true" id={getProviderIconId(props.data.author)} />
            <span>{props.data.author}</span>
          </p>
          <h1>{props.data.model}</h1>
          <div data-slot="model-hero-pattern" aria-hidden="true" />
          <p>
            Ranked #{props.data.rank} across recent OpenCode token usage with {formatPercent(props.data.tokenShare)} of
            observed volume.
          </p>
        </div>
        <div data-component="model-rank-panel">
          <span>Current Rank</span>
          <strong>#{props.data.rank}</strong>
          <p>
            {props.data.previousRank
              ? `${formatRankMove(props.data.previousRank, props.data.rank)} vs previous window`
              : "New in window"}
          </p>
        </div>
      </div>
    </section>
  )
}

function ModelOverview(props: { data: StatsModelData }) {
  return (
    <section data-section="model-panel">
      <SectionTitle title="Overview" description="Recent tokens, sessions, and market position." />
      <div data-component="model-metric-grid">
        <MetricCard label="Tokens" value={formatTokens(props.data.totals.tokens)} detail="last two months" />
        <MetricCard label="Sessions" value={formatInteger(props.data.totals.sessions)} detail="completed sessions" />
        <MetricCard
          label="Token Share"
          value={formatPercent(props.data.tokenShare)}
          detail={`${props.data.totalModels} models`}
        />
        <MetricCard
          label="Momentum"
          value={formatChange(props.data.tokenChange)}
          detail="vs previous window"
          state={props.data.tokenChange < 0 ? "negative" : "positive"}
        />
      </div>
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

function ModelCompositionSection(props: { tokenMix: ModelMixEntry[]; productMix: ModelProductEntry[] }) {
  return (
    <section id="composition" data-section="model-panel">
      <SectionTitle title="Composition" description="Where the model's tokens come from and how they split." />
      <div data-component="model-split-grid">
        <MixPanel title="Token Flow" items={props.tokenMix} />
        <ProductPanel items={props.productMix} />
      </div>
    </section>
  )
}

function ModelEfficiencySection(props: { data: StatsModelData }) {
  return (
    <section id="efficiency" data-section="model-panel">
      <SectionTitle title="Efficiency" description="Cost, cache behavior, and average session shape." />
      <div data-component="model-metric-grid" data-variant="dense">
        <MetricCard label="Cost" value={formatMoney(props.data.totals.cost)} detail="total spend" />
        <MetricCard label="Cost / 1M" value={formatMoney(props.data.totals.costPerMillion)} detail="all tokens" />
        <MetricCard
          label="Cost / Session"
          value={formatSessionCost(props.data.totals.costPerSession)}
          detail="average"
        />
        <MetricCard
          label="Tokens / Session"
          value={formatTokens(props.data.totals.tokensPerSession)}
          detail="average"
        />
        <MetricCard label="Cache Ratio" value={formatPercent(props.data.totals.cacheRatio)} detail="input tokens" />
      </div>
    </section>
  )
}

function ModelPeersSection(props: { data: StatsModelData }) {
  return (
    <section id="peers" data-section="model-panel">
      <SectionTitle title="Peers" description="Nearby models by recent token volume." />
      <ol data-component="model-peer-list">
        <For each={props.data.peers}>{(peer) => <PeerRow peer={peer} active={peer.model === props.data.model} />}</For>
      </ol>
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

function MixPanel(props: { title: string; items: ModelMixEntry[] }) {
  return (
    <div data-component="model-mix-panel">
      <h2>{props.title}</h2>
      <Show
        when={props.items.length > 0}
        fallback={<ModelEmptyState title="No token mix" description="No token buckets were recorded." compact />}
      >
        <For each={props.items}>
          {(item) => <MixRow label={item.label} value={formatTokens(item.tokens)} share={item.share} />}
        </For>
      </Show>
    </div>
  )
}

function ProductPanel(props: { items: ModelProductEntry[] }) {
  return (
    <div data-component="model-mix-panel">
      <h2>Product Mix</h2>
      <Show
        when={props.items.length > 0}
        fallback={<ModelEmptyState title="No product mix" description="No product rows were recorded." compact />}
      >
        <For each={props.items}>
          {(item) => (
            <MixRow
              label={item.product}
              value={formatTokens(item.tokens)}
              share={item.share}
              detail={`${formatInteger(item.sessions)} sessions`}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

function MixRow(props: { label: string; value: string; share: number; detail?: string }) {
  return (
    <div data-component="model-mix-row">
      <div>
        <strong>{props.label}</strong>
        <span>{props.detail ?? props.value}</span>
        <b>{formatPercent(props.share)}</b>
      </div>
      <i style={{ "--model-mix-fill": `${Math.max(props.share, props.share > 0 ? 2 : 0)}%` } as JSX.CSSProperties}>
        <em />
      </i>
    </div>
  )
}

function PeerRow(props: { peer: ModelPeerEntry; active: boolean }) {
  return (
    <li>
      <a href={`${import.meta.env.BASE_URL}models/${props.peer.slug}`} data-active={props.active ? "true" : undefined}>
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
  return author.toLowerCase()
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

function trimNumber(value: number, digits: number) {
  return Number(value.toFixed(digits)).toLocaleString("en")
}
