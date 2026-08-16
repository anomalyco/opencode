import { json, action, useParams, useSubmission, createAsync, query } from "@solidjs/router"
import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { withActor } from "~/context/auth.withActor"
import { Workspace } from "@opencode-ai/console-core/workspace.js"
import styles from "./settings-section.module.css"
import { Database, eq } from "@opencode-ai/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { useI18n } from "~/context/i18n"
import { formError, localizeError } from "~/lib/form-error"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Actor } from "@opencode-ai/console-core/actor.js"

const getWorkspaceInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(
    () =>
      Database.use((tx) =>
        tx
          .select({
            id: WorkspaceTable.id,
            name: WorkspaceTable.name,
            slug: WorkspaceTable.slug,
          })
          .from(WorkspaceTable)
          .where(eq(WorkspaceTable.id, workspaceID))
          .then((rows) => rows[0] || null),
      ),
    workspaceID,
  )
}, "workspace.get")

const updateWorkspace = action(async (form: FormData) => {
  "use server"
  const name = (form.get("name") as string | null)?.trim()
  if (!name) return { error: formError.workspaceNameRequired }
  if (name.length > 255) return { error: formError.nameTooLong }
  const workspaceID = form.get("workspaceID") as string | null
  if (!workspaceID) return { error: formError.workspaceRequired }
  return json(
    await withActor(
      () =>
        Workspace.update({ name })
          .then(() => ({ error: undefined }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: getWorkspaceInfo.key },
  )
}, "workspace.update")

const getInvoiceDetails = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    if (Actor.userRole() !== "admin") return { isAdmin: false, details: null }
    return { isAdmin: true, details: await Billing.getInvoiceDetails() }
  }, workspaceID)
}, "workspace.invoiceDetails.get")

const updateInvoiceDetails = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID") as string | null
  if (!workspaceID) return { error: formError.workspaceRequired }

  return json(
    await withActor(
      () =>
        Billing.updateInvoiceDetails({
          name: String(form.get("name") ?? ""),
          line1: String(form.get("line1") ?? ""),
          line2: String(form.get("line2") ?? ""),
          city: String(form.get("city") ?? ""),
          state: String(form.get("state") ?? ""),
          postalCode: String(form.get("postalCode") ?? ""),
          country: String(form.get("country") ?? ""),
        })
          .then(() => ({ error: undefined }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: getInvoiceDetails.key },
  )
}, "workspace.invoiceDetails.update")

export function SettingsSection() {
  const params = useParams()
  const i18n = useI18n()
  const workspaceInfo = createAsync(() => getWorkspaceInfo(params.id!))
  const submission = useSubmission(updateWorkspace)
  const [store, setStore] = createStore({ show: false })

  let input: HTMLInputElement

  createEffect(() => {
    if (!submission.pending && submission.result && !submission.result.error) {
      hide()
    }
  })

  function show() {
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
        <h2>{i18n.t("workspace.settings.title")}</h2>
        <p>{i18n.t("workspace.settings.subtitle")}</p>
      </div>
      <div data-slot="section-content">
        <div data-slot="setting">
          <p>{i18n.t("workspace.settings.workspaceName")}</p>
          <Show
            when={!store.show}
            fallback={
              <form action={updateWorkspace} method="post" data-slot="create-form">
                <div data-slot="input-container">
                  <input
                    required
                    ref={(r) => (input = r)}
                    data-component="input"
                    name="name"
                    type="text"
                    placeholder={i18n.t("workspace.settings.workspaceName")}
                    value={workspaceInfo()?.name ?? i18n.t("workspace.settings.defaultName")}
                  />
                  <input type="hidden" name="workspaceID" value={params.id} />
                  <button type="submit" data-color="primary" disabled={submission.pending}>
                    {submission.pending ? i18n.t("workspace.settings.updating") : i18n.t("workspace.settings.save")}
                  </button>
                  <button type="reset" data-color="ghost" onClick={() => hide()}>
                    {i18n.t("common.cancel")}
                  </button>
                </div>
                <Show when={submission.result && submission.result.error}>
                  {(err) => <div data-slot="form-error">{localizeError(i18n.t, err())}</div>}
                </Show>
              </form>
            }
          >
            <div data-slot="value-with-action">
              <p data-slot="current-value">{workspaceInfo()?.name}</p>
              <button data-color="primary" onClick={() => show()}>
                {i18n.t("workspace.settings.edit")}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </section>
  )
}

