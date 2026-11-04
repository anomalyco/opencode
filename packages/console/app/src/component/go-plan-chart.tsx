import "./go-plan-chart.css"
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { goPlanModels } from "./go-models"

const ticks = [100, 1000, 10000]
const max = Math.max(...goPlanModels.map((model) => model.plusRequests).filter(Number.isFinite))

export function GoPlanChart(props: { href: string; audience?: "individuals" | "teams" }) {
  const i18n = useI18n()
  const language = useLanguage()
  const id = createUniqueId()
  const [expanded, setExpanded] = createSignal(false)
  const tiers = createMemo(() =>
    props.audience === "teams"
      ? ([{ tier: "teams", label: "Go Teams" }] as const)
      : ([
          { tier: "go", label: "Go" },
          { tier: "plus", label: "Go Plus" },
        ] as const),
  )
  const models = createMemo(() => goPlanModels.filter((model) => expanded() || model.featured))
  const position = (requests: number) =>
    Number.isFinite(requests)
      ? 4 + Math.pow(Math.log10(Math.max(requests / 100, 1)) / Math.log10(max / 100), 2.2) * 78
      : 100
  const lanes = (model: (typeof goPlanModels)[number]) =>
    props.audience === "teams"
      ? [
          {
            tier: "teams" as const,
            width: position(model.teamsRequests),
            requests: model.teamsRequests,
            allowance: model.teamsAllowance,
            previousRequests: model.previous?.teamsRequests,
            previousAllowance: model.previous?.teamsAllowance,
          },
        ]
      : [
          {
            tier: "go" as const,
            // The Go bar is a linear fraction of the Plus bar so the multiplier reads true on the log scale.
            width: Number.isFinite(model.plusRequests)
              ? (position(model.plusRequests) * model.requests) / model.plusRequests
              : position(model.requests),
            requests: model.requests,
            allowance: model.allowance,
            previousRequests: model.previous?.requests,
            previousAllowance: model.previous?.allowance,
          },
          {
            tier: "plus" as const,
            width: position(model.plusRequests),
            requests: model.plusRequests,
            allowance: model.plusAllowance,
            previousRequests: model.previous?.plusRequests,
            previousAllowance: model.previous?.plusAllowance,
          },
        ]
  const format = createMemo(() => new Intl.NumberFormat(language.tag(language.locale())))
  const currency = createMemo(
    () =>
      new Intl.NumberFormat(language.tag(language.locale()), {
        style: "currency",
        currency: "USD",
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: 0,
      }),
  )

  return (
    <figure data-component="go-plan-chart" dir={language.dir(language.locale())} aria-labelledby={`${id}-title`}>
      <div data-slot="heading">
        <div>
          <h2 id={`${id}-title`}>{i18n.t("go.plans.limits")}</h2>
          <p>{i18n.t("go.plans.description")}</p>
        </div>
        <ul data-slot="legend" aria-label={i18n.t("go.plans.legend")}>
          <For each={tiers()}>
            {(item) => (
              <li>
                <i data-tier={item.tier} />
                {item.label}
              </li>
            )}
          </For>
        </ul>
      </div>
      <div data-slot="scroll">
        <table id={id}>
          <colgroup>
            <col style={{ width: "26%" }} />
            <col />
            <col style={{ width: "16%" }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{i18n.t("go.graph.model")}</th>
              <th scope="col" colspan="2">
                {i18n.t("go.graph.requests")}
              </th>
              <th scope="col">{i18n.t("go.graph.allowance")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={models()}>
              {(model) => (
                <tr>
                  <th scope="row">
                    <bdi>{model.name}</bdi>
                    <Show when={model.fresh || model.bonus || model.limitedTime || model.regions}>
                      <span data-slot="labels">
                        <Show when={model.fresh}>
                          <small>{i18n.t("go.graph.new")}</small>
                        </Show>
                        <Show when={model.bonus}>
                          {(bonus) => <small>{i18n.t("go.graph.bonus", { count: bonus() })}</small>}
                        </Show>
                        <Show when={model.limitedTime}>
                          <small>{i18n.t("go.graph.limitedTime")}</small>
                        </Show>
                        <Show when={model.regions}>
                          <a href="https://dev.meta.ai/legal/geographic-use-policy">
                            {i18n.t("go.graph.limitedRegions")}
                          </a>
                        </Show>
                      </span>
                    </Show>
                  </th>
                  <td data-slot="bars" aria-hidden="true">
                    <For each={ticks}>
                      {(tick) => <span data-slot="gridline" style={{ "inset-inline-start": `${position(tick)}%` }} />}
                    </For>
                    <div data-slot="track">
                      <For each={lanes(model)}>
                        {(lane) => (
                          <div data-slot="lane">
                            <span data-tier={lane.tier} style={{ width: `${lane.width}%` }} />
                            <span data-slot="remainder" />
                          </div>
                        )}
                      </For>
                    </div>
                  </td>
                  <td data-slot="number">
                    <For each={lanes(model)}>
                      {(lane) => (
                        <span>
                          <Show when={lane.previousRequests}>{(base) => <s>{format().format(base())}</s>}</Show>
                          {format().format(lane.requests)}
                        </span>
                      )}
                    </For>
                  </td>
                  <td data-slot="number">
                    <For each={lanes(model)}>
                      {(lane) => (
                        <span>
                          <Show when={lane.previousAllowance}>{(base) => <s>{currency().format(base())}</s>}</Show>
                          {Number.isFinite(lane.allowance) ? currency().format(lane.allowance) : "∞"}
                        </span>
                      )}
                    </For>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
          <tfoot aria-hidden="true">
            <tr>
              <td />
              <td data-slot="axis">
                <For each={ticks}>
                  {(tick) => (
                    <span style={{ "inset-inline-start": `${position(tick)}%` }}>
                      {tick < 1000 ? format().format(tick) : `${tick / 1000}K`}
                    </span>
                  )}
                </For>
              </td>
              <td colspan="2" />
            </tr>
          </tfoot>
        </table>
      </div>
      <figcaption>
        <button
          type="button"
          data-slot="expand"
          aria-expanded={expanded()}
          aria-controls={id}
          onClick={() => setExpanded(!expanded())}
        >
          {expanded()
            ? i18n.t("go.graph.showLess")
            : i18n.t("go.graph.showAll", { count: format().format(goPlanModels.length) })}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.25" />
          </svg>
        </button>
        <a href={props.href}>{i18n.t("go.graph.usageLimits")}</a>
      </figcaption>
    </figure>
  )
}
