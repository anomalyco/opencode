import { json, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { withActor } from "~/context/auth.withActor"
import { Billing } from "@opencode-ai/console-core/billing.js"
import styles from "./monthly-limit-section.module.css"
import { queryBillingInfo } from "../../common"
import { useI18n } from "~/context/i18n"
import { formError, localizeError } from "~/lib/form-error"

const setMonthlyLimit = action(async (form: FormData) => {
  "use server"
  const limit = form.get("limit")?.toString()
  if (!limit) return { error: formError.limitRequired }
  const numericLimit = parseInt(limit)
  if (numericLimit < 0) return { error: formError.monthlyLimitInvalid }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: formError.workspaceRequired }
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
  const i18n = useI18n()
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
        <h2>{i18n.t("workspace.monthlyLimit.title")}</h2>
        <p>{i18n.t("workspace.monthlyLimit.subtitle")}</p>
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
                    placeholder={i18n.t("workspace.monthlyLimit.placeholder")}
                  />
                  <Show when={submission.result && submission.result.error}>
                    {(err) => <div data-slot="form-error">{localizeError(i18n.t, err())}</div>}
                  </Show>
                </div>
                <input type="hidden" name="workspaceID" value={params.id} />
                <div data-slot="form-actions">
                  <button type="reset" data-color="ghost" onClick={() => hide()}>
                    {i18n.t("common.cancel")}
                  </button>
                  <button type="submit" data-color="primary" disabled={submission.pending}>
                    {submission.pending
                      ? i18n.t("workspace.monthlyLimit.setting")
                      : i18n.t("workspace.monthlyLimit.set")}
                  </button>
                </div>
              </form>
            }
          >
            <button data-color="primary" onClick={() => show()}>
              {billingInfo()?.monthlyLimit
                ? i18n.t("workspace.monthlyLimit.edit")
                : i18n.t("workspace.monthlyLimit.set")}
            </button>
          </Show>
        </div>
        <Show
          when={billingInfo()?.monthlyLimit}
          fallback={<p data-slot="usage-status">{i18n.t("workspace.monthlyLimit.noLimit")}</p>}
        >
          <p data-slot="usage-status">
            {i18n.t("workspace.monthlyLimit.currentUsage.beforeMonth")}{" "}
            {new Date().toLocaleDateString(undefined, { month: "long", timeZone: "UTC" })}{" "}
            {i18n.t("workspace.monthlyLimit.currentUsage.beforeAmount")}
            {(() => {
              const dateLastUsed = billingInfo()?.timeMonthlyUsageUpdated
              if (!dateLastUsed) return "0"

              const current = new Date().toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                timeZone: "UTC",
              })
              const lastUsed = dateLastUsed.toLocaleDateString(undefined, {
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
