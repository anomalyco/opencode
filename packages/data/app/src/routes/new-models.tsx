import { ProviderIcon } from "@opencode/ui/provider-icon"
import { createMemo, For, Show } from "solid-js"
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

export function NewModelsSection(props: { data: NewModel[]; catalogLabs: readonly string[] }) {
  const language = useLanguage()
  const breakout = createMemo(() => selectBreakout(props.data))

  return (
    <Show when={breakout()}>
      {(item) => {
        const model = () => item().model
        const peak = () => item().peak
        const days = () => item().days
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
              aria-label={`${model().name}: ${formatShare(peak().share)} of daily tokens on ${formatDay(peak().date)}`}
            >
              <span data-slot="breakout-summary">
                <span data-slot="breakout-model">
                  <ProviderIcon aria-hidden="true" id={known() ? providerIconId(model().author) : "synthetic"} />
                  <span>
                    <strong>{model().name}</strong>
                    <em>
                      {known() ? `${model().author}, released` : "Released"} {formatDay(model().releaseDate)}
                    </em>
                  </span>
                </span>
                <Show when={model().free}>
                  <span data-slot="breakout-label">Free on OpenCode</span>
                </Show>
                <span data-slot="breakout-share">{formatShare(peak().share)}</span>
                <span data-slot="breakout-caption">of daily tokens on its {item().peakDay} day</span>
                <span data-slot="breakout-stats">
                  <span>
                    <b>#{peak().rank}</b>
                    <small>model on {formatDay(peak().date)}</small>
                  </span>
                  <span>
                    <b>{formatCount(peak().users)}</b>
                    <small>users on {formatDay(peak().date)}</small>
                  </span>
                </span>
              </span>
              <span
                data-slot="breakout-chart"
                aria-hidden="true"
                data-crowded={days().length > 7 ? "true" : undefined}
                data-dense={days().length > 14 ? "true" : undefined}
                style={{ "grid-template-columns": `repeat(${days().length}, minmax(0, 1fr))` }}
              >
                <For each={days()}>
                  {(day, index) => (
                    <span data-slot="breakout-day" data-peak={day === peak() ? "true" : undefined}>
                      <span data-slot="breakout-plot">
                        <i style={{ height: `${(day.share / peak().share) * 100}%` }}>
                          <b>{formatShare(day.share)}</b>
                        </i>
                      </span>
                      <small data-end={index() > 0 ? "true" : undefined}>
                        {index() === 0 || index() === days().length - 1 ? formatDay(day.date) : ""}
                      </small>
                    </span>
                  )}
                </For>
              </span>
            </a>
            <Show when={item().alsoNew.length > 0}>
              <p data-slot="breakout-also">
                <span>Also new</span>
                <For each={item().alsoNew}>{(other) => <a href={language.route(other.path)}>{other.name}</a>}</For>
              </p>
            </Show>
            <ChartDataTable
              caption={`${model().name} daily usage`}
              headers={["Date", "Share of daily tokens", "Rank", "Tokens", "Users"]}
              rows={days().map((day) => [
                day.date,
                formatShare(day.share),
                day.rank,
                formatTokens(day.tokens),
                formatCount(day.users),
              ])}
            />
          </section>
        )
      }}
    </Show>
  )
}

function formatShare(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function formatCount(value: number) {
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(Math.round(value))
}

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`
}
