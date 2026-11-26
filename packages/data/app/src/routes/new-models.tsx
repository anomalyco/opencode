import { ProviderIcon } from "@opencode/ui/provider-icon"
import { createMemo, createSignal, For, Show } from "solid-js"
import { ChartDataTable } from "../component/chart-data-table"
import { useLanguage } from "../context/language"
import { selectBreakout } from "../lib/breakout"
import { formatTokens } from "../lib/format"
import type { HomePageData } from "../lib/page-data"
import { providerIconId } from "../lib/provider-icon"
import { isKnownCatalogLab } from "./model-catalog"
import { SectionHeading } from "./section-heading"
import "./new-models.css"

type NewModel = HomePageData["newModels"][number]

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function NewModelsSection(props: {
  data: NewModel[]
  catalogLabs: readonly string[]
  colorFor: (model: string) => string
}) {
  const language = useLanguage()
  const breakout = createMemo(() => selectBreakout(props.data))
  const [selected, setSelected] = createSignal<string>()

  return (
    <Show when={breakout()}>
      {(item) => {
        const model = () => props.data.find((other) => other.model === selected()) ?? item().model
        // Leaves out the partial current day, unless the model launched today and has nothing else.
        const days = () => (model().daily.length > 1 ? model().daily.slice(0, -1) : model().daily)
        const others = () => [item().model, ...item().alsoNew].filter((other) => other !== model())
        const peak = () => days().reduce((top, day) => (day.tokens > top.tokens ? day : top))
        const known = () => isKnownCatalogLab(model().provider, props.catalogLabs)
        return (
          <section id="new-models" data-section="new-models">
            <SectionHeading
              href="#new-models"
              title="New Models"
              description="The biggest launch of the past 30 days."
            />
            <a
              data-slot="breakout-card"
              href={language.route(model().path)}
              style={{ "--breakout-color": props.colorFor(model().model) }}
            >
              <span data-slot="breakout-summary">
                <span data-slot="breakout-model">
                  <ProviderIcon aria-hidden="true" id={known() ? providerIconId(model().author) : "synthetic"} />
                  <span>
                    <strong>{model().name}</strong>
                    <em>
                      {known() ? `${model().author}, released` : "Released"} {formatDay(model().releaseDate)}
                    </em>
                    <Show when={model().free}>
                      <em>Free on OpenCode</em>
                    </Show>
                  </span>
                </span>
                <span data-slot="breakout-tokens">{formatTokens(model().tokens)}</span>
                <span data-slot="breakout-caption">tokens since launch</span>
                <span data-slot="breakout-users">{formatCount(model().users)}</span>
                <span data-slot="breakout-caption">users tried it</span>
              </span>
              <span
                data-slot="breakout-chart"
                aria-hidden="true"
                style={{ "grid-template-columns": `repeat(${Math.max(days().length, 7)}, minmax(0, 1fr))` }}
              >
                <For each={days()}>
                  {(day, index) => (
                    <span data-slot="breakout-day" data-peak={day === peak() ? "true" : undefined}>
                      <span data-slot="breakout-plot">
                        <i style={{ height: `${(day.tokens / peak().tokens) * 100}%` }}>
                          <Show when={days().length <= 7 || day === peak()}>
                            <b>{formatTokens(day.tokens)}</b>
                          </Show>
                        </i>
                      </span>
                      <small data-end={index() > 0 ? "true" : undefined}>
                        {index() === 0 || index() === days().length - 1 ? formatDay(day.date) : ""}
                      </small>
                    </span>
                  )}
                </For>
                <For each={Array.from({ length: Math.max(7 - days().length, 0) })}>
                  {() => (
                    <span data-slot="breakout-day">
                      <span data-slot="breakout-plot" />
                    </span>
                  )}
                </For>
              </span>
            </a>
            <Show when={others().length > 0}>
              <p data-slot="breakout-also">
                <span>Also new</span>
                <For each={others()}>
                  {(other) => (
                    <button type="button" onClick={() => setSelected(other.model)}>
                      {other.name}
                    </button>
                  )}
                </For>
              </p>
            </Show>
            <ChartDataTable
              caption={`${model().name} daily usage`}
              headers={["Date", "Tokens", "Rank", "Users"]}
              rows={days().map((day) => [day.date, formatTokens(day.tokens), day.rank, formatCount(day.users)])}
            />
          </section>
        )
      }}
    </Show>
  )
}

function formatCount(value: number) {
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(Math.round(value))
}

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`
}
