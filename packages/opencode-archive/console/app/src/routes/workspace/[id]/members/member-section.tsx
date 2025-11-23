import { json, query, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, For, Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { createStore } from "solid-js/store"
import styles from "./member-section.module.css"
import { UserRole } from "@opencode-ai/console-core/schema/user.sql.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { User } from "@opencode-ai/console-core/user.js"
import { RoleDropdown } from "./role-dropdown"

const listMembers = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return {
      members: await User.list(),
      actorID: Actor.userID(),
      actorRole: Actor.userRole(),
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
  const limit = form.get("limit")?.toString()
  const monthlyLimit = limit && limit.trim() !== "" ? parseInt(limit) : null
  if (monthlyLimit !== null && monthlyLimit < 0) return { error: "Set a valid monthly limit" }
  return json(
    await withActor(
      () =>
        User.invite({ email, role, monthlyLimit })
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

const updateMember = action(async (form: FormData) => {
  "use server"

  const id = form.get("id")?.toString()
  if (!id) return { error: "ID is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  const role = form.get("role")?.toString() as (typeof UserRole)[number]
  if (!role) return { error: "Role is required" }
  const limit = form.get("limit")?.toString()
  const monthlyLimit = limit && limit.trim() !== "" ? parseInt(limit) : null
  if (monthlyLimit !== null && monthlyLimit < 0) return { error: "Set a valid monthly limit" }

  return json(
    await withActor(
      () =>
        User.update({ id, role, monthlyLimit })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: listMembers.key },
  )
}, "member.update")

function MemberRow(props: { member: any; workspaceID: string; actorID: string; actorRole: string }) {
  const submission = useSubmission(updateMember)
  const isCurrentUser = () => props.actorID === props.member.id
  const isAdmin = () => props.actorRole === "admin"
  const [store, setStore] = createStore({
    editing: false,
    selectedRole: props.member.role as (typeof UserRole)[number],
    limit: "",
  })

  createEffect(() => {
    if (!submission.pending && submission.result && !submission.result.error) {
      setStore("editing", false)
    }
  })

  function show() {
    while (true) {
      submission.clear()
      if (!submission.result) break
    }
    setStore("editing", true)
    setStore("selectedRole", props.member.role)
    setStore("limit", props.member.monthlyLimit?.toString() ?? "")
  }

  function hide() {
    setStore("editing", false)
  }

  function getUsageDisplay() {
    const currentUsage = (() => {
      const dateLastUsed = props.member.timeMonthlyUsageUpdated
      if (!dateLastUsed) return 0

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
      return current === lastUsed ? (props.member.monthlyUsage ?? 0) : 0
    })()

    const limit = props.member.monthlyLimit ? `$${props.member.monthlyLimit}` : "no limit"
    return `$${(currentUsage / 100000000).toFixed(2)} / ${limit}`
  }

  return (
    <tr>
      <td data-slot="member-email">{props.member.authEmail ?? props.member.email}</td>
      <td data-slot="member-role">
        <Show when={store.editing && !isCurrentUser()} fallback={<span>{props.member.role}</span>}>
          <RoleDropdown
            value={store.selectedRole}
            options={roleOptions}
            onChange={(value) => setStore("selectedRole", value as (typeof UserRole)[number])}
          />
        </Show>
      </td>
      <td data-slot="member-usage">
        <Show when={store.editing} fallback={<span>{getUsageDisplay()}</span>}>
          <input
            data-component="input"
            type="number"
            value={store.limit}
            onInput={(e) => setStore("limit", e.currentTarget.value)}
            placeholder="No limit"
            min="0"
          />
        </Show>
      </td>
      <td data-slot="member-joined">{props.member.timeSeen ? "" : "invited"}</td>
      <Show when={isAdmin()}>
        <td data-slot="member-actions">
          <Show
            when={store.editing}
            fallback={
              <>
                <button data-color="ghost" onClick={() => show()}>
                  Edit
                </button>
                <Show when={!isCurrentUser()}>
                  <form action={removeMember} method="post">
                    <input type="hidden" name="id" value={props.member.id} />
                    <input type="hidden" name="workspaceID" value={props.workspaceID} />
                    <button data-color="ghost">Delete</button>
                  </form>
                </Show>
              </>
            }
          >
            <form action={updateMember} method="post" data-slot="inline-edit-form">
              <input type="hidden" name="id" value={props.member.id} />
              <input type="hidden" name="workspaceID" value={props.workspaceID} />
              <input type="hidden" name="role" value={store.selectedRole} />
              <input type="hidden" name="limit" value={store.limit} />
              <button type="submit" data-color="ghost" disabled={submission.pending}>
                {submission.pending ? "Saving..." : "Save"}
              </button>
              <Show when={!submission.pending}>
                <button type="button" data-color="ghost" onClick={() => hide()}>
                  Cancel
                </button>
              </Show>
            </form>
          </Show>
        </td>
      </Show>
    </tr>
  )
}

const roleOptions = [
  { value: "admin", description: "Can manage models, members, and billing" },
  { value: "member", description: "Can only generate API keys for themselves" },
]

export function MemberSection() {
  const params = useParams()
  const data = createAsync(() => listMembers(params.id!))
  const submission = useSubmission(inviteMember)
  const [store, setStore] = createStore({
    show: false,
    selectedRole: "member" as (typeof UserRole)[number],
    limit: "",
  })

  let input: HTMLInputElement

  createEffect(() => {
    if (!submission.pending && submission.result && !submission.result.error) {
      setStore("show", false)
    }
  })

  function show() {
    while (true) {
      submission.clear()
      if (!submission.result) break
    }
    setStore("show", true)
    setStore("selectedRole", "member")
    setStore("limit", "")
    setTimeout(() => input?.focus(), 0)
  }

  function hide() {
    setStore("show", false)
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Members</h2>
        <div data-slot="title-row">
          <p>Manage workspace members and their permissions.</p>
          <Show when={data()?.actorRole === "admin"}>
            <button data-color="primary" onClick={() => show()}>
              Invite Member
            </button>
          </Show>
        </div>
      </div>
      <div data-slot="beta-notice">
        Workspaces are free for teams during the beta.{" "}
        <a href="/docs/zen/#for-teams" target="_blank" rel="noopener noreferrer">
          Learn more
        </a>
        .
      </div>
      <Show when={store.show}>
        <form action={inviteMember} method="post" data-slot="create-form">
          <div data-slot="input-row">
            <div data-slot="input-field">
              <p>Invitee</p>
              <input
                ref={(r) => (input = r)}
                data-component="input"
                name="email"
                type="text"
                placeholder="Enter email"
              />
            </div>
            <div data-slot="input-field">
              <p>Role</p>
              <RoleDropdown
                value={store.selectedRole}
                options={roleOptions}
                onChange={(value) => setStore("selectedRole", value as (typeof UserRole)[number])}
              />
            </div>
            <div data-slot="input-field">
              <p>Monthly spending limit</p>
              <input
                data-component="input"
                name="limit"
                type="number"
                placeholder="No limit"
                value={store.limit}
                onInput={(e) => setStore("limit", e.currentTarget.value)}
                min="0"
              />
            </div>
          </div>
          <Show when={submission.result && submission.result.error}>
            {(err) => <div data-slot="form-error">{err()}</div>}
          </Show>
          <input type="hidden" name="role" value={store.selectedRole} />
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
      <div data-slot="members-table">
        <table data-slot="members-table-element">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Month limit</th>
              <th></th>
              <Show when={data()?.actorRole === "admin"}>
                <th></th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <Show when={data() && data()!.members.length > 0}>
              <For each={data()!.members}>
                {(member) => (
                  <MemberRow
                    member={member}
                    workspaceID={params.id!}
                    actorID={data()!.actorID}
                    actorRole={data()!.actorRole}
                  />
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>
    </section>
  )
}