export function InvoiceDetailsSection() {
  const params = useParams()
  const i18n = useI18n()
  const invoiceInfo = createAsync(() => getInvoiceDetails(params.id!))
  const submission = useSubmission(updateInvoiceDetails)
  const [store, setStore] = createStore({ show: false })

  createEffect(() => {
    if (!submission.pending && submission.result && !submission.result.error) setStore("show", false)
  })

  function show() {
    while (true) {
      submission.clear()
      if (!submission.result) break
    }
    setStore("show", true)
  }

  return (
    <Show when={invoiceInfo()?.isAdmin}>
      <section class={styles.root}>
        <div data-slot="section-title">
          <h2>{i18n.t("workspace.settings.invoiceDetails.title")}</h2>
          <p>{i18n.t("workspace.settings.invoiceDetails.subtitle")}</p>
        </div>
        <div data-slot="section-content">
          <Show
            when={invoiceInfo()?.details}
            fallback={<p data-slot="empty-message">{i18n.t("workspace.settings.invoiceDetails.empty")}</p>}
          >
            {(details) => (
              <Show
                when={!store.show}
                fallback={
                  <form action={updateInvoiceDetails} method="post" data-slot="invoice-form">
                    <label>
                      <span>{i18n.t("workspace.settings.invoiceDetails.name")}</span>
                      <input required name="name" value={details().name} autocomplete="organization" />
                    </label>
                    <label data-wide>
                      <span>{i18n.t("workspace.settings.invoiceDetails.address1")}</span>
                      <input required name="line1" value={details().address.line1} autocomplete="address-line1" />
                    </label>
                    <label data-wide>
                      <span>{i18n.t("workspace.settings.invoiceDetails.address2")}</span>
                      <input name="line2" value={details().address.line2} autocomplete="address-line2" />
                    </label>
                    <label>
                      <span>{i18n.t("workspace.settings.invoiceDetails.city")}</span>
                      <input required name="city" value={details().address.city} autocomplete="address-level2" />
                    </label>
                    <label>
                      <span>{i18n.t("workspace.settings.invoiceDetails.state")}</span>
                      <input name="state" value={details().address.state} autocomplete="address-level1" />
                    </label>
                    <label>
                      <span>{i18n.t("workspace.settings.invoiceDetails.postalCode")}</span>
                      <input
                        required
                        name="postalCode"
                        value={details().address.postalCode}
                        autocomplete="postal-code"
                      />
                    </label>
                    <label>
                      <span>{i18n.t("workspace.settings.invoiceDetails.country")}</span>
                      <input
                        required
                        name="country"
                        value={details().address.country}
                        autocomplete="country-code"
                        minlength="2"
                        maxlength="2"
                        placeholder="US"
                      />
                    </label>
                    <input type="hidden" name="workspaceID" value={params.id} />
                    <div data-slot="form-actions">
                      <button type="submit" data-color="primary" disabled={submission.pending}>
                        {submission.pending
                          ? i18n.t("workspace.settings.invoiceDetails.saving")
                          : i18n.t("workspace.settings.save")}
                      </button>
                      <button type="reset" data-color="ghost" onClick={() => setStore("show", false)}>
                        {i18n.t("common.cancel")}
                      </button>
                    </div>
                    <Show when={submission.result?.error}>
                      {(err) => <div data-slot="form-error">{localizeError(i18n.t, err())}</div>}
                    </Show>
                  </form>
                }
              >
                <div data-slot="invoice-summary">
                  <div>
                    <p>{details().name}</p>
                    <p>{details().address.line1}</p>
                    <Show when={details().address.line2}>{(line) => <p>{line()}</p>}</Show>
                    <p>
                      {[details().address.city, details().address.state, details().address.postalCode]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    <p>{details().address.country}</p>
                  </div>
                  <button data-color="primary" onClick={show}>
                    {i18n.t("workspace.settings.edit")}
                  </button>
                </div>
              </Show>
            )}
          </Show>
        </div>
      </section>
    </Show>
  )
}
