import { query, useParams, action, createAsync, redirect, useSubmission } from "@solidjs/router"
import { For, Show, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { withActor } from "~/context/auth.withActor"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { Workspace } from "@opencode-ai/console-core/workspace.js"
import { Dropdown, DropdownItem } from "~/component/dropdown"
import { Modal } from "~/component/modal"
import "./workspace-picker.css"

const getWorkspaces = query(async () => {
  "use server"
  return withActor(async () => {
    return Database.use((tx) =>
      tx
        .select({
          id: WorkspaceTable.id,
          name: WorkspaceTable.name,
          slug: WorkspaceTable.slug,
        })
        .from(UserTable)
        .innerJoin(WorkspaceTable, eq(UserTable.workspaceID, WorkspaceTable.id))
        .where(
          and(
            eq(UserTable.accountID, Actor.account()),
            isNull(WorkspaceTable.timeDeleted),
            isNull(UserTable.timeDeleted),
          ),
        ),
    )
  })
}, "workspaces")

const createWorkspace = action(async (form: FormData) => {
  "use server"
  const name = form.get("workspaceName") as string
  if (name?.trim()) {
    return withActor(async () => {
      const workspaceID = await Workspace.create({ name: name.trim() })
      return redirect(`/workspace/${workspaceID}`)
    })
  }
}, "createWorkspace")

export function WorkspacePicker() {
  const params = useParams()
  const workspaces = createAsync(() => getWorkspaces())
  const submission = useSubmission(createWorkspace)
  const [store, setStore] = createStore({
    showForm: false,
  })
  let inputRef: HTMLInputElement | undefined

  const currentWorkspace = () => {
    const ws = workspaces()?.find((w) => w.id === params.id)
    return ws ? ws.name : "Select workspace"
  }

  const handleWorkspaceNew = () => {
    setStore("showForm", true)
  }

  createEffect(() => {
    if (store.showForm && inputRef) {
      setTimeout(() => inputRef?.focus(), 0)
    }
  })

  const handleSelectWorkspace = (workspaceID: string) => {
    if (workspaceID === params.id) return
    window.location.href = `/workspace/${workspaceID}`
  }

  // Reset signals when workspace ID changes
  createEffect(() => {
    params.id
    setStore("showForm", false)
  })

  return (
    <div data-component="workspace-picker">
      <Dropdown trigger={currentWorkspace()} align="left">
        <For each={workspaces()}>
          {(workspace) => (
            <DropdownItem selected={workspace.id === params.id} onClick={() => handleSelectWorkspace(workspace.id)}>
              {workspace.name || workspace.slug}
            </DropdownItem>
          )}
        </For>
        <button data-slot="create-item" type="button" onClick={() => handleWorkspaceNew()}>
          + Create New Workspace
        </button>
      </Dropdown>

      <Modal open={store.showForm} onClose={() => setStore("showForm", false)} title="Create New Workspace">
        <form data-slot="create-form" action={createWorkspace} method="post">
          <div data-slot="create-input-group">
            <input
              ref={inputRef}
              data-slot="create-input"
              type="text"
              name="workspaceName"
              placeholder="Enter workspace name"
              required
            />
            <div data-slot="button-group">
              <button type="button" data-color="ghost" onClick={() => setStore("showForm", false)}>
                Cancel
              </button>
              <button type="submit" data-color="primary" disabled={submission.pending}>
                {submission.pending ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
