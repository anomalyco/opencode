import { json, action, useParams, useSubmission, createAsync, query } from "@solidjs/router"
import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { withActor } from "~/context/auth.withActor"
import { Workspace } from "@opencode-ai/console-core/workspace.js"
import styles from "./settings-section.module.css"
import { Database, eq } from "@opencode-ai/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"

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
  const name = form.get("name")?.toString().trim()
  if (!name) return { error: "Workspace name is required." }
  if (name.length > 255) return { error: "Name must be 255 characters or less." }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required." }
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

export function SettingsSection() {
  const params = useParams()
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
        <h2>Settings</h2>
        <p>Update your workspace name and preferences.</p>
      </div>
      <div data-slot="section-content">
        <div data-slot="setting">
          <p>Workspace name</p>
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
                    placeholder="Workspace name"
                    value={workspaceInfo()?.name ?? "Default"}
                  />
                  <input type="hidden" name="workspaceID" value={params.id} />
                  <button type="submit" data-color="primary" disabled={submission.pending}>
                    {submission.pending ? "Updating..." : "Save"}
                  </button>
                  <button type="reset" data-color="ghost" onClick={() => hide()}>
                    Cancel
                  </button>
                </div>
                <Show when={submission.result && submission.result.error}>
                  {(err) => <div data-slot="form-error">{err()}</div>}
                </Show>
              </form>
            }
          >
            <div data-slot="value-with-action">
              <p data-slot="current-value">{workspaceInfo()?.name}</p>
              <button data-color="primary" onClick={() => show()}>
                Edit
              </button>
            </div>
          </Show>
        </div>
      </div>
    </section>
  )
}
