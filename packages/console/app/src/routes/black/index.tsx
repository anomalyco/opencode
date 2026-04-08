import { A, createAsync, query, useSearchParams } from "@solidjs/router"
import { Title } from "@solidjs/meta"
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { PlanIcon, plans } from "./common"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { Resource } from "@opencode-ai/console-resource"

const getPaused = query(async () => {
  "use server"
  return Resource.App.stage === "production"
}, "black.paused")

export default function Black() {
  const [params] = useSearchParams()
  const i18n = useI18n()
  const language = useLanguage()
  const paused = createAsync(() => getPaused())
  const [selected, setSelected] = createSignal<string | null>((params.plan as string) || null)
  const [mounted, setMounted] = createSignal(false)
  const selectedPlan = createMemo(() => plans.find((p) => p.id === selected()))

  onMount(() => {
    requestAnimationFrame(() => setMounted(true))
  })

  const transition = (action: () => void) => {
    if (mounted() && "startViewTransition" in document) {
      ;(document as any).startViewTransition(action)
      return
    }

    action()
  }

  const select = (planId: string) => {
    if (selected() === planId) {
      return
    }

    transition(() => setSelected(planId))
  }

  const cancel = () => {
    transition(() => setSelected(null))
  }

  return (
    <>
      <Title>{i18n.t("black.title")}</Title>
      <section data-slot="cta">
        <Show when={!paused()} fallback={<p data-slot="paused">{i18n.t("black.paused")}</p>}>
          <Switch>
            <Match when={!selected()}>
              <div data-slot="pricing">
                <For each={plans}>
                  {(plan) => (
                    <button
                      type="button"
                      onClick={() => select(plan.id)}
                      data-slot="pricing-card"
                      style={{ "view-transition-name": `card-${plan.id}` }}
                    >
                      <div data-slot="icon">
                        <PlanIcon plan={plan.id} />
                      </div>
                      <p data-slot="price">
                        <span data-slot="amount">${plan.id}</span>{" "}
                        <span data-slot="period">{i18n.t("black.price.perMonth")}</span>
                        <Show when={plan.multiplier}>
                          {(multiplier) => <span data-slot="multiplier">{i18n.t(multiplier())}</span>}
                        </Show>
                      </p>
                    </button>
                  )}
                </For>
              </div>
            </Match>
            <Match when={selectedPlan()}>
              {(plan) => (
                <div data-slot="selected-plan">
                  <div data-slot="selected-card" style={{ "view-transition-name": `card-${plan().id}` }}>
                    <div data-slot="icon">
                      <PlanIcon plan={plan().id} />
                    </div>
                    <p data-slot="price">
                      <span data-slot="amount">${plan().id}</span>{" "}
                      <span data-slot="period">{i18n.t("black.price.perPersonBilledMonthly")}</span>
                      <Show when={plan().multiplier}>
                        {(multiplier) => <span data-slot="multiplier">{i18n.t(multiplier())}</span>}
                      </Show>
                    </p>
                    <ul data-slot="terms" style={{ "view-transition-name": `terms-${plan().id}` }}>
                      <li>{i18n.t("black.terms.1")}</li>
                      <li>{i18n.t("black.terms.2")}</li>
                      <li>{i18n.t("black.terms.3")}</li>
                      <li>{i18n.t("black.terms.4")}</li>
                      <li>{i18n.t("black.terms.5")}</li>
                      <li>{i18n.t("black.terms.6")}</li>
                      <li>{i18n.t("black.terms.7")}</li>
                    </ul>
                    <div data-slot="actions" style={{ "view-transition-name": `actions-${plan().id}` }}>
                      <button type="button" onClick={() => cancel()} data-slot="cancel">
                        {i18n.t("common.cancel")}
                      </button>
                      <a href={`/black/subscribe/${plan().id}`} data-slot="continue">
                        {i18n.t("black.action.continue")}
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </Match>
          </Switch>
        </Show>
        <Show when={!paused()}>
          <p data-slot="fine-print" style={{ "view-transition-name": "fine-print" }}>
            {i18n.t("black.finePrint.beforeTerms")} ·{" "}
            <A href={language.route("/legal/terms-of-service")}>{i18n.t("black.finePrint.terms")}</A>
          </p>
        </Show>
      </section>
    </>
  )
}
