import "./[id].css"
import { MonthlyLimitSection } from "~/component/workspace/monthly-limit-section"
import { NewUserSection } from "~/component/workspace/new-user-section"
import { BillingSection } from "~/component/workspace/billing-section"
import { PaymentSection } from "~/component/workspace/payment-section"
import { UsageSection } from "~/component/workspace/usage-section"
import { KeySection } from "~/component/workspace/key-section"

export default function () {
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
        <MonthlyLimitSection />
        <UsageSection />
        <PaymentSection />
      </div>
    </div>
  )
}

export function isBeta(workspaceID: string) {
  return [
    "wrk_01K46JDFR0E75SG2Q8K172KF3Y", // production
    "wrk_01K4NFRR5P7FSYWH88307B4DDS", // dev
    "wrk_01K4PJRKJ2WPQZN3FFYRV4673F", // frank
  ].includes(workspaceID)
}
