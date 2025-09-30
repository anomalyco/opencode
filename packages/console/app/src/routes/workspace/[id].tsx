import "./[id].css"
import { MonthlyLimitSection } from "./monthly-limit-section"
import { NewUserSection } from "./new-user-section"
import { BillingSection } from "./billing-section"
import { PaymentSection } from "./payment-section"
import { UsageSection } from "./usage-section"
import { KeySection } from "./key-section"
import { MemberSection } from "./member-section"
import { Show } from "solid-js"
import { useParams } from "@solidjs/router"

export default function () {
  const params = useParams()
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
        <Show when={isBeta(params.id)}>
          <MemberSection />
        </Show>
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
    "wrk_01K68M8J1KK0PJ39H59B1EGHP6", // frank
  ].includes(workspaceID)
}
