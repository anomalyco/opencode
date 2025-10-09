import "./[id].css"
import { MonthlyLimitSection } from "./monthly-limit-section"
import { NewUserSection } from "./new-user-section"
import { BillingSection } from "./billing-section"
import { PaymentSection } from "./payment-section"
import { UsageSection } from "./usage-section"
import { KeySection } from "./key-section"
import { MemberSection } from "./member-section"
import { SettingsSection } from "./settings-section"
import { ModelSection } from "./model-section"
import { ProviderSection } from "./provider-section"
import { Show } from "solid-js"
import { createAsync, query, useParams } from "@solidjs/router"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { withActor } from "~/context/auth.withActor"
import { User } from "@opencode-ai/console-core/user.js"
import { beta } from "~/lib/beta"

const getUserInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const actor = Actor.assert("user")
    const user = await User.fromID(actor.properties.userID)
    return {
      isAdmin: user?.role === "admin",
    }
  }, workspaceID)
}, "user.get")

export default function () {
  const params = useParams()
  const userInfo = createAsync(() => getUserInfo(params.id))
  const isBeta = createAsync(() => beta(params.id))

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
        <Show when={isBeta()}>
          <MemberSection />
        </Show>
        <Show when={userInfo()?.isAdmin}>
          <Show when={isBeta()}>
            <SettingsSection />
            <ModelSection />
            <ProviderSection />
          </Show>
          <BillingSection />
          <MonthlyLimitSection />
        </Show>
        <UsageSection />
        <Show when={userInfo()?.isAdmin}>
          <PaymentSection />
        </Show>
      </div>
    </div>
  )
}
