import { NewUserSection } from "./new-user-section"
import { UsageSection } from "./usage-section"
import { ModelSection } from "./model-section"
import { ProviderSection } from "./provider-section"
import { IconLogo } from "~/component/icon"
import { createAsync, useParams, useAction, useSubmission } from "@solidjs/router"
import { querySessionInfo, queryBillingInfo, createCheckoutUrl } from "../common"
import { Show, createMemo } from "solid-js"

export default function () {
  const params = useParams()
  const userInfo = createAsync(() => querySessionInfo(params.id))
  const billingInfo = createAsync(() => queryBillingInfo(params.id))
  const createCheckoutUrlAction = useAction(createCheckoutUrl)
  const createCheckoutUrlSubmission = useSubmission(createCheckoutUrl)

  const balanceAmount = createMemo(() => {
    return ((billingInfo()?.balance ?? 0) / 100000000).toFixed(2)
  })

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
                    disabled={createCheckoutUrlSubmission.pending}
                    onClick={async () => {
                      const baseUrl = window.location.href
                      const checkoutUrl = await createCheckoutUrlAction(params.id, baseUrl, baseUrl)
                      if (checkoutUrl) {
                        window.location.href = checkoutUrl
                      }
                    }}
                  >
                    {createCheckoutUrlSubmission.pending ? "Loading..." : "Enable billing"}
                  </button>
                }
              >
                <span data-slot="balance">
                  Current balance <b>${balanceAmount() === "-0.00" ? "0.00" : balanceAmount()}</b>
                </span>
              </Show>
            </span>
          </Show>
        </p>
      </section>

      <div data-slot="sections">
        <NewUserSection />
        <ModelSection />
        <Show when={userInfo()?.isAdmin}>
          <ProviderSection />
        </Show>
        <UsageSection />
      </div>
    </div>
  )
}
