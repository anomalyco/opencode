import type { SessionInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { displayName } from "@opencode/ui/project-avatar"
import { SearchHighlight, SearchList } from "@opencode/ui/search-list"
import { useQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { canUseServer } from "@/runtime/server/health-machine"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { sessionLabel } from "@/session/title"
import { compareSessionTime } from "@/shell/layout/helpers"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import type { LocalProject } from "@/shell/state/layout"
import { createProjectSessionActions } from "@/shell/tabs/project-sessions"
import { pathKey } from "@/workspaces/path-key"
import { HOME_SESSION_LIMIT, mergeHomeSessionIndex } from "../sessions/index"
import { projectSessionDirectories, projectSessionsQuery } from "../sessions/queries"
import type { ProjectBrowserTarget } from "./browse"
import "@/shell/commands/dialog.css"
import "@/shell/palette-menu.css"

export default function ProjectBrowserView(props: { initial?: ProjectBrowserTarget }) {
  const language = useLanguage()

  const servers = useServers()

  const global = useGlobal()

  const [state, setState] = createStore({ selected: props.initial, query: "" })

  const projects = createMemo(() => {
    const match = state.query.trim().toLowerCase()

    return servers.visible.flatMap((conn) => {
      const server = ServerConnection.key(conn)

      const label = servers.label(conn)

      return (global.serverCtx(server)?.projects.used() ?? [])
        .filter((project) =>
          [label, displayName(project), project.worktree].some((value) => value.toLowerCase().includes(match)),
        )
        .map((project) => ({ server, label, project, directory: project.worktree }))
    })
  })

  let body: HTMLDivElement | undefined

  createEffect(
    on(
      () => state.selected,
      () => body?.querySelector("input")?.focus({ preventScroll: true }),
      { defer: true },
    ),
  )

  return (
    <Dialog class="command-palette command-palette-compact" size="large" fit>
      <div class="sr-only">
        <DialogTitle>{language.t("project.browse.title")}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <div ref={body} class="flex min-h-0 flex-1 flex-col">
          <Show
            when={state.selected}
            keyed
            fallback={
              <SearchList
                query={state.query}
                onQuery={(query) => setState("query", query)}
                placeholder={language.t("session.new.project.search")}
                items={projects()}
                key={(item) => `${item.server}\0${item.directory}`}
                section={(item) => item.server}
                header={(item) => (
                  <bdi class="truncate">
                    <SearchHighlight text={item.label} />
                  </bdi>
                )}
                empty={language.t("settings.projects.empty")}
                onSelect={(item) => setState("selected", { server: item.server, directory: item.directory })}
              >
                {(item, row) => (
                  <button type="button" class="command-palette-row" data-size="compact" {...row}>
                    <SessionTabAvatarView project={item().project} directory={item().directory} unread={false} />
                    <ResultLabel title={displayName(item().project)} directory={item().directory} />
                    <Icon name="chevron-right" class="shrink-0 text-v2-icon-icon-muted rtl:rotate-180" />
                  </button>
                )}
              </SearchList>
            }
          >
            {(target) => <ProjectSessions target={target} back={() => setState("selected", undefined)} />}
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}

function ProjectSessions(props: { target: ProjectBrowserTarget; back: () => void }) {
  const language = useLanguage()

  const dialog = useDialog()

  const global = useGlobal()

  const servers = useServers()

  const actions = createProjectSessionActions()

  const connection = createMemo(() =>
    servers.visible.find((conn) => ServerConnection.key(conn) === props.target.server),
  )

  const context = useServerCtx(connection)

  const project = createMemo<LocalProject>(
    () => context()?.projects.forDirectory(props.target.directory) ?? { worktree: props.target.directory },
  )

  const directories = createMemo(() => projectSessionDirectories(project(), context()?.projects.used() ?? []))

  const unavailable = () => !context() || !canUseServer(global.servers.health[props.target.server])

  // Listing worktrees updates the project object, so subscribe to its ID.
  const projectID = createMemo(() => project().id)

  createEffect(
    on([context, () => context()?.sdk.connection.status(), projectID], ([ctx, status, id]) => {
      if (ctx && id && status === "connected")
        void ctx.sync.worktrees.list(id).then(() => ctx.sync.worktrees.refresh(id))
    }),
  )

  const [filter, setFilter] = createStore({ text: "", search: "" })

  const text = createMemo(() => filter.text.trim())

  createEffect(
    on(text, (value) => {
      if (!value) return void setFilter("search", "")
      const timer = setTimeout(() => setFilter("search", value), 150)
      onCleanup(() => clearTimeout(timer))
    }),
  )

  const recent = useQuery(() => projectSessionsQuery(connection(), context(), directories()))

  const search = useQuery(() =>
    projectSessionsQuery(connection(), context(), filter.search ? directories() : undefined, filter.search),
  )

  const current = () => (text() ? search : recent)

  const pending = () => text() !== filter.search || current().isPending

  const failed = () => !pending() && (current().isError || current().data?.().partial)

  const sessions = createMemo(() => {
    const ctx = context()

    if (!ctx) return []
    const scope = new Set(directories().map(pathKey))

    const rows = recent.isPending ? [] : (recent.data?.().sessions ?? [])

    const matches = text() && !pending() ? (search.data?.().sessions ?? []) : []

    const results = ctx.data.session.apply(mergeHomeSessionIndex([...rows, ...matches], ctx.data.session.known()))

    const needle = text().toLowerCase()

    return results
      .filter(
        (session) =>
          scope.has(pathKey(session.location.directory)) &&
          (!needle ||
            [sessionLabel(session), session.id, session.location.directory].some((value) =>
              value.toLowerCase().includes(needle),
            )),
      )
      .sort(compareSessionTime)
      .slice(0, HOME_SESSION_LIMIT)
  })

  function open(session?: SessionInfo) {
    const conn = connection()

    if (dialog.closing || !conn || unavailable()) return
    const directory = project().worktree
    dialog.close()

    if (session) return actions.openProjectSession(conn, directory, session)
    actions.openProjectNewSession(conn, directory)
  }

  return (
    <>
      <SearchList
        query={filter.text}
        onQuery={(value) => setFilter("text", value)}
        placeholder={language.t("home.sessions.search.placeholder.scoped", { scope: displayName(project()) })}
        items={sessions()}
        key={(session) => session.id}
        empty={language.t(
          unavailable()
            ? "session.error.unreachable"
            : pending()
              ? "common.loading"
              : failed()
                ? "home.sessions.load.failed"
                : "palette.empty",
        )}
        footer={
          <Show when={!unavailable() && failed()}>
            <div class="flex items-center justify-between gap-2" role="status">
              <span>{language.t(current().isError ? "home.sessions.load.failed" : "project.browse.partial")}</span>
              <Button variant="ghost-muted" size="small" onClick={() => void current().refetch()}>
                {language.t("common.retry")}
              </Button>
            </div>
          </Show>
        }
        onSelect={open}
      >
        {(session, row) => (
          <button type="button" class="command-palette-row" data-size="compact" disabled={unavailable()} {...row}>
            <SessionTabAvatarView project={project()} directory={session().location.directory} unread={false} />
            <ResultLabel title={sessionLabel(session())} directory={session().location.directory} />
          </button>
        )}
      </SearchList>
      <DialogFooter>
        <Button size="small" variant="ghost-muted" onClick={props.back}>
          <Icon name="chevron-left" class="rtl:rotate-180" />
          {language.t("project.browse.back")}
        </Button>
        <Button size="small" variant="neutral" disabled={unavailable()} onClick={() => open()}>
          <Icon name="plus" />
          {language.t("project.browse.newSession")}
        </Button>
      </DialogFooter>
    </>
  )
}

function ResultLabel(props: { title: string; directory: string }) {
  return (
    <span class="command-palette-row-text">
      <bdi class="command-palette-title palette-menu-title">
        <SearchHighlight text={props.title} />
      </bdi>
      <bdi class="command-palette-description" dir="ltr">
        <SearchHighlight text={props.directory} />
      </bdi>
    </span>
  )
}
