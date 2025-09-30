import { json, query, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, createSignal, For, Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { createStore } from "solid-js/store"
import { formatDateUTC, formatDateForTable } from "./common"
import styles from "./member-section.module.css"
import { and, Database, eq, sql } from "@opencode/console-core/drizzle/index.js"
import { UserTable, UserRole } from "@opencode/console-core/schema/user.sql.js"
import { Identifier } from "@opencode/console-core/identifier.js"

const removeMember = action(async (form: FormData) => {
  "use server"
  const id = form.get("id")?.toString()
  if (!id) return { error: "ID is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(
    await withActor(
      () =>
        Database.use((tx) =>
          tx
            .update(UserTable)
            .set({ timeDeleted: sql`now()` })
            .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, workspaceID))),
        ),
      workspaceID,
    ),
    { revalidate: listMembers.key },
  )
}, "member.remove")

const inviteMember = action(async (form: FormData) => {
  "use server"
  const email = form.get("email")?.toString().trim()
  if (!email) return { error: "Email is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  const role = form.get("role")?.toString() as (typeof UserRole)[number]
  if (!role) return { error: "Role is required" }
  return json(
    await withActor(
      () =>
        Database.use((tx) =>
          tx
            .insert(UserTable)
            .values({
              id: Identifier.create("user"),
              name: "",
              email,
              workspaceID,
              role,
            })
            .then((data) => ({ error: undefined, data }))
            .catch((e) => ({ error: e.message as string })),
        ),
      workspaceID,
    ),
    { revalidate: listMembers.key },
  )
}, "member.create")

const listMembers = query(async (workspaceID: string) => {
  "use server"
  return withActor(
    () => Database.use((tx) => tx.select().from(UserTable).where(eq(UserTable.workspaceID, workspaceID))),
    workspaceID,
  )
}, "member.list")

export function MemberCreateForm() {
  const params = useParams()
  const submission = useSubmission(inviteMember)
  const [store, setStore] = createStore({ show: false })

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
    <Show
      when={store.show}
      fallback={
        <button data-color="primary" onClick={() => show()}>
          Invite Member
        </button>
      }
    >
      <form action={inviteMember} method="post" data-slot="create-form">
        <div data-slot="input-container">
          <input ref={(r) => (input = r)} data-component="input" name="email" type="text" placeholder="Enter email" />
          <div data-slot="role-selector">
            <label>
              <input type="radio" name="role" value="admin" checked />
              <div>
                <strong>Admin</strong>
                <p>Can manage models, members, and billing</p>
              </div>
            </label>
            <label>
              <input type="radio" name="role" value="member" />
              <div>
                <strong>Member</strong>
                <p>Can only generate API keys for themselves</p>
              </div>
            </label>
          </div>
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
            {submission.pending ? "Inviting..." : "Invite"}
          </button>
        </div>
      </form>
    </Show>
  )
}

export function MemberSection() {
  const params = useParams()
  const members = createAsync(() => listMembers(params.id))

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Members</h2>
        <p>Manage your members for accessing opencode services.</p>
      </div>
      <MemberCreateForm />
      <div data-slot="members-table">
        <Show
          when={members()?.length}
          fallback={
            <div data-component="empty-state">
              <p>Invite a member to your workspace</p>
            </div>
          }
        >
          <table data-slot="members-table-element">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={members()!}>
                {(member) => {
                  return (
                    <tr>
                      <td data-slot="member-email">{member.email}</td>
                      <td data-slot="member-role">{member.role}</td>
                      <Show when={member.timeSeen} fallback={<td data-slot="member-joined">invited</td>}>
                        <td data-slot="member-joined" title={formatDateUTC(member.timeSeen!)}>
                          {formatDateForTable(member.timeSeen!)}
                        </td>
                      </Show>
                      <td data-slot="member-actions">
                        <form action={removeMember} method="post">
                          <input type="hidden" name="id" value={member.id} />
                          <input type="hidden" name="workspaceID" value={params.id} />
                          <button data-color="ghost">Delete</button>
                        </form>
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </section>
  )
}
