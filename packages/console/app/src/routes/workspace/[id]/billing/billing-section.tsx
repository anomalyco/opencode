import { action, useParams, useAction, createAsync, useSubmission, json } from "@solidjs/router"
import { createMemo, Match, Show, Switch, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { withActor } from "~/context/auth.withActor"
import { IconCreditCard, IconStripe } from "~/component/icon"
import styles from "./billing-section.module.css"
import { createCheckoutUrl, formatBalance, queryBillingInfo } from "../../common"

const createSessionUrl = action(async (workspaceID: string, returnUrl: string) => {
  "use server"
  return json(
    await withActor(
      () =>
        Billing.generateSessionUrl({ returnUrl })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({
            error: e.message as string,
            data: undefined,
          })),
      workspaceID,
    ),
    { revalidate: queryBillingInfo.key },
  )
}, "sessionUrl")

export function BillingSection() {
  const params = useParams()
  // ORIGINAL CODE - COMMENTED OUT FOR TESTING
  const billingInfo = createAsync(() => queryBillingInfo(params.id!))
  const checkoutAction = useAction(createCheckoutUrl)
  const checkoutSubmission = useSubmission(createCheckoutUrl)
  const sessionAction = useAction(createSessionUrl)
  const sessionSubmission = useSubmission(createSessionUrl)
  const [store, setStore] = createStore({
    showAddBalanceForm: false,
    addBalanceAmount: billingInfo()?.reloadAmount.toString() ?? "",
    checkoutRedirecting: false,
    sessionRedirecting: false,
  })

  createEffect(() => {
    const info = billingInfo()
    if (info) {
      setStore("addBalanceAmount", info.reloadAmount.toString())
    }
  })
  const balance = createMemo(() => formatBalance(billingInfo()?.balance ?? 0))

  async function onClickCheckout() {
    const amount = parseInt(store.addBalanceAmount)
    const baseUrl = window.location.href

    const checkout = await checkoutAction(params.id!, amount, baseUrl, baseUrl)
    if (checkout && checkout.data) {
      setStore("checkoutRedirecting", true)
      window.location.href = checkout.data
    }
  }

  async function onClickSession() {
    const baseUrl = window.location.href
    const sessionUrl = await sessionAction(params.id!, baseUrl)
    if (sessionUrl && sessionUrl.data) {
      setStore("sessionRedirecting", true)
      window.location.href = sessionUrl.data
    }
  }

  function showAddBalanceForm() {
    while (true) {
      checkoutSubmission.clear()
      if (!checkoutSubmission.result) break
    }
    setStore({
      showAddBalanceForm: true,
    })
  }

  function hideAddBalanceForm() {
    setStore("showAddBalanceForm", false)
    checkoutSubmission.clear()
  }

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

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Billing</h2>
        <p>
          Manage payments methods. <a href="mailto:contact@anoma.ly">Contact us</a> if you have any questions.
        </p>
      </div>
      <div data-slot="section-content">
        <div data-slot="balance-display">
          <div data-slot="balance-amount">
            <span data-slot="balance-value">${balance()}</span>
            <span data-slot="balance-label">Current Balance</span>
          </div>
          <Show when={billingInfo()?.customerID}>
            <div data-slot="balance-right-section">
              <Show
                when={!store.showAddBalanceForm}
                fallback={
                  <div data-slot="add-balance-form-container">
                    <div data-slot="add-balance-form">
                      <label>Add $</label>
                      <input
                        data-component="input"
                        type="number"
                        min={billingInfo()?.reloadAmountMin.toString()}
                        step="1"
                        value={store.addBalanceAmount}
                        onInput={(e) => {
                          setStore("addBalanceAmount", e.currentTarget.value)
                          checkoutSubmission.clear()
                        }}
                        placeholder="Enter amount"
                      />
                      <div data-slot="form-actions">
                        <button data-color="ghost" type="button" onClick={() => hideAddBalanceForm()}>
                          Cancel
                        </button>
                        <button
                          data-color="primary"
                          type="button"
                          disabled={!store.addBalanceAmount || checkoutSubmission.pending || store.checkoutRedirecting}
                          onClick={onClickCheckout}
                        >
                          {checkoutSubmission.pending || store.checkoutRedirecting ? "Loading..." : "Add"}
                        </button>
                      </div>
                    </div>
                    <Show when={checkoutSubmission.result && (checkoutSubmission.result as any).error}>
                      {(err: any) => <div data-slot="form-error">{err()}</div>}
                    </Show>
                  </div>
                }
              >
                <button data-color="primary" onClick={() => showAddBalanceForm()}>
                  Add Balance
                </button>
              </Show>
              <div data-slot="credit-card">
                <div data-slot="card-icon">
                  <Switch fallback={<IconCreditCard style={{ width: "24px", height: "24px" }} />}>
                    <Match when={billingInfo()?.paymentMethodType === "link"}>
                      <IconStripe style={{ width: "24px", height: "24px" }} />
                    </Match>
                  </Switch>
                </div>
                <div data-slot="card-details">
                  <Switch>
                    <Match when={billingInfo()?.paymentMethodType === "card"}>
                      <Show when={billingInfo()?.paymentMethodLast4} fallback={<span data-slot="number">----</span>}>
                        <span data-slot="secret">••••</span>
                        <span data-slot="number">{billingInfo()?.paymentMethodLast4}</span>
                      </Show>
                    </Match>
                    <Match when={billingInfo()?.paymentMethodType === "link"}>
                      <span data-slot="type">Linked to Stripe</span>
                    </Match>
                  </Switch>
                </div>
                <button
                  data-color="ghost"
                  disabled={sessionSubmission.pending || store.sessionRedirecting}
                  onClick={onClickSession}
                >
                  {sessionSubmission.pending || store.sessionRedirecting ? "Loading..." : "Manage"}
                </button>
              </div>
            </div>
          </Show>
        </div>
        <Show when={!billingInfo()?.customerID}>
          <button
            data-slot="enable-billing-button"
            data-color="primary"
            disabled={checkoutSubmission.pending || store.checkoutRedirecting}
            onClick={onClickCheckout}
          >
            {checkoutSubmission.pending || store.checkoutRedirecting ? "Loading..." : "Enable Billing"}
          </button>
        </Show>
      </div>
    </section>
  )
}
