import { createEffect, createMemo, createUniqueId, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Icon } from "@opencode/ui/icon"
import { displayName } from "@opencode/ui/project-avatar"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import type { ServerCtx } from "@/runtime/server/runtime"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { sessionRequests } from "@/shell/layout/project-avatar-state"
import { sessionTabTitle } from "@/shell/titlebar/tab-title"
import { elapsedTime } from "@/shell/sessions/duration"
import { createSessionBranches } from "@/shell/sessions/branches"
import { pathKey } from "@/workspaces/path-key"
import "./running.css"

/** Execution and collected Shell activity include sessions without an open tab, including child sessions. */
export function RunningSessions(props: {
  connections: { conn: ServerConnection.Any; ctx: ServerCtx | undefined }[]
  selected?: { server: ServerConnection.Key; sessionID: string }
  onOpen: (server: ServerConnection.Key, sessionID: string) => void
}) {
  const language = useLanguage()
  const settings = useSettings()
  const heading = createUniqueId()

  const branches = createSessionBranches(() =>
    props.connections.flatMap((item) =>
      item.ctx?.sdk.connection.status() === "connected" ? [ServerConnection.key(item.conn)] : [],
    ),
  )

  const [clock, setClock] = createStore({ now: Date.now() })

  const entries = createMemo(() =>
    props.connections.flatMap((item) => {
      const ctx = item.ctx

      if (!ctx || ctx.sdk.connection.status() !== "connected") return []

      return [...new Set([...ctx.data.session.active(), ...ctx.data.shell.activeSessions()])].map((id) => ({
        key: JSON.stringify([ServerConnection.key(item.conn), id]),
        id,
        server: ServerConnection.key(item.conn),
        conn: item.conn,
        ctx,
      }))
    }),
  )

  const byKey = createMemo(() => new Map(entries().map((entry) => [entry.key, entry])))
  const disconnected = () => props.connections.some((item) => item.ctx?.sdk.connection.status() !== "connected")

  createEffect(() => {
    if (!entries().length) return
    setClock("now", Date.now())
    const timer = setInterval(() => setClock("now", Date.now()), 1_000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    branches.load(
      entries().flatMap((entry) => {
        const session = entry.ctx.data.session.get(entry.id)

        return session ? [{ server: entry.server, ctx: entry.ctx, session }] : []
      }),
    )
  })

  return (
    <section data-component="active-sessions" aria-labelledby={heading}>
      <div data-slot="active-sessions-header">
        <h2 id={heading}>{language.t("sidebar.running.title")}</h2>
        <span class="tabular-nums" aria-label={language.plural("sidebar.running.count", entries().length)}>
          {entries().length}
        </span>
      </div>
      <div data-slot="active-sessions-list" data-scrollable>
        <For
          each={[...byKey().keys()]}
          fallback={<p data-slot="active-sessions-empty">{language.t("sidebar.running.empty")}</p>}
        >
          {(key) => (
            <Show when={byKey().get(key)}>
              {(entry) => {
                // A keyed row survives other sessions and shells changing. Refresh only on arrival or a new connection.
                const context = createMemo(() => entry().ctx)

                createEffect(
                  on(context, (ctx) => {
                    void Promise.allSettled([
                      ctx.data.session.sync(entry().id),
                      ctx.data.session.permission.sync(entry().id),
                      ctx.data.session.form.sync(entry().id),
                    ])
                  }),
                )

                // A running child can belong to a parent that this window has never opened.
                createEffect(() => {
                  const value = entry()
                  const root = value.ctx.data.session.root(value.id)

                  if (root === value.id || value.ctx.data.session.get(root)) return
                  void value.ctx.data.session.sync(root).catch(() => undefined)
                })

                const session = createMemo(() => entry().ctx.data.session.get(entry().id))

                const project = createMemo(() => {
                  const value = session()

                  return value
                    ? (entry().ctx.projects.forSession(value) ?? { worktree: value.location.directory })
                    : undefined
                })

                const projectName = () => displayName(project() ?? { worktree: session()?.location.directory ?? "" })

                const branch = () => {
                  const value = session()

                  return value
                    ? branches.branch({ server: entry().server, ctx: entry().ctx, session: value })
                    : undefined
                }

                const worktree = () => {
                  const root = project()?.worktree
                  const directory = session()?.location.directory

                  return !!root && !!directory && pathKey(root) !== pathKey(directory)
                }

                const duration = () => {
                  const value = session()

                  const starts = [
                    ...(entry().ctx.data.session.status(entry().id) === "running" ? [value?.time.busy ?? 0] : []),
                    ...shells().map((shell) => shell.time.started),
                  ].filter((time) => time > 0)

                  return starts.length
                    ? elapsedTime(Math.max(0, Math.floor((clock.now - Math.min(...starts)) / 1000)), language)
                    : undefined
                }

                const shells = () =>
                  entry()
                    .ctx.data.shell.listBySession(entry().id)
                    .filter((shell) => shell.status === "running")

                const background = () =>
                  entry().ctx.data.session.status(entry().id) !== "running" && shells().length > 0

                const summary = () =>
                  shells().length ? language.plural("sidebar.running.shells", shells().length) : undefined

                const status = createMemo(() => {
                  const value = entry()

                  const requests = sessionRequests(
                    value.ctx,
                    value.id,
                    false,
                    settings.permissions.autoApproves(projectSettingsKey(value.ctx.sdk.scope, session()?.projectID)),
                  )

                  if (requests.permission) return "approval"

                  if (requests.form) return "input"

                  return "working"
                })

                const selected = () =>
                  props.selected?.server === entry().server && props.selected.sessionID === entry().id

                const lastRun = () => {
                  const idle = session()?.time.idle

                  return idle === undefined
                    ? undefined
                    : language.t("sidebar.session.lastRun", {
                        time: new Intl.DateTimeFormat(language.intl(), {
                          dateStyle: "medium",
                          timeStyle: "medium",
                        }).format(idle),
                      })
                }

                return (
                  <button
                    type="button"
                    data-slot="active-session"
                    data-state={selected() ? "active" : undefined}
                    aria-current={selected() ? "page" : undefined}
                    title={[
                      session()?.title,
                      projectName(),
                      branch(),
                      session()?.location.directory,
                      lastRun(),
                      summary(),
                      ...shells().map((shell) => shell.command),
                    ]
                      .filter(Boolean)
                      .join("\n")}
                    onClick={() => {
                      const value = entry()
                      props.onOpen(value.server, value.id)
                      const directory = project()?.worktree

                      if (directory) value.ctx.projects.touch(directory)
                    }}
                  >
                    <span data-slot="active-session-mark" aria-hidden="true">
                      <Show when={status() === "working"} fallback={<span data-slot="active-session-waiting" />}>
                        <ActivityRing />
                      </Show>
                    </span>
                    <span data-slot="active-session-title" dir="auto">
                      {sessionTabTitle(session()?.title, language.t("session.tab.session"))}
                    </span>
                    <span
                      data-slot="active-session-status"
                      data-waiting={status() !== "working" ? "" : undefined}
                      title={
                        status() === "working" && duration()
                          ? language.t("sidebar.inbox.status.workingFor", { duration: duration()! })
                          : language.t(`sidebar.inbox.status.${status()}`)
                      }
                    >
                      <span class="sr-only">
                        {language.t(
                          background() && status() === "working"
                            ? "sidebar.running.background"
                            : `sidebar.inbox.status.${status()}`,
                        )}
                      </span>
                      <span aria-hidden="true">
                        {status() === "working"
                          ? (duration() ?? language.t("sidebar.inbox.status.working"))
                          : language.t(`sidebar.inbox.status.${status()}`)}
                      </span>
                    </span>
                    <span data-slot="active-session-project" dir="auto">
                      <Show when={project()} fallback={language.t("common.loading")}>
                        <span class="min-w-0 truncate">{projectName()}</span>
                      </Show>
                      <Show when={background()}>
                        <span aria-hidden="true">·</span>
                        <span class="truncate" title={summary()}>
                          {language.t("sidebar.running.background")}
                        </span>
                      </Show>
                      <Show when={branch() || worktree()}>
                        <span aria-hidden="true">·</span>
                        <span class="flex min-w-0 items-center gap-1">
                          <Icon name={worktree() ? "outline-worktree" : "branch"} size="small" class="shrink-0" />
                          <span class="min-w-0 truncate" dir="ltr">
                            {branch()}
                          </span>
                        </span>
                      </Show>
                      <Show when={props.connections.length > 1}>
                        <span class="ms-1.5">{serverName(entry().conn)}</span>
                      </Show>
                    </span>
                  </button>
                )
              }}
            </Show>
          )}
        </For>
      </div>
      <Show when={disconnected()}>
        <p data-slot="active-sessions-empty">{language.t("sidebar.running.disconnected")}</p>
      </Show>
    </section>
  )
}
