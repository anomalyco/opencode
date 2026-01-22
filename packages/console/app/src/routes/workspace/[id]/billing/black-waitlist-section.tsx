import { action, useParams, useAction, useSubmission, json, createAsync } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { Database, eq } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { withActor } from "~/context/auth.withActor"
import { queryBillingInfo } from "../../common"
import styles from "./black-waitlist-section.module.css"

const cancelWaitlist = action(async (workspaceID: string) => {
  "use server"
  return json(
    await withActor(async () => {
      await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            subscriptionPlan: null,
            timeSubscriptionBooked: null,
          })
          .where(eq(BillingTable.workspaceID, workspaceID)),
      )
      return { error: undefined }
    }, workspaceID).catch((e) => ({ error: e.message as string })),
    { revalidate: queryBillingInfo.key },
  )
}, "cancelWaitlist")

export function BlackWaitlistSection() {
  const params = useParams()
  const billingInfo = createAsync(() => queryBillingInfo(params.id!))
  const cancelAction = useAction(cancelWaitlist)
  const cancelSubmission = useSubmission(cancelWaitlist)
  const [store, setStore] = createStore({
    cancelled: false,
  })

  async function onClickCancel() {
    const result = await cancelAction(params.id!)
    if (!result.error) {
      setStore("cancelled", true)
    }
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Waitlist</h2>
        <div data-slot="title-row">
          <p>You are on the waitlist for the ${billingInfo()?.subscriptionPlan} per month OpenCode Black plan.</p>
          <button data-color="danger" disabled={cancelSubmission.pending || store.cancelled} onClick={onClickCancel}>
            {cancelSubmission.pending ? "Leaving..." : store.cancelled ? "Left" : "Leave Waitlist"}
          </button>
        </div>
      </div>
    </section>
  )
}
