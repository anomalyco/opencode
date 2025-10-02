import { json, query, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, createSignal, For, Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { createStore } from "solid-js/store"
import styles from "./member-section.module.css"
import { and, Database, eq, isNull, sql } from "@opencode/console-core/drizzle/index.js"
import { UserTable, UserRole } from "@opencode/console-core/schema/user.sql.js"
import { Identifier } from "@opencode/console-core/identifier.js"
import { Actor } from "@opencode/console-core/actor.js"
import { AWS } from "@opencode/console-core/aws.js"

const assertAdmin = async (workspaceID: string) => {
  const actor = Actor.use()
  if (actor.type !== "user") throw new Error(`Expected admin user, got ${actor.type}`)
  const user = await Database.use((tx) =>
    tx
      .select()
      .from(UserTable)
      .where(and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.id, actor.properties.userID))),
  ).then((x) => x[0])
  if (user?.role !== "admin") throw new Error(`Expected admin user, got ${user?.role}`)
  return actor
}

const assertNotSelf = (id: string) => {
  const actor = Actor.use()
  if (actor.type === "user" && actor.properties.userID === id) {
    throw new Error(`Expected not self actor, got self actor`)
  }
  return actor
}

const listMembers = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const actor = await assertAdmin(workspaceID)
    return Database.use((tx) =>
      tx
        .select()
        .from(UserTable)
        .where(and(eq(UserTable.workspaceID, workspaceID), isNull(UserTable.timeDeleted))),
    ).then((members) => ({
      members,
      currentUserID: actor.properties.userID,
    }))
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
    await withActor(async () => {
      await assertAdmin(workspaceID)
      return Database.use((tx) =>
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
          .then(async (data) => {
            const { render } = await import("@jsx-email/render")
            const { InviteEmail } = await import("@opencode/console-mail/InviteEmail.jsx")
            await AWS.sendEmail({
              to: email,
              subject: `You've been invited to join the ${workspaceID} workspace on OpenCode Zen`,
              body: render(
                // @ts-ignore
                InviteEmail({
                  assetsUrl: `https://opencode.ai/email`,
                  workspace: workspaceID,
                }),
              ),
            })
            return data
          })
          .catch((e) => {
            let error = e.message
            if (error.match(/Duplicate entry '.*' for key 'user.user_email'/))
              error = "A user with this email has already been invited."
            return { error }
          }),
      )
    }, workspaceID),
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
    await withActor(async () => {
      await assertAdmin(workspaceID)
      assertNotSelf(id)
      return Database.transaction(async (tx) => {
        const email = await tx
          .select({ email: UserTable.email })
          .from(UserTable)
          .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, workspaceID)))
          .execute()
          .then((rows) => rows[0].email)
        if (!email) return { error: "User not found" }
        await tx
          .update(UserTable)
          .set({
            oldEmail: email,
            email: null,
            timeDeleted: sql`now()`,
          })
          .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, workspaceID)))
      })
        .then(() => ({ error: undefined }))
        .catch((e) => ({ error: e.message as string }))
    }, workspaceID),
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
    await withActor(async () => {
      await assertAdmin(workspaceID)
      if (role === "member") assertNotSelf(id)
      return Database.use((tx) =>
        tx
          .update(UserTable)
          .set({ role })
          .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, workspaceID)))
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string })),
      )
    }, workspaceID),
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
