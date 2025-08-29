import { Button } from "../../ui/button"
import { useApi } from "../components/context-api"
import { createEffect, createSignal, createResource, For } from "solid-js"
import { useWorkspace } from "../components/context-workspace"
import style from "./billing.module.css"

export default function Billing() {
  const api = useApi()
  const workspace = useWorkspace()
  const [isLoading, setIsLoading] = createSignal(false)
  const [billingData] = createResource(async () => {
    const response = await api.billing.info.$get()
    return response.json()
  })

  // Run once on component mount to check URL parameters
  ;(() => {
    const url = new URL(window.location.href)
    const result = url.hash

    console.log("STRIPE RESULT", result)

    if (url.hash === "#success") {
      setIsLoading(true)
      // Remove the hash from the URL
      window.history.replaceState(null, "", window.location.pathname + window.location.search)
    }
  })()

  createEffect((old?: number) => {
    if (old && old !== billingData()?.billing?.balance) {
      setIsLoading(false)
    }
    return billingData()?.billing?.balance
  })

  const handleBuyCredits = async () => {
    try {
      setIsLoading(true)
      const baseUrl = window.location.href
      const successUrl = new URL(baseUrl)
      successUrl.hash = "success"

      const response = await api.billing.checkout
        .$post({
          json: {
            success_url: successUrl.toString(),
            cancel_url: baseUrl,
          },
        })
        .then((r) => r.json() as any)
      window.location.href = response.url
    } catch (error) {
      console.error("Failed to get checkout URL:", error)
      setIsLoading(false)
    }
  }

  return (
    <>
      <div data-component="title-bar">
        <div data-slot="left">
          <h1>Billing</h1>
        </div>
      </div>
      <div class={style.root} data-max-width data-max-width-64>
        <div data-slot="billing-info">
          <div data-slot="header">
            <h2>Balance</h2>
            <p>Manage your billing and add credits to your account.</p>
          </div>

          <div data-slot="balance">
            <p data-slot="amount">
              {(() => {
                const balanceStr = ((billingData()?.billing?.balance ?? 0) / 100000000).toFixed(2)
                return `$${balanceStr === "-0.00" ? "0.00" : balanceStr}`
              })()}
            </p>
            <Button color="primary" disabled={isLoading()} onClick={handleBuyCredits}>
              {isLoading() ? "Loading..." : "Buy Credits"}
            </Button>
          </div>
        </div>

        <div data-slot="payments">
          <div data-slot="header">
            <h2>Payment History</h2>
            <p>Your recent payment transactions.</p>
          </div>

          <div data-slot="payment-list">
            <For each={billingData()?.payments} fallback={<p>No payments found.</p>}>
              {(payment) => (
                <div data-slot="payment-item">
                  <span data-slot="payment-id">{payment.id}</span>
                  {"  |  "}
                  <span data-slot="payment-amount">${((payment.amount ?? 0) / 100000000).toFixed(2)}</span>
                  {"  |  "}
                  <span data-slot="payment-date">{new Date(payment.timeCreated).toLocaleDateString()}</span>
                </div>
              )}
            </For>
          </div>
        </div>

        <div data-slot="usage">
          <div data-slot="header">
            <h2>Usage History</h2>
            <p>Your recent API usage and costs.</p>
          </div>

          <div data-slot="usage-list">
            <For each={billingData()?.usage} fallback={<p>No usage found.</p>}>
              {(usage) => (
                <div data-slot="usage-item">
                  <span data-slot="usage-model">{usage.model}</span>
                  {"  |  "}
                  <span data-slot="usage-tokens">{usage.inputTokens + usage.outputTokens} tokens</span>
                  {"  |  "}
                  <span data-slot="usage-cost">${((usage.cost ?? 0) / 100000000).toFixed(4)}</span>
                  {"  |  "}
                  <span data-slot="usage-date">{new Date(usage.timeCreated).toLocaleDateString()}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </>
  )
}
