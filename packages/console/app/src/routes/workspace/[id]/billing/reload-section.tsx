import { json, query, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Database, eq } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import styles from "./reload-section.module.css"

const reload = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(await withActor(() => Billing.reload(), workspaceID), {
    revalidate: getBillingInfo.key,
  })
}, "billing.reload")

const setReload = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  const reloadValue = form.get("reload")?.toString() === "true"
  return json(
    await Database.use((tx) =>
      tx
        .update(BillingTable)
        .set({
          reload: reloadValue,
          ...(reloadValue
            ? {
                reloadError: null,
                timeReloadError: null,
              }
            : {}),
        })
        .where(eq(BillingTable.workspaceID, workspaceID)),
    ),
    { revalidate: getBillingInfo.key },
  )
}, "billing.setReload")

const getBillingInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.get()
  }, workspaceID)
}, "billing.get")

export function ReloadSection() {
  const params = useParams()
  const balanceInfo = createAsync(() => getBillingInfo(params.id))
  const setReloadSubmission = useSubmission(setReload)
  const reloadSubmission = useSubmission(reload)

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Auto Reload</h2>
        <div data-slot="title-row">
          <Show
            when={balanceInfo()?.reload}
            fallback={
              <p>Auto reload is disabled. Enable to automatically reload when balance is low.</p>
            }
          >
            <p>
              We'll automatically reload <b>$20</b> (+$1.23 processing fee) when it reaches{" "}
              <b>$5</b>.
            </p>
          </Show>
          <form action={setReload} method="post" data-slot="create-form">
            <input type="hidden" name="workspaceID" value={params.id} />
            <input type="hidden" name="reload" value={balanceInfo()?.reload ? "false" : "true"} />
            <button data-color="primary" type="submit" disabled={setReloadSubmission.pending}>
              <Show
                when={balanceInfo()?.reload}
                fallback={setReloadSubmission.pending ? "Enabling..." : "Enable"}
              >
                {setReloadSubmission.pending ? "Disabling..." : "Disable"}
              </Show>
            </button>
          </form>
        </div>
      </div>
      <div data-slot="section-content">
        <Show when={balanceInfo()?.reload && balanceInfo()?.reloadError}>
          <div data-slot="reload-error">
            <p>
              Reload failed at{" "}
              {balanceInfo()?.timeReloadError!.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}
              . Reason: {balanceInfo()?.reloadError?.replace(/\.$/, "")}. Please update your payment
              method and try again.
            </p>
            <form action={reload} method="post" data-slot="create-form">
              <input type="hidden" name="workspaceID" value={params.id} />
              <button data-color="ghost" type="submit" disabled={reloadSubmission.pending}>
                {reloadSubmission.pending ? "Retrying..." : "Retry"}
              </button>
            </form>
          </div>
        </Show>
      </div>
    </section>
  )
}
