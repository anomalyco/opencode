import { json, query, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, For, Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { createStore } from "solid-js/store"
import styles from "./member-section.module.css"
import { UserRole } from "@opencode-ai/console-core/schema/user.sql.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { User } from "@opencode-ai/console-core/user.js"
import { RoleDropdown } from "./role-dropdown"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { formError, localizeError } from "~/lib/form-error"

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
  if (!email) return { error: formError.emailRequired }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: formError.workspaceRequired }
  const role = form.get("role")?.toString() as (typeof UserRole)[number]
  if (!role) return { error: formError.roleRequired }
  const limit = form.get("limit")?.toString()
  const monthlyLimit = limit && limit.trim() !== "" ? parseInt(limit) : null
  if (monthlyLimit !== null && monthlyLimit < 0) return { error: formError.monthlyLimitInvalid }
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
  if (!id) return { error: formError.idRequired }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: formError.workspaceRequired }
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
  if (!id) return { error: formError.idRequired }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: formError.workspaceRequired }
  const role = form.get("role")?.toString() as (typeof UserRole)[number]
  if (!role) return { error: formError.roleRequired }
  const limit = form.get("limit")?.toString()
  const monthlyLimit = limit && limit.trim() !== "" ? parseInt(limit) : null
  if (monthlyLimit !== null && monthlyLimit < 0) return { error: formError.monthlyLimitInvalid }

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

function MemberRow(props: {
  member: any
  workspaceID: string
  actorID: string
  actorRole: string
  roleOptions: { value: string; label: string; description: string }[]
}) {
  const i18n = useI18n()
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
      return current === lastUsed ? (props.member.monthlyUsage ?? 0) : 0
    })()

    const limit = props.member.monthlyLimit
      ? `$${props.member.monthlyLimit}`
      : i18n.t("workspace.members.noLimitLowercase")
    return `$${(currentUsage / 100000000).toFixed(2)} / ${limit}`
  }

  const roleLabel = (value: string) => props.roleOptions.find((option) => option.value === value)?.label ?? value

  return (
    <tr>
      <td data-slot="member-email">{props.member.authEmail ?? props.member.email}</td>
      <td data-slot="member-role">
        <Show when={store.editing && !isCurrentUser()} fallback={<span>{roleLabel(props.member.role)}</span>}>
          <RoleDropdown
            value={store.selectedRole}
            options={props.roleOptions}
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
            placeholder={i18n.t("workspace.members.noLimit")}
            min="0"
          />
        </Show>
      </td>
      <td data-slot="member-joined">{props.member.timeSeen ? "" : i18n.t("workspace.members.invited")}</td>
      <Show when={isAdmin()}>
        <td data-slot="member-actions">
          <Show
            when={store.editing}
            fallback={
              <>
                <button data-color="ghost" onClick={() => show()}>
                  {i18n.t("workspace.members.edit")}
                </button>
                <Show when={!isCurrentUser()}>
                  <form action={removeMember} method="post">
                    <input type="hidden" name="id" value={props.member.id} />
                    <input type="hidden" name="workspaceID" value={props.workspaceID} />
                    <button data-color="ghost">{i18n.t("workspace.members.delete")}</button>
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
                {submission.pending ? i18n.t("workspace.members.saving") : i18n.t("workspace.members.save")}
              </button>
              <Show when={!submission.pending}>
                <button type="button" data-color="ghost" onClick={() => hide()}>
                  {i18n.t("common.cancel")}
                </button>
              </Show>
            </form>
          </Show>
        </td>
      </Show>
    </tr>
  )
}

export function MemberSection() {
  const params = useParams()
  const i18n = useI18n()
  const language = useLanguage()
  const data = createAsync(() => listMembers(params.id!))
  const submission = useSubmission(inviteMember)
  const [store, setStore] = createStore({
    show: false,
    selectedRole: "member" as (typeof UserRole)[number],
    limit: "",
  })

  let input: HTMLInputElement

  const roleOptions = [
    {
      value: "admin",
      label: i18n.t("workspace.members.role.admin"),
      description: i18n.t("workspace.members.role.adminDescription"),
    },
    {
      value: "member",
      label: i18n.t("workspace.members.role.member"),
      description: i18n.t("workspace.members.role.memberDescription"),
    },
  ]

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
        <h2>{i18n.t("workspace.members.title")}</h2>
        <div data-slot="title-row">
          <p>{i18n.t("workspace.members.subtitle")}</p>
          <Show when={data()?.actorRole === "admin"}>
            <button data-color="primary" onClick={() => show()}>
              {i18n.t("workspace.members.invite")}
            </button>
          </Show>
        </div>
      </div>
      <div data-slot="beta-notice">
        {i18n.t("workspace.members.beta.beforeLink")}{" "}
        <a href={language.route("/docs/zen/#for-teams")} target="_blank" rel="noopener noreferrer">
          {i18n.t("common.learnMore")}
        </a>
        .
      </div>
      <Show when={store.show}>
        <form action={inviteMember} method="post" data-slot="create-form">
          <div data-slot="input-row">
            <div data-slot="input-field">
              <p>{i18n.t("workspace.members.form.invitee")}</p>
              <input
                ref={(r) => (input = r)}
                data-component="input"
                name="email"
                type="text"
                placeholder={i18n.t("workspace.members.form.emailPlaceholder")}
              />
            </div>
            <div data-slot="input-field">
              <p>{i18n.t("workspace.members.form.role")}</p>
              <RoleDropdown
                value={store.selectedRole}
                options={roleOptions}
                onChange={(value) => setStore("selectedRole", value as (typeof UserRole)[number])}
              />
            </div>
            <div data-slot="input-field">
              <p>{i18n.t("workspace.members.form.monthlyLimit")}</p>
              <input
                data-component="input"
                name="limit"
                type="number"
                placeholder={i18n.t("workspace.members.noLimit")}
                value={store.limit}
                onInput={(e) => setStore("limit", e.currentTarget.value)}
                min="0"
              />
            </div>
          </div>
          <Show when={submission.result && submission.result.error}>
            {(err) => <div data-slot="form-error">{localizeError(i18n.t, err())}</div>}
          </Show>
          <input type="hidden" name="role" value={store.selectedRole} />
          <input type="hidden" name="workspaceID" value={params.id} />
          <div data-slot="form-actions">
            <button type="reset" data-color="ghost" onClick={() => hide()}>
              {i18n.t("common.cancel")}
            </button>
            <button type="submit" data-color="primary" disabled={submission.pending}>
              {submission.pending ? i18n.t("workspace.members.inviting") : i18n.t("workspace.members.invite")}
            </button>
          </div>
        </form>
      </Show>
      <div data-slot="members-table">
        <table data-slot="members-table-element">
          <thead>
            <tr>
              <th>{i18n.t("workspace.members.table.email")}</th>
              <th>{i18n.t("workspace.members.table.role")}</th>
              <th>{i18n.t("workspace.members.table.monthLimit")}</th>
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
                    roleOptions={roleOptions}
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
