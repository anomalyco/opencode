import "./go-plan-chart.css"
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { goPlanModels } from "./go-models"

const ticks = [100, 1000, 10000]

export function GoPlanChart(props: { href: string }) {
  const i18n = useI18n()
  const language = useLanguage()
  const id = createUniqueId()
  const [expanded, setExpanded] = createSignal(false)
  const [tier, setTier] = createSignal<"go" | "go-plus">("go")
  const models = createMemo(() => goPlanModels.filter((model) => expanded() || model.featured))
  const max = createMemo(() =>
    Math.max(
      ...goPlanModels.map((model) => (tier() === "go" ? model.requests : model.plusRequests)).filter(Number.isFinite),
    ),
  )
  const position = (requests: number) =>
    Number.isFinite(requests)
      ? 4 + Math.pow(Math.log10(Math.max(requests / 100, 1)) / Math.log10(max() / 100), 2.2) * 78
      : 100
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
        <div data-slot="tier-switch" role="group" aria-label={i18n.t("go.plans.legend")}>
          <button type="button" aria-pressed={tier() === "go"} onClick={() => setTier("go")}>
            <i data-tier="go" />
            Go
          </button>
          <button type="button" aria-pressed={tier() === "go-plus"} onClick={() => setTier("go-plus")}>
            <i data-tier="plus" />
            Go Plus
          </button>
        </div>
      </div>
      <div data-slot="scroll">
        <table id={id}>
          <colgroup>
            <col style={{ width: "26%" }} />
            <col style={{ width: "40%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "17%" }} />
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
                    <span data-slot="model">
                      <bdi>{model.name}</bdi>
                      <Show when={model.fresh}>
                        <small>{i18n.t("go.graph.new")}</small>
                      </Show>
                      <Show when={model.limitedTime}>
                        <small>{i18n.t("go.graph.limitedTime")}</small>
                      </Show>
                      <Show when={model.regions}>
                        <a
                          href="https://ai.developer.meta.com/legal/geographic-use-policy"
                          title={i18n.t("go.graph.limitedRegions")}
                          aria-label={`${model.name}: ${i18n.t("go.graph.limitedRegions")}`}
                        >
                          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" />
                            <ellipse cx="8" cy="8" rx="2.5" ry="6" stroke="currentColor" />
                            <path d="M2 8h12" stroke="currentColor" />
                          </svg>
                        </a>
                      </Show>
                    </span>
                  </th>
                  <td data-slot="bars" aria-hidden="true">
                    <For each={ticks}>
                      {(tick) => <span data-slot="gridline" style={{ "inset-inline-start": `${position(tick)}%` }} />}
                    </For>
                    <div data-slot="track">
                      <span
                        data-tier={tier() === "go" ? "go" : "plus"}
                        style={{ width: `${position(tier() === "go" ? model.requests : model.plusRequests)}%` }}
                      />
                      <span data-slot="remainder" />
                    </div>
                  </td>
                  <td data-slot="number">
                    <Show when={tier()} keyed>
                      {(selected) => (
                        <span data-slot="plan-value">
                          {format().format(selected === "go" ? model.requests : model.plusRequests)}
                        </span>
                      )}
                    </Show>
                  </td>
                  <td data-slot="number">
                    <Show when={tier()} keyed>
                      {(selected) => (
                        <span data-slot="plan-value">
                          {Number.isFinite(selected === "go" ? model.allowance : model.plusAllowance)
                            ? currency().format(selected === "go" ? model.allowance : model.plusAllowance)
                            : "∞"}
                        </span>
                      )}
                    </Show>
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
