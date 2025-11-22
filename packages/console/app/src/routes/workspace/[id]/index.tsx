import { Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createAsync, useParams, useAction, useSubmission } from "@solidjs/router"
import { NewUserSection } from "./new-user-section"
import { UsageSection } from "./usage-section"
import { ModelSection } from "./model-section"
import { ProviderSection } from "./provider-section"
import { GraphSection } from "./graph-section"
import { IconLogo } from "~/component/icon"
import { querySessionInfo, queryBillingInfo, createCheckoutUrl, formatBalance } from "../common"

export default function () {
  const params = useParams()
  const userInfo = createAsync(() => querySessionInfo(params.id!))
  const billingInfo = createAsync(() => queryBillingInfo(params.id!))
  const checkoutAction = useAction(createCheckoutUrl)
  const checkoutSubmission = useSubmission(createCheckoutUrl)
  const [store, setStore] = createStore({
    checkoutRedirecting: false,
  })
  const balance = createMemo(() => formatBalance(billingInfo()?.balance ?? 0))

  async function onClickCheckout() {
    const baseUrl = window.location.href
    const checkout = await checkoutAction(params.id!, billingInfo()!.reloadAmount, baseUrl, baseUrl)
    if (checkout && checkout.data) {
      setStore("checkoutRedirecting", true)
      window.location.href = checkout.data
    }
  }

  return (
    <div data-page="workspace-[id]">
      <section data-component="header-section">
        <IconLogo />
        <p>
          <span>
            Reliable optimized models for coding agents.{" "}
            <a target="_blank" href="/docs/zen">
              Learn more
            </a>
            .
          </span>
          <Show when={userInfo()?.isAdmin}>
            <span data-slot="billing-info">
              <Show
                when={billingInfo()?.reload}
                fallback={
                  <button
                    data-color="primary"
                    data-size="sm"
                    disabled={checkoutSubmission.pending || store.checkoutRedirecting}
                    onClick={onClickCheckout}
                  >
                    {checkoutSubmission.pending || store.checkoutRedirecting ? "Loading..." : "Enable billing"}
                  </button>
                }
              >
                <span data-slot="balance">
                  Current balance <b>${balance()}</b>
                </span>
              </Show>
            </span>
          </Show>
        </p>
      </section>

      <div data-slot="sections">
        <NewUserSection />
        <Show when={userInfo()?.isAdmin}>
          <GraphSection />
        </Show>
        <ModelSection />
        <Show when={userInfo()?.isAdmin}>
          <ProviderSection />
        </Show>
        <UsageSection />
      </div>
    </div>
  )
}
