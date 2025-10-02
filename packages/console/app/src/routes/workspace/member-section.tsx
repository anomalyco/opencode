import { json, query, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, createSignal, For, Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { createStore } from "solid-js/store"
import styles from "./member-section.module.css"
import { UserRole } from "@opencode/console-core/schema/user.sql.js"
import { Actor } from "@opencode/console-core/actor.js"
import { User } from "@opencode/console-core/user.js"

const listMembers = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const actor = Actor.assert("user")
    return {
      members: await User.list(),
      currentUserID: actor.properties.userID,
    }
  }, workspaceID)
}, "member.list")

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
        User.invite({ email, role })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: listMembers.key },
  )
}, "member.create")

const removeMember = action(async (form: FormData) => {
  "use server"
  const id = form.get("id")?.toString()
  if (!id) return { error: "ID is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(
    await withActor(
      () =>
        User.remove(id)
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: listMembers.key },
  )
}, "member.remove")

const updateMemberRole = action(async (form: FormData) => {
  "use server"
  const id = form.get("id")?.toString()
  if (!id) return { error: "ID is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  const role = form.get("role")?.toString() as (typeof UserRole)[number]
  if (!role) return { error: "Role is required" }
  return json(
    await withActor(
      () =>
        User.updateRole({ id, role })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: listMembers.key },
  )
}, "member.updateRole")

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

function MemberRow(props: { member: any; workspaceID: string; currentUserID: string | null }) {
  const [editing, setEditing] = createSignal(false)
  const submission = useSubmission(updateMemberRole)
  const isCurrentUser = () => props.currentUserID === props.member.id

  createEffect(() => {
    if (!submission.pending && submission.result && !submission.result.error) {
      setEditing(false)
    }
  })

  return (
    <Show
      when={editing()}
      fallback={
        <tr>
          <td data-slot="member-email">{props.member.email}</td>
          <td data-slot="member-role">{props.member.role}</td>
          <Show when={!props.member.timeSeen} fallback={<td data-slot="member-joined"></td>}>
            <td data-slot="member-joined">invited</td>
          </Show>
          <td data-slot="member-actions">
            <button data-color="ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            <Show when={!isCurrentUser()}>
              <form action={removeMember} method="post">
                <input type="hidden" name="id" value={props.member.id} />
                <input type="hidden" name="workspaceID" value={props.workspaceID} />
                <button data-color="ghost">Delete</button>
              </form>
            </Show>
          </td>
        </tr>
      }
    >
      <tr>
        <td colspan="4">
          <form action={updateMemberRole} method="post">
            <div data-slot="edit-member-email">{props.member.email}</div>
            <input type="hidden" name="id" value={props.member.id} />
            <input type="hidden" name="workspaceID" value={props.workspaceID} />
            <Show when={!isCurrentUser()} fallback={<div data-slot="current-user-role">Role: {props.member.role}</div>}>
              <div data-slot="role-selector">
                <label>
                  <input type="radio" name="role" value="admin" checked={props.member.role === "admin"} />
                  <div>
                    <strong>Admin</strong>
                    <p>Can manage models, members, and billing</p>
                  </div>
                </label>
                <label>
                  <input type="radio" name="role" value="member" checked={props.member.role === "member"} />
                  <div>
                    <strong>Member</strong>
                    <p>Can only generate API keys for themselves</p>
                  </div>
                </label>
              </div>
            </Show>
            <Show when={submission.result && submission.result.error}>
              {(err) => <div data-slot="form-error">{err()}</div>}
            </Show>
            <div data-slot="form-actions">
              <button type="button" data-color="ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <Show when={!isCurrentUser()}>
                <button type="submit" data-color="primary" disabled={submission.pending}>
                  {submission.pending ? "Saving..." : "Save"}
                </button>
              </Show>
            </div>
          </form>
        </td>
      </tr>
    </Show>
  )
}

export function MemberSection() {
  const params = useParams()
  const data = createAsync(() => listMembers(params.id))

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Members</h2>
        <p>Manage your members for accessing opencode services.</p>
      </div>
      <MemberCreateForm />
      <div data-slot="members-table">
        <Show
          when={data()?.members.length}
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
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={data()!.members}>
                {(member) => (
                  <MemberRow member={member} workspaceID={params.id} currentUserID={data()!.currentUserID} />
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </section>
  )
}
