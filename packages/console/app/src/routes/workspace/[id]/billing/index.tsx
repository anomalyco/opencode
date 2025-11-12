import { MonthlyLimitSection } from "./monthly-limit-section"
import { BillingSection } from "./billing-section"
import { ReloadSection } from "./reload-section"
import { PaymentSection } from "./payment-section"
import { Show } from "solid-js"
import { createAsync, useParams } from "@solidjs/router"
import { queryBillingInfo, querySessionInfo } from "../../common"

export default function () {
  const params = useParams()
  const userInfo = createAsync(() => querySessionInfo(params.id!))
  const billingInfo = createAsync(() => queryBillingInfo(params.id!))

  return (
    <div data-page="workspace-[id]">
      <div data-slot="sections">
        <Show when={userInfo()?.isAdmin}>
          <BillingSection />
          <Show when={billingInfo()?.customerID}>
            <ReloadSection />
            <MonthlyLimitSection />
            <PaymentSection />
          </Show>
        </Show>
      </div>
    </div>
  )
}
