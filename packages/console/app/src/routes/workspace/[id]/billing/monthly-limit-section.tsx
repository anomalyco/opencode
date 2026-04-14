import { json, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { withActor } from "~/context/auth.withActor"
import { Billing } from "@opencode-ai/console-core/billing.js"
import styles from "./monthly-limit-section.module.css"
import { queryBillingInfo } from "../../common"

const setMonthlyLimit = action(async (form: FormData) => {
  "use server"
  const limit = form.get("limit")?.toString()
  if (!limit) return { error: "Limit is required." }
  const numericLimit = parseInt(limit)
  if (numericLimit < 0) return { error: "Set a valid monthly limit." }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required." }
  return json(
    await withActor(
      () =>
        Billing.setMonthlyLimit(numericLimit)
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: queryBillingInfo.key },
  )
}, "billing.setMonthlyLimit")

export function MonthlyLimitSection() {
  const params = useParams()
  const submission = useSubmission(setMonthlyLimit)
  const [store, setStore] = createStore({ show: false })
  const billingInfo = createAsync(() => queryBillingInfo(params.id!))

  let input: HTMLInputElement

  createEffect(() => {
    if (!submission.pending && submission.result && !submission.result.error) {
      hide()
    }
  })

  function show() {
    // submission.clear() does not clear the result in some cases, ie.
    //  1. Create key with empty name => error shows
    //  2. Put in a key name and creates the key => form hides
    //  3. Click add key button again => form shows with the same error if
    //     submission.clear() is called only once
    while (true) {
      submission.clear()
      if (!submission.result) break
    }
    setStore("show", true)
    input.focus()
  }

  function hide() {
    setStore("show", false)
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Monthly Limit</h2>
        <p>Set a monthly usage limit for your account.</p>
      </div>
      <div data-slot="section-content">
        <div data-slot="balance">
          <div data-slot="amount">
            {billingInfo()?.monthlyLimit ? <span data-slot="currency">$</span> : null}
            <span data-slot="value">{billingInfo()?.monthlyLimit ?? "-"}</span>
          </div>
          <Show
            when={!store.show}
            fallback={
              <form action={setMonthlyLimit} method="post" data-slot="create-form">
                <div data-slot="input-container">
                  <input
                    required
                    ref={(r) => (input = r)}
                    data-component="input"
                    name="limit"
                    type="number"
                    placeholder="50"
                  />
                  <Show when={submission.result && submission.result.error}>
                    {(err) => <div data-slot="form-error">{err()}</div>}
                  </Show>
                </div>
                <input type="hidden" name="workspaceID" value={params.id} />
                <div data-slot="form-actions">
                  <button type="reset" data-color="ghost" onClick={() => hide()}>
                    Cancel
                  </button>
                  <button type="submit" data-color="primary" disabled={submission.pending}>
                    {submission.pending ? "Setting..." : "Set"}
                  </button>
                </div>
              </form>
            }
          >
            <button data-color="primary" onClick={() => show()}>
              {billingInfo()?.monthlyLimit ? "Edit Limit" : "Set Limit"}
            </button>
          </Show>
        </div>
        <Show when={billingInfo()?.monthlyLimit} fallback={<p data-slot="usage-status">No usage limit set.</p>}>
          <p data-slot="usage-status">
            Current usage for {new Date().toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} is $
            {(() => {
              const dateLastUsed = billingInfo()?.timeMonthlyUsageUpdated
              if (!dateLastUsed) return "0"

              const current = new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                timeZone: "UTC",
              })
              const lastUsed = dateLastUsed.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                timeZone: "UTC",
              })
              if (current !== lastUsed) return "0"
              return ((billingInfo()?.monthlyUsage ?? 0) / 100000000).toFixed(2)
            })()}
            .
          </p>
        </Show>
      </div>
    </section>
  )
}
