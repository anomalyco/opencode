import { MonthlyLimitSection } from "./monthly-limit-section"
import { BillingSection } from "./billing-section"
import { PaymentSection } from "./payment-section"
import { Show } from "solid-js"
import { createAsync, useParams } from "@solidjs/router"
import { querySessionInfo } from "../../common"

export default function () {
  const params = useParams()
  const userInfo = createAsync(() => querySessionInfo(params.id))

  return (
    <div data-page="workspace-[id]">
      <div data-slot="sections">
        <Show when={userInfo()?.isAdmin}>
          <BillingSection />
          <MonthlyLimitSection />
          <PaymentSection />
        </Show>
      </div>
    </div>
  )
}
