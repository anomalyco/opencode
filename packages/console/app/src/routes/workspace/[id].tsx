import "./[id].css"
import { MonthlyLimitSection } from "./monthly-limit-section"
import { NewUserSection } from "./new-user-section"
import { BillingSection } from "./billing-section"
import { PaymentSection } from "./payment-section"
import { UsageSection } from "./usage-section"
import { KeySection } from "./key-section"
import { MemberSection } from "./member-section"
import { Show } from "solid-js"
import { createAsync, query, useParams } from "@solidjs/router"
import { Actor } from "@opencode/console-core/actor.js"
import { withActor } from "~/context/auth.withActor"
import { and, Database, eq } from "@opencode/console-core/drizzle/index.js"
import { UserTable } from "@opencode/console-core/schema/user.sql.js"

const getUser = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const actor = Actor.use()
    const isAdmin = await (async () => {
      if (actor.type !== "user") return false
      const role = await Database.use((tx) =>
        tx
          .select({ role: UserTable.role })
          .from(UserTable)
          .where(and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.id, actor.properties.userID))),
      ).then((x) => x[0]?.role)
      return role === "admin"
    })()
    return { isAdmin }
  }, workspaceID)
}, "user.get")

export default function () {
  const params = useParams()
  const data = createAsync(() => getUser(params.id))
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
        <Show when={data()?.isAdmin}>
          <Show when={isBeta(params.id)}>
            <MemberSection />
          </Show>
          <BillingSection />
          <MonthlyLimitSection />
        </Show>
        <UsageSection />
        <Show when={data()?.isAdmin}>
          <PaymentSection />
        </Show>
      </div>
    </div>
  )
}

export function isBeta(workspaceID: string) {
  return [
    "wrk_01K46JDFR0E75SG2Q8K172KF3Y", // production
    "wrk_01K4NFRR5P7FSYWH88307B4DDS", // dev
    "wrk_01K6G7HBZ7C046A4XK01CVD0NS", // frank
  ].includes(workspaceID)
}
