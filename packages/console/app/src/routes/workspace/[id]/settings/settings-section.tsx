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
import { EmailChange } from "@opencode-ai/console-core/email-change.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { getActor } from "~/context/auth"

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

const getAccountEmail = query(async () => {
  "use server"
  const actor = await getActor()
  return actor.type === "account" ? actor.properties.email : null
}, "account.email")

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
  )
}, "workspace.update")

const requestEmailChange = action(async (form: FormData) => {
  "use server"
  const newEmail = (form.get("email") as string | null)?.trim()
  if (!newEmail) return { error: formError.emailRequired }
  const actor = await getActor()
  if (actor.type !== "account") return { error: "Expected account actor" }
  return json(
    await Actor.provide("account", actor.properties, () =>
      EmailChange.request({ newEmail })
        .then(() => ({ error: undefined }))
        .catch((e) => ({ error: e.message as string })),
    ),
  )
}, "account.email.change")

export function SettingsSection() {
  const params = useParams()
  const i18n = useI18n()
  const workspaceInfo = createAsync(() => getWorkspaceInfo(params.id!))
  const accountEmail = createAsync(() => getAccountEmail())
  const submission = useSubmission(updateWorkspace)
  const emailSubmission = useSubmission(requestEmailChange)
  const [store, setStore] = createStore({ show: false, showEmail: false })

  let input: HTMLInputElement
  let emailInput: HTMLInputElement

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
    queueMicrotask(() => input.focus())
  }

  function hide() {
    setStore("show", false)
  }

  function showEmail() {
    while (true) {
      emailSubmission.clear()
      if (!emailSubmission.result) break
    }
    setStore("showEmail", true)
    queueMicrotask(() => emailInput.focus())
  }

  function hideEmail() {
    setStore("showEmail", false)
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
        <div data-slot="setting">
          <p>{i18n.t("workspace.settings.accountEmail")}</p>
          <Show
            when={!store.showEmail}
            fallback={
              <form action={requestEmailChange} method="post" data-slot="create-form">
                <div data-slot="input-container">
                  <input
                    required
                    ref={(r) => (emailInput = r)}
                    data-component="input"
                    name="email"
                    type="email"
                    placeholder={i18n.t("workspace.settings.newEmailPlaceholder")}
                  />
                  <button type="submit" data-color="primary" disabled={emailSubmission.pending}>
                    {emailSubmission.pending
                      ? i18n.t("workspace.settings.sending")
                      : i18n.t("workspace.settings.sendConfirmations")}
                  </button>
                  <button type="reset" data-color="ghost" onClick={() => hideEmail()}>
                    {i18n.t("common.cancel")}
                  </button>
                </div>
                <Show when={emailSubmission.result && emailSubmission.result.error}>
                  {(err) => <div data-slot="form-error">{localizeError(i18n.t, err())}</div>}
                </Show>
                <Show when={emailSubmission.result && !emailSubmission.result.error}>
                  <div data-slot="form-success">{i18n.t("workspace.settings.emailChangeSent")}</div>
                </Show>
              </form>
            }
          >
            <div data-slot="value-with-action">
              <p data-slot="current-value">{accountEmail()}</p>
              <button data-color="primary" onClick={() => showEmail()}>
                {i18n.t("workspace.settings.changeEmail")}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </section>
  )
}
