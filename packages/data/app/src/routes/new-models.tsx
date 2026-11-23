import { ProviderIcon } from "@opencode/ui/provider-icon"
import { createMemo, createSignal, For, Show } from "solid-js"
import { ChartDataTable } from "../component/chart-data-table"
import { useLanguage } from "../context/language"
import { formatTokens } from "../lib/format"
import type { HomePageData } from "../lib/page-data"
import { providerIconId } from "../lib/provider-icon"
import { isKnownCatalogLab } from "./model-catalog"
import { SectionHeading } from "./section-heading"
import "./new-models.css"

type NewModel = HomePageData["newModels"][number]

const colors = ["#ed6aff", "#7c86ff", "#00d3f2", "#00bc7d", "#ffb900", "#ff8904", "#a684ff", "#51a2ff"]
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function NewModelsSection(props: { data: NewModel[]; catalogLabs: readonly string[] }) {
  const [active, setActive] = createSignal<string>()

  return (
    <section id="new-models" data-section="new-models">
      <SectionHeading href="#new-models" title="New Models" description="Released in the past 30 days." />
      <Show
        when={props.data.length > 0}
        fallback={
          <div data-component="empty-state">
            <strong>No new models</strong>
            <p>No model released in the past 30 days has usage yet.</p>
          </div>
        }
      >
        <UsersTokensSplit data={props.data} active={active()} onActive={setActive} catalogLabs={props.catalogLabs} />
        <ChartDataTable
          caption="New models"
          headers={["Model", "Released", "Days live", "Tokens", "Peak daily users", "Sessions"]}
          rows={props.data.map((item) => [
            item.name,
            item.releaseDate,
            item.daysLive,
            formatTokens(item.tokens),
            formatCount(item.peakUsers),
            formatCount(item.sessions),
          ])}
        />
      </Show>
    </section>
  )
}

// People on the left, tokens on the right, with each model's daily tokens since launch in between.
function UsersTokensSplit(props: {
  data: NewModel[]
  active: string | undefined
  onActive: (model?: string) => void
  catalogLabs: readonly string[]
}) {
  const language = useLanguage()
  const maxUsers = createMemo(() => Math.max(1, ...props.data.map((item) => item.peakUsers)))
  const maxTokens = createMemo(() => Math.max(1, ...props.data.map((item) => item.tokens)))

  return (
    <div data-component="new-models-split" onPointerLeave={() => props.onActive(undefined)}>
      <div data-slot="split-heading" aria-hidden="true">
        <span>Peak daily users</span>
        <span>Model</span>
        <span>Tokens since launch</span>
      </div>
      <For each={props.data}>
        {(item, index) => {
          const known = () => isKnownCatalogLab(item.provider, props.catalogLabs)
          return (
            <a
              data-slot="split-row"
              href={language.route(item.path)}
              data-active={props.active === item.model ? "true" : undefined}
              data-featured={index() === 0 ? "true" : undefined}
              onPointerEnter={() => props.onActive(item.model)}
              onFocus={() => props.onActive(item.model)}
            >
              <span data-slot="split-users">
                <b>{formatCount(item.peakUsers)}</b>
                <i style={{ width: `${(item.peakUsers / maxUsers()) * 100}%` }} />
              </span>
              <span data-slot="split-model">
                <Show when={index() === 0}>
                  <ProviderIcon
                    data-slot="split-watermark"
                    aria-hidden="true"
                    id={known() ? providerIconId(item.author) : "synthetic"}
                  />
                </Show>
                <span data-slot="split-rank">{String(index() + 1).padStart(2, "0")}</span>
                <ProviderIcon
                  data-slot="split-icon"
                  aria-hidden="true"
                  id={known() ? providerIconId(item.author) : "synthetic"}
                />
                <span data-slot="split-name">
                  <strong>{item.name}</strong>
                  <em>
                    {formatReleaseDate(item.releaseDate)} · {item.daysLive}d live
                  </em>
                </span>
                <Sparkline values={item.daily.map((day) => day.tokens)} color={colors[index() % colors.length]} />
              </span>
              <span data-slot="split-tokens">
                <i style={{ width: `${(item.tokens / maxTokens()) * 100}%` }} />
                <b>{formatTokens(item.tokens)}</b>
              </span>
            </a>
          )
        }}
      </For>
    </div>
  )
}

function Sparkline(props: { values: number[]; color: string }) {
  const max = () => Math.max(1, ...props.values)
  const points = () =>
    props.values
      .map(
        (value, index) =>
          `${props.values.length > 1 ? (index / (props.values.length - 1)) * 100 : 50},${100 - (value / max()) * 100}`,
      )
      .join(" ")
  return (
    <svg data-slot="split-spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,100 ${points()} 100,100`} fill={props.color} />
      <polyline points={points()} stroke={props.color} vector-effect="non-scaling-stroke" />
    </svg>
  )
}

function formatCount(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 10_000 ? 0 : 1))}K`
  return String(Math.round(value))
}

function formatReleaseDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`
}
