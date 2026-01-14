import { A, useSearchParams } from "@solidjs/router"
import { Title } from "@solidjs/meta"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { PlanIcon, plans } from "./common"

export default function Black() {
  const [params] = useSearchParams()
  const [selected, setSelected] = createSignal<string | null>((params.plan as string) || null)
  const [mounted, setMounted] = createSignal(false)

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
      <Title>opencode</Title>
      <section data-slot="cta">
        <div data-slot="pricing">
          <For each={plans}>
            {(plan) => {
              const isSelected = createMemo(() => selected() === plan.id)
              const isCollapsed = createMemo(() => selected() !== null && selected() !== plan.id)

              return (
                <article
                  data-slot="pricing-card"
                  data-plan-id={plan.id}
                  data-selected={isSelected() ? "true" : "false"}
                  data-collapsed={isCollapsed() ? "true" : "false"}
                >
                  <button
                    type="button"
                    data-slot="card-trigger"
                    onClick={() => select(plan.id)}
                    disabled={isSelected()}
                  >
                    <div
                      data-slot="plan-header"
                      style={{
                        "view-transition-name": `plan-header-${plan.id}`,
                      }}
                    >
                      <div data-slot="plan-icon">
                        <PlanIcon plan={plan.id} />
                      </div>
                      <p
                        data-slot="price"
                        style={{
                          "view-transition-name": `price-${plan.id}`,
                        }}
                      >
                        <span
                          data-slot="amount"
                          style={{
                            "view-transition-name": `amount-${plan.id}`,
                          }}
                        >
                          ${plan.id}
                        </span>
                        <Show when={!isSelected()}>
                          <span
                            data-slot="period"
                            style={{
                              "view-transition-name": `period-${plan.id}`,
                            }}
                          >
                            per month
                          </span>
                        </Show>

                        <Show when={isSelected()}>
                          <span
                            data-slot="billing"
                            style={{
                              "view-transition-name": `billing-${plan.id}`,
                            }}
                          >
                            per person billed monthly
                          </span>
                        </Show>
                        {plan.multiplier && (
                          <span
                            data-slot="multiplier"
                            style={{
                              "view-transition-name": `multiplier-${plan.id}`,
                            }}
                          >
                            {plan.multiplier}
                          </span>
                        )}
                      </p>
                    </div>
                  </button>

                  <Show when={isSelected()}>
                    <div data-slot="content">
                      <ul data-slot="terms">
                        <li>You will be added to the waitlist and activated in batches</li>
                        <li>Card won't be charged until subscription is active</li>
                        <li>Not unlimited - limits apply and may be adjusted dynamically</li>
                        <li>Heavily automated usage will hit limits quickly</li>
                        <li>Plans may be discontinued</li>
                        <li>Can cancel subscription at anytime</li>
                        <li>Cannot issue refunds for consumed subscriptions</li>
                      </ul>
                      <div data-slot="actions">
                        <button type="button" onClick={cancel} data-slot="cancel">
                          Cancel
                        </button>
                        <a href={`/black/subscribe/${plan.id}`} data-slot="continue">
                          Continue
                        </a>
                      </div>
                    </div>
                  </Show>
                </article>
              )
            }}
          </For>
        </div>
        <p data-slot="fine-print">
          Prices shown don't include applicable tax · <A href="/legal/terms-of-service">Terms of Service</A>
        </p>
      </section>
    </>
  )
}
