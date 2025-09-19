import "./[id].css"
import { Billing } from "@opencode/console-core/billing.js"
import { query, useParams, createAsync } from "@solidjs/router"
import { Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { MonthlyLimitSection } from "~/component/workspace/monthly-limit-section"
import { NewUserSection } from "~/component/workspace/new-user-section"
import { BillingSection } from "~/component/workspace/billing-section"
import { PaymentSection } from "~/component/workspace/payment-section"
import { UsageSection } from "~/component/workspace/usage-section"
import { KeySection } from "~/component/workspace/key-section"

const getBillingInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.get()
  }, workspaceID)
}, "billing.get")

export default function () {
  const params = useParams()
  const balanceInfo = createAsync(() => getBillingInfo(params.id))

  return (
    <div data-page="workspace-[id]">
      <section data-component="title-section">
        <h1>Zen</h1>
        <p>
          Curated list of models provided by opencode.{" "}
          <a target="_blank" href="/docs/zen">
            Learn more
          </a>
          .
        </p>
      </section>

      <div data-slot="sections">
        <NewUserSection />
        <KeySection />
        <BillingSection />
        <Show when={true}>
          {/*<Show when={balanceInfo()?.reload}>*/}
          <MonthlyLimitSection />
        </Show>
        <UsageSection />
        <PaymentSection />
      </div>
    </div>
  )
}
