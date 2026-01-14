import { A, useSearchParams } from "@solidjs/router"
import { Title } from "@solidjs/meta"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { PlanIcon, plans } from "./common"

export default function Black() {
  const [params] = useSearchParams()
  const [selected, setSelected] = createSignal<string | null>((params.plan as string) || null)
  const selectedPlan = createMemo(() => plans.find((p) => p.id === selected()))

  return (
    <>
      <Title>opencode</Title>
      <section data-slot="cta">
        <Switch>
          <Match when={!selected()}>
            <div data-slot="pricing">
              <For each={plans}>
                {(plan) => (
                  <button type="button" onClick={() => setSelected(plan.id)} data-slot="pricing-card">
                    <div data-slot="icon">
                      <PlanIcon plan={plan.id} />
                    </div>
                    <p data-slot="price">
                      <span data-slot="amount">${plan.id}</span> <span data-slot="period">per month</span>
                      <Show when={plan.multiplier}>
                        <span data-slot="multiplier">{plan.multiplier}</span>
                      </Show>
                    </p>
                  </button>
                )}
              </For>
            </div>
            <p data-slot="fine-print">
              Prices shown don't include applicable tax · <A href="/legal/terms-of-service">Terms of Service</A>
            </p>
          </Match>
          <Match when={selectedPlan()}>
            {(plan) => (
              <div data-slot="selected-plan">
                <div data-slot="selected-card">
                  <div data-slot="icon">
                    <PlanIcon plan={plan().id} />
                  </div>
                  <p data-slot="price">
                    <span data-slot="amount">${plan().id}</span>{" "}
                    <span data-slot="period">per person billed monthly</span>
                    <Show when={plan().multiplier}>
                      <span data-slot="multiplier">{plan().multiplier}</span>
                    </Show>
                  </p>
                  <ul data-slot="terms">
                    <li>Your subscription will not start immediately</li>
                    <li>You will be added to the waitlist and activated soon</li>
                    <li>Your card will be only charged when your subscription is activated</li>
                    <li>Usage limits apply, heavily automated use may reach limits sooner</li>
                    <li>Subscriptions for individuals, contact Enterprise for teams</li>
                    <li>Limits may be adjusted and plans may be discontinued in the future</li>
                    <li>Cancel your subscription at anytime</li>
                  </ul>
                  <div data-slot="actions">
                    <button type="button" onClick={() => setSelected(null)} data-slot="cancel">
                      Cancel
                    </button>
                    <a href={`/black/subscribe/${plan().id}`} data-slot="continue">
                      Continue
                    </a>
                  </div>
                </div>
                <p data-slot="fine-print">
                  Prices shown don't include applicable tax · <A href="/legal/terms-of-service">Terms of Service</A>
                </p>
              </div>
            )}
          </Match>
        </Switch>
      </section>
    </>
  )
}
