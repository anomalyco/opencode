import { action, useParams, useAction, createAsync, useSubmission } from "@solidjs/router"
import { createMemo, Match, Show, Switch } from "solid-js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { withActor } from "~/context/auth.withActor"
import { IconCreditCard, IconStripe } from "~/component/icon"
import styles from "./billing-section.module.css"
import { createCheckoutUrl, queryBillingInfo } from "../../common"

const createSessionUrl = action(async (workspaceID: string, returnUrl: string) => {
  "use server"
  return withActor(() => Billing.generateSessionUrl({ returnUrl }), workspaceID)
}, "sessionUrl")

export function BillingSection() {
  const params = useParams()
  // ORIGINAL CODE - COMMENTED OUT FOR TESTING
  const balanceInfo = createAsync(() => queryBillingInfo(params.id))
  const createCheckoutUrlAction = useAction(createCheckoutUrl)
  const createCheckoutUrlSubmission = useSubmission(createCheckoutUrl)
  const createSessionUrlAction = useAction(createSessionUrl)
  const createSessionUrlSubmission = useSubmission(createSessionUrl)

  // DUMMY DATA FOR TESTING - UNCOMMENT ONE OF THE SCENARIOS BELOW

  // Scenario 1: User has not added billing details and has no balance
  // const balanceInfo = () => ({
  //   balance: 0,
  //   paymentMethodType: null as string | null,
  //   paymentMethodLast4: null as string | null,
  //   reload: false,
  //   reloadError: null as string | null,
  //   timeReloadError: null as Date | null,
  // })

  // Scenario 2: User has not added billing details but has a balance
  // const balanceInfo = () => ({
  //   balance: 1500000000, // $15.00
  //   paymentMethodType: null as string | null,
  //   paymentMethodLast4: null as string | null,
  //   reload: false,
  //   reloadError: null as string | null,
  //   timeReloadError: null as Date | null
  // })

  // Scenario 3: User has added billing details (reload enabled)
  // const balanceInfo = () => ({
  //   balance: 750000000, // $7.50
  //   paymentMethodType: "card",
  //   paymentMethodLast4: "4242",
  //   reload: true,
  //   reloadError: null as string | null,
  //   timeReloadError: null as Date | null
  // })

  // Scenario 4: User has billing details but reload failed
  // const balanceInfo = () => ({
  //   balance: 250000000, // $2.50
  //   paymentMethodType: "card",
  //   paymentMethodLast4: "4242",
  //   reload: true,
  //   reloadError: "Your card was declined." as string,
  //   timeReloadError: new Date(Date.now() - 3600000) as Date // 1 hour ago
  // })

  // Scenario 5: User has Link payment method
  // const balanceInfo = () => ({
  //   balance: 500000000, // $5.00
  //   paymentMethodType: "link",
  //   paymentMethodLast4: null as string | null,
  //   reload: true,
  //   reloadError: null as string | null,
  //   timeReloadError: null as Date | null
  // })

  const balanceAmount = createMemo(() => {
    return ((balanceInfo()?.balance ?? 0) / 100000000).toFixed(2)
  })

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Billing</h2>
        <p>
          Manage payments methods. <a href="mailto:contact@anoma.ly">Contact us</a> if you have any
          questions.
        </p>
      </div>
      <div data-slot="section-content">
        <div data-slot="balance-display">
          <div data-slot="balance-amount">
            <span data-slot="balance-value">
              ${balanceAmount() === "-0.00" ? "0.00" : balanceAmount()}
            </span>
            <span data-slot="balance-label">Current Balance</span>
          </div>
          <Show when={balanceInfo()?.customerID}>
            <div data-slot="balance-right-section">
              <button
                data-color="primary"
                disabled={createCheckoutUrlSubmission.pending}
                onClick={async () => {
                  const baseUrl = window.location.href
                  const checkoutUrl = await createCheckoutUrlAction(params.id, baseUrl, baseUrl)
                  if (checkoutUrl) {
                    window.location.href = checkoutUrl
                  }
                }}
              >
                {createCheckoutUrlSubmission.pending ? "Loading..." : "Add Balance"}
              </button>
              <div data-slot="credit-card">
                <div data-slot="card-icon">
                  <Switch fallback={<IconCreditCard style={{ width: "24px", height: "24px" }} />}>
                    <Match when={balanceInfo()?.paymentMethodType === "link"}>
                      <IconStripe style={{ width: "24px", height: "24px" }} />
                    </Match>
                  </Switch>
                </div>
                <div data-slot="card-details">
                  <Switch>
                    <Match when={balanceInfo()?.paymentMethodType === "card"}>
                      <Show
                        when={balanceInfo()?.paymentMethodLast4}
                        fallback={<span data-slot="number">----</span>}
                      >
                        <span data-slot="secret">••••</span>
                        <span data-slot="number">{balanceInfo()?.paymentMethodLast4}</span>
                      </Show>
                    </Match>
                    <Match when={balanceInfo()?.paymentMethodType === "link"}>
                      <span data-slot="type">Linked to Stripe</span>
                    </Match>
                  </Switch>
                </div>
                <button
                  data-color="ghost"
                  disabled={createSessionUrlSubmission.pending}
                  onClick={async () => {
                    const baseUrl = window.location.href
                    const sessionUrl = await createSessionUrlAction(params.id, baseUrl)
                    if (sessionUrl) {
                      window.location.href = sessionUrl
                    }
                  }}
                >
                  {createSessionUrlSubmission.pending ? "Loading..." : "Manage"}
                </button>
              </div>
            </div>
          </Show>
        </div>
        <Show when={!balanceInfo()?.customerID}>
          <button
            data-slot="enable-billing-button"
            data-color="primary"
            disabled={createCheckoutUrlSubmission.pending}
            onClick={async () => {
              const baseUrl = window.location.href
              const checkoutUrl = await createCheckoutUrlAction(params.id, baseUrl, baseUrl)
              if (checkoutUrl) {
                window.location.href = checkoutUrl
              }
            }}
          >
            {createCheckoutUrlSubmission.pending ? "Loading..." : "Enable Billing"}
          </button>
        </Show>
      </div>
    </section>
  )
}
