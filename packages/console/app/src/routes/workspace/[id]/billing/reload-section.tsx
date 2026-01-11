import { json, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { withActor } from "~/context/auth.withActor"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Database, eq } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import styles from "./reload-section.module.css"
import { queryBillingInfo } from "../../common"

const reload = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(await withActor(() => Billing.reload(), workspaceID), {
    revalidate: queryBillingInfo.key,
  })
}, "billing.reload")

const setReload = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  const reloadValue = form.get("reload")?.toString() === "true"
  const amountStr = form.get("reloadAmount")?.toString()
  const triggerStr = form.get("reloadTrigger")?.toString()

  const reloadAmount = amountStr && amountStr.trim() !== "" ? parseInt(amountStr) : null
  const reloadTrigger = triggerStr && triggerStr.trim() !== "" ? parseInt(triggerStr) : null

  if (reloadValue) {
    if (reloadAmount === null || reloadAmount < Billing.RELOAD_AMOUNT_MIN)
      return { error: `Reload amount must be at least $${Billing.RELOAD_AMOUNT_MIN}` }
    if (reloadTrigger === null || reloadTrigger < Billing.RELOAD_TRIGGER_MIN)
      return { error: `Balance trigger must be at least $${Billing.RELOAD_TRIGGER_MIN}` }
  }

  return json(
    await Database.use((tx) =>
      tx
        .update(BillingTable)
        .set({
          reload: reloadValue,
          ...(reloadAmount !== null ? { reloadAmount } : {}),
          ...(reloadTrigger !== null ? { reloadTrigger } : {}),
          ...(reloadValue
            ? {
                reloadError: null,
                timeReloadError: null,
              }
            : {}),
        })
        .where(eq(BillingTable.workspaceID, workspaceID)),
    ),
    { revalidate: queryBillingInfo.key },
  )
}, "billing.setReload")

export function ReloadSection() {
  const params = useParams()
  const billingInfo = createAsync(() => queryBillingInfo(params.id!))
  const setReloadSubmission = useSubmission(setReload)
  const reloadSubmission = useSubmission(reload)
  const [store, setStore] = createStore({
    show: false,
    reload: false,
    reloadAmount: "",
    reloadTrigger: "",
  })

  const processingFee = createMemo(() => {
    const reloadAmount = billingInfo()?.reloadAmount
    if (!reloadAmount) return "0.00"
    return (((reloadAmount + 0.3) / 0.956) * 0.044 + 0.3).toFixed(2)
  })

  createEffect(() => {
    if (!setReloadSubmission.pending && setReloadSubmission.result && !(setReloadSubmission.result as any).error) {
      setStore("show", false)
    }
  })

  function show() {
    while (true) {
      setReloadSubmission.clear()
      if (!setReloadSubmission.result) break
    }
    const info = billingInfo()!
    setStore("show", true)
    setStore("reload", info.reload ? true : true)
    setStore("reloadAmount", info.reloadAmount.toString())
    setStore("reloadTrigger", info.reloadTrigger.toString())
  }

  function hide() {
    setStore("show", false)
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Auto Reload</h2>
        <div data-slot="title-row">
          <Show
            when={billingInfo()?.reload}
            fallback={
              <p>
                Auto reload is <b>disabled</b>. Enable to automatically reload when balance is low.
              </p>
            }
          >
            <p>
              Auto reload is <b>enabled</b>. We'll reload <b>${billingInfo()?.reloadAmount}</b> (+${processingFee()}{" "}
              processing fee) when balance reaches <b>${billingInfo()?.reloadTrigger}</b>.
            </p>
          </Show>
          <button data-color="primary" type="button" onClick={() => show()}>
            {billingInfo()?.reload ? "Edit" : "Enable"}
          </button>
        </div>
      </div>
      <Show when={store.show}>
        <form action={setReload} method="post" data-slot="create-form">
          <div data-slot="form-field">
            <label>
              <span data-slot="field-label">Enable Auto Reload</span>
              <div data-slot="toggle-container">
                <label data-slot="model-toggle-label">
                  <input
                    type="checkbox"
                    name="reload"
                    value="true"
                    checked={store.reload}
                    onChange={(e) => setStore("reload", e.currentTarget.checked)}
                  />
                  <span></span>
                </label>
              </div>
            </label>
          </div>

          <div data-slot="input-row">
            <div data-slot="input-field">
              <p>Reload $</p>
              <input
                data-component="input"
                name="reloadAmount"
                type="number"
                min={billingInfo()?.reloadAmountMin.toString()}
                step="1"
                value={store.reloadAmount}
                onInput={(e) => setStore("reloadAmount", e.currentTarget.value)}
                placeholder={billingInfo()?.reloadAmount.toString()}
                disabled={!store.reload}
              />
            </div>
            <div data-slot="input-field">
              <p>When balance reaches $</p>
              <input
                data-component="input"
                name="reloadTrigger"
                type="number"
                min={billingInfo()?.reloadTriggerMin.toString()}
                step="1"
                value={store.reloadTrigger}
                onInput={(e) => setStore("reloadTrigger", e.currentTarget.value)}
                placeholder={billingInfo()?.reloadTrigger.toString()}
                disabled={!store.reload}
              />
            </div>
          </div>

          <Show when={setReloadSubmission.result && (setReloadSubmission.result as any).error}>
            {(err: any) => <div data-slot="form-error">{err()}</div>}
          </Show>
          <input type="hidden" name="workspaceID" value={params.id} />
          <div data-slot="form-actions">
            <button type="button" data-color="ghost" onClick={() => hide()}>
              Cancel
            </button>
            <button type="submit" data-color="primary" disabled={setReloadSubmission.pending}>
              {setReloadSubmission.pending ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </Show>
      <Show when={billingInfo()?.reload && billingInfo()?.reloadError}>
        <div data-slot="section-content">
          <div data-slot="reload-error">
            <p>
              Reload failed at{" "}
              {billingInfo()?.timeReloadError!.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}
              . Reason: {billingInfo()?.reloadError?.replace(/\.$/, "")}. Please update your payment method and try
              again.
            </p>
            <form action={reload} method="post" data-slot="create-form">
              <input type="hidden" name="workspaceID" value={params.id} />
              <button data-color="ghost" type="submit" disabled={reloadSubmission.pending}>
                {reloadSubmission.pending ? "Retrying..." : "Retry"}
              </button>
            </form>
          </div>
        </div>
      </Show>
    </section>
  )
}
