import { Schema } from "effect"
import { createMemo, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useQueries } from "@tanstack/solid-query"
import type { SessionInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { displayName } from "@opencode/ui/project-avatar"
import { homeSessionsQuery } from "@/home/sessions/queries"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import type { Project } from "@/runtime/server/types"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { sessionStatus } from "@/shell/layout/project-avatar-state"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { createProjectSessionActions } from "@/shell/tabs/project-sessions"
import { tabKey, useTabs, type Tab } from "@/shell/tabs/tabs"
import { ProjectSessionRow } from "./project-session-row"
import { createSidebarActivityListener } from "./sidebar-organized"
import { mergeSidebarSessions } from "./sidebar-sessions"
import type { TabStripSection } from "./tab-strip"
import { SidebarFilterChips, SidebarViewMenu } from "./sidebar-view-menu"
import {
  SIDEBAR_GROUPINGS,
  SIDEBAR_ORDERINGS,
  sidebarView,
  type SidebarFilterKind,
  type SidebarFilters,
  type SidebarGroup,
  type SidebarRow,
  type SidebarStatus,
  type SidebarViewState,
} from "./sidebar-view"
import "./tab-nav.css"

const ViewState = Persistence.struct({
  grouping: Schema.Literals(SIDEBAR_GROUPINGS),
  ordering: Schema.Literals(SIDEBAR_ORDERINGS),
  show: Persistence.struct({
    recent: Schema.Boolean,
    subagents: Schema.Boolean,
    archived: Schema.Boolean,
    serverLabels: Schema.Boolean,
  }),
  collapsed: Persistence.record(Schema.Boolean),
})

const RECENT_STEP = 5

const ARCHIVED_LIMIT = 50

type Row = SidebarRow & {
  conn: ServerConnection.Any | undefined
  tab: Tab | undefined
  session: SessionInfo | undefined
  project: Project | undefined
}

export type SidebarStripGrouping = {
  sections: TabStripSection[]
  tabFooter: (tab: Tab) => JSX.Element | undefined
  tabLabel: (tab: Tab) => string | undefined
}

/** The "Customize" vertical sidebar: open tabs and recent sessions from every server, grouped, sorted and filtered. */
export function SidebarCustomized(props: {
  currentTab: Tab | undefined
  onNewSession: () => void
  children: (strip: SidebarStripGrouping) => JSX.Element
}) {
  const language = useLanguage()

  const global = useGlobal()

  const servers = useServers()

  const settings = useSettings()

  const tabs = useTabs()

  const actions = createProjectSessionActions()

  const activity = createSidebarActivityListener()

  const [view, setView] = persisted(Persist.global("sidebar.view"), ViewState, {
    grouping: "project",
    ordering: "manual",
    show: { recent: true, subagents: false, archived: false, serverLabels: true },
    collapsed: {},
  })

  // Filters narrow the list for this window only; they reset on reload.
  const [local, setLocal] = createStore<{ filters: SidebarFilters; limits: Record<string, number>; open: boolean }>({
    filters: { status: [], server: [], project: [] },
    limits: {},
    open: true,
  })

  const connected = createMemo(() =>
    global.servers.list().filter((conn) => {
      const ctx = global.serverCtx(ServerConnection.key(conn))

      return ctx?.sdk.connection.status() === "connected"
    }),
  )

  const connOf = (server: string) => global.servers.list().find((conn) => ServerConnection.key(conn) === server)

  const ctxOf = (server: string) => {
    const conn = connOf(server)

    return conn ? global.serverCtx(ServerConnection.key(conn)) : undefined
  }

  const recentQueries = useQueries(() => ({
    queries: connected().map((conn) => homeSessionsQuery(conn, ctxOf(ServerConnection.key(conn)))),
  }))

  const archivedQueries = useQueries(() => ({
    queries: connected().map((conn) => {
      const ctx = ctxOf(ServerConnection.key(conn))

      return {
        queryKey: ["sidebar-archived-sessions", ServerConnection.key(conn)] as const,
        enabled: view.show.archived && !!ctx,
        staleTime: 30_000,
        queryFn: async ({ signal }: { signal: AbortSignal }) =>
          (
            await ctx!.sdk.api.session.list(
              { limit: ARCHIVED_LIMIT, order: "desc", parentID: null, archived: true },
              { signal },
            )
          ).data,
      }
    }),
  }))

  const state = (): SidebarViewState => ({
    grouping: view.grouping,
    ordering: view.ordering,
    show: view.show,
    filters: local.filters,
    collapsed: view.collapsed,
  })

  // Status is the one per-row read that walks the whole session store, so only work it out when it changes the view.
  const needsStatus = () => view.ordering === "attention" || local.filters.status.length > 0

  const status = (ctx: ServerCtx | undefined, session: SessionInfo | undefined): SidebarStatus => {
    if (!ctx || !session || !needsStatus()) return "idle"

    return sessionStatus(ctx, session.id, {
      root: !session.parentID,
      autoApprove: settings.permissions.autoApproves(projectSettingsKey(ctx.sdk.scope, session.projectID)),
      snapshot: session,
    })
  }

  const sessionRowKey = (server: string, sessionID: string) => `${server}\u0000${sessionID}`

  const rows = createMemo<Row[]>(() => {
    const current = props.currentTab

    const isActive = (server: string, sessionID: string) =>
      current?.type === "session" && current.server === server && current.sessionId === sessionID

    const openRows = tabs.store.map((tab, order): Row => {
      const ctx = ctxOf(tab.server)

      if (tab.type === "draft") {
        return {
          key: tabKey(tab),
          server: tab.server,
          projectID: ctx?.projects.forDirectory(tab.directory)?.id,
          project: ctx?.projects.forDirectory(tab.directory),
          open: true,
          active: current === tab,
          parentKey: undefined,
          archived: false,
          status: "idle",
          updated: 0,
          created: 0,
          order,
          conn: connOf(tab.server),
          tab,
          session: undefined,
        }
      }

      const session = ctx?.data.session.get(tab.sessionId)

      const directory = session?.location.directory ?? tabs.info[tabKey(tab)]?.directory

      const project = session
        ? ctx?.projects.forSession(session)
        : directory
          ? ctx?.projects.forDirectory(directory)
          : undefined

      return {
        key: sessionRowKey(tab.server, tab.sessionId),
        server: tab.server,
        projectID: project?.id,
        project,
        open: true,
        active: isActive(tab.server, tab.sessionId),
        parentKey: undefined,
        archived: false,
        status: status(ctx, session),
        updated: session?.time.updated ?? 0,
        created: session?.time.created ?? 0,
        order,
        conn: connOf(tab.server),
        tab,
        session,
      }
    })

    const openKeys = new Set(openRows.map((row) => row.key))

    const sessionRows = connected().flatMap((conn, index) => {
      const server = ServerConnection.key(conn)

      const ctx = ctxOf(server)

      if (!ctx) return []
      const recent = recentQueries[index]?.data?.() ?? []

      const indexed = mergeSidebarSessions(recent, ctx.data.session.list(), (id) => activity.get(server, id))

      const archived = view.show.archived ? (archivedQueries[index]?.data ?? []) : []

      const children = view.show.subagents
        ? ctx.data.session.list().filter((session) => !!session.parentID && session.time.archived === undefined)
        : []

      const seen = new Set<string>()

      return [...indexed, ...archived, ...children].flatMap((session): Row[] => {
        const key = sessionRowKey(server, session.id)

        if (openKeys.has(key) || seen.has(key)) return []
        seen.add(key)
        const project = ctx.projects.forSession(session)

        return [
          {
            key,
            server,
            projectID: project?.id,
            project,
            open: false,
            active: isActive(server, session.id),
            parentKey: session.parentID ? sessionRowKey(server, session.parentID) : undefined,
            archived: session.time.archived !== undefined,
            status: status(ctx, session),
            updated: session.time.updated,
            created: session.time.created,
            order: 0,
            conn,
            tab: undefined,
            session,
          },
        ]
      })
    })

    return [...openRows, ...sessionRows]
  })

  const result = createMemo(() => sidebarView(rows(), state()))

  const visibleRows = () =>
    result()
      .groups.flatMap((group) => [group, ...(group.children ?? [])])
      .flatMap((group) => group.rows)

  // A project that spans servers takes its name and icon from the current server's copy when there is one.
  const projectLabels = createMemo(() => {
    const byID = new Map<string, Project>()

    global.servers.list().forEach((conn) => {
      ctxOf(ServerConnection.key(conn))
        ?.projects.list()
        .forEach((project) => {
          if (!byID.has(project.id) || servers.current(conn)) byID.set(project.id, project)
        })
    })

    return byID
  })

  const serverOptions = () =>
    global.servers.list().map((conn) => ({ key: `${ServerConnection.key(conn)}`, label: servers.label(conn) }))

  const projectOptions = () =>
    [...projectLabels().values()].map((project) => ({ id: project.id, label: displayName(project) }))

  const showLabel = (row: Row, group: SidebarGroup<Row> | undefined) => {
    if (!view.show.serverLabels || !row.conn) return

    if (group && group.kind !== "all" && !group.spansServers) return

    return servers.tag(row.conn)
  }

  const groupOf = (key: string) =>
    result()
      .groups.flatMap((group) => [group, ...(group.children ?? [])])
      .find((group) => group.rows.some((row) => row.key === key))

  // Every row whose top-level ancestor is an open tab renders under that tab; the rest render in the group's footer.
  const anchorOf = (row: Row, byKey: Map<string, Row>): Row => {
    const parent = row.parentKey ? byKey.get(row.parentKey) : undefined

    return parent ? anchorOf(parent, byKey) : row
  }

  const depthOf = (row: Row, byKey: Map<string, Row>): number => {
    const parent = row.parentKey ? byKey.get(row.parentKey) : undefined

    return parent ? depthOf(parent, byKey) + 1 : 0
  }

  const openSession = (row: Row) => {
    if (!row.conn || !row.session) return
    actions.openProjectSession(row.conn, row.project?.worktree ?? row.session.location.directory, row.session, {
      preview: true,
    })
  }

  const sessionRow = (row: Row, group: SidebarGroup<Row>, byKey: Map<string, Row>) => (
    <Show when={row.session && row.conn && { session: row.session, conn: row.conn }}>
      {(item) => (
        <ProjectSessionRow
          server={ServerConnection.key(item().conn)}
          session={item().session}
          openTab={false}
          active={row.active}
          label={showLabel(row, group)}
          depth={depthOf(row, byKey)}
          onOpen={() => openSession(row)}
        />
      )}
    </Show>
  )

  // A collapsed group keeps the current session visible below its header.
  const activeRecent = (group: SidebarGroup<Row>) => {
    const row = group.rows.find((item) => item.active && !item.open)

    if (!row) return

    return sessionRow(row, group, new Map([[row.key, row]]))
  }

  const leafSection = (group: SidebarGroup<Row>): TabStripSection => {
    const byKey = new Map(group.rows.map((row) => [row.key, row]))

    const footerRows = group.rows.filter((row) => !anchorOf(row, byKey).open)

    const topLevel = footerRows.filter((row) => anchorOf(row, byKey) === row)

    const limit = local.limits[group.key] ?? RECENT_STEP

    const shown = new Set(topLevel.slice(0, limit))

    return {
      key: group.key,
      tabs: group.rows.flatMap((row) => (row.open && row.tab && (!group.collapsed || row.active) ? [row.tab] : [])),
      header: group.kind === "all" ? undefined : <GroupHeader group={group} />,
      footer: group.collapsed ? (
        activeRecent(group)
      ) : (
        <>
          <For each={footerRows.filter((row) => shown.has(anchorOf(row, byKey)))}>
            {(row) => sessionRow(row, group, byKey)}
          </For>
          <Show when={topLevel.length > limit}>
            <Button
              variant="ghost-muted"
              size="small"
              class="ms-[23px] self-start"
              onClick={() => setLocal("limits", group.key, limit + RECENT_STEP)}
            >
              {language.t("sidebar.organize.showMore")}
            </Button>
          </Show>
        </>
      ),
    }
  }

  const sections = createMemo(() =>
    result().groups.flatMap((group): TabStripSection[] => {
      if (!group.children) return [leafSection(group)]

      // Server → Project keeps every row at one inset: the server reads as a section label above its projects.
      if (!group.collapsed)
        return [{ key: group.key, tabs: [], header: <GroupHeader group={group} /> }, ...group.children.map(leafSection)]

      const active = group.children.find((child) => child.rows.some((row) => row.active))

      return [
        {
          key: group.key,
          tabs: active ? active.rows.flatMap((row) => (row.active && row.open && row.tab ? [row.tab] : [])) : [],
          header: <GroupHeader group={group} />,
          footer: active ? activeRecent(active) : undefined,
        },
      ]
    }),
  )

  const tabFooter = (tab: Tab) => {
    if (tab.type !== "session") return
    const key = sessionRowKey(tab.server, tab.sessionId)

    const group = groupOf(key)

    if (!group) return

    const parent = result().groups.find((item) => item.children?.includes(group))

    if (group.collapsed || parent?.collapsed) return
    const byKey = new Map(group.rows.map((row) => [row.key, row]))

    const children = group.rows.filter((row) => row.key !== key && anchorOf(row, byKey).key === key)

    if (children.length === 0) return

    return <For each={children}>{(row) => sessionRow(row, group, byKey)}</For>
  }

  const tabLabel = (tab: Tab) => {
    const key = tab.type === "session" ? sessionRowKey(tab.server, tab.sessionId) : tabKey(tab)

    const row = rows().find((item) => item.key === key)

    return row ? showLabel(row, groupOf(key)) : undefined
  }

  function GroupHeader(headerProps: { group: SidebarGroup<Row> }) {
    const group = () => headerProps.group

    const section = () => !!group().children

    const project = () => (group().kind === "project" ? projectLabels().get(group().id) : undefined)

    const label = () => {
      if (group().kind === "server") {
        const conn = connOf(group().id)

        return conn ? servers.label(conn) : group().id
      }

      const value = project()

      return value ? displayName(value) : language.t("sidebar.view.other")
    }

    // A new session starts in the project on this group's server, or on the current server when it spans several.
    const newSession = () => {
      const value = project()

      if (!value) return

      const conn =
        (group().server && connOf(group().server!)) ||
        connected().find(
          (item) =>
            servers.current(item) &&
            ctxOf(ServerConnection.key(item))
              ?.projects.list()
              .some((p) => p.id === value.id),
        ) ||
        connected().find((item) =>
          ctxOf(ServerConnection.key(item))
            ?.projects.list()
            .some((p) => p.id === value.id),
        )

      if (conn)
        actions.openProjectNewSession(
          conn,
          ctxOf(ServerConnection.key(conn))
            ?.projects.list()
            .find((p) => p.id === value.id)?.worktree ?? value.worktree,
        )
    }

    return (
      <div
        class="group/sidebar-group relative flex min-w-0 shrink-0 items-center rounded-[6px] pe-1"
        classList={{
          "h-7 hover:bg-v2-overlay-simple-overlay-hover has-[:focus-visible]:bg-v2-overlay-simple-overlay-hover":
            !section(),
          "h-6 mt-2 first:mt-0": section(),
        }}
        data-sidebar-group={group().key}
      >
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-2 text-start leading-[var(--line-height-compact)] focus-visible:outline-none"
          classList={{
            "text-[13px] text-v2-text-text-muted [font-weight:440] group-hover/sidebar-group:text-v2-text-text-base focus-visible:text-v2-text-text-base":
              !section(),
            "text-[12px] font-medium text-v2-text-text-faint hover:text-v2-text-text-muted focus-visible:text-v2-text-text-muted":
              section(),
          }}
          aria-expanded={!group().collapsed}
          onClick={() => setView("collapsed", group().key, !view.collapsed[group().key])}
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            <Show
              when={project()}
              fallback={
                <Icon
                  name={group().kind === "server" ? "server" : "outline-dots"}
                  size="small"
                  class="text-v2-icon-icon-muted"
                />
              }
            >
              {(value) => <ProjectIcon project={value()} />}
            </Show>
          </span>
          <span class="min-w-0 flex-1 truncate" dir="auto">
            {label()}
          </span>
          <Show when={group().open > 0}>
            <span class="shrink-0 text-[11px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
              {group().open}
            </span>
          </Show>
        </button>
        <Show when={project()}>
          <span class="hover-reveal flex shrink-0 items-center group-hover/sidebar-group:opacity-100 focus-within:opacity-100">
            <IconButton
              icon={<Icon name="edit" />}
              variant="ghost-muted"
              size="small"
              aria-label={language.t("command.session.new")}
              onClick={newSession}
            />
          </span>
        </Show>
      </div>
    )
  }

  const toggleFilter = (kind: SidebarFilterKind, value: string, on: boolean) =>
    setLocal("filters", kind, (values: string[]) =>
      on ? [...new Set([...values, value])] : values.filter((item) => item !== value),
    )

  const markAllRead = () =>
    visibleRows()
      .filter((row) => row.session && row.status === "unread")
      .forEach((row) => ctxOf(row.server)?.notification.session.markViewed(row.session!.id))

  const anyUnread = () =>
    visibleRows().some(
      (row) => row.session && ctxOf(row.server)?.notification.session.unread(row.session.id, row.session),
    )

  const filterCount = () => local.filters.status.length + local.filters.server.length + local.filters.project.length

  return (
    <div class="flex min-h-0 flex-1 flex-col [app-region:no-drag]">
      <div class="flex h-7 shrink-0 items-center gap-1.5 ps-2 pe-1">
        <button
          type="button"
          class="flex min-w-0 items-center gap-1.5 text-[13px] leading-[var(--line-height-compact)] font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:outline-none"
          aria-expanded={local.open}
          onClick={() => setLocal("open", (value) => !value)}
        >
          <span class="truncate">{language.t("sidebar.view.sessions")}</span>
          <Icon
            name="fill-triangle-down"
            size="small"
            class="shrink-0 text-v2-icon-icon-muted transition-transform"
            classList={{ "-rotate-90 rtl:rotate-90": !local.open }}
          />
        </button>
        <div class="flex-1" />
        <SidebarViewMenu
          state={state()}
          servers={serverOptions()}
          projects={projectOptions()}
          canMarkRead={anyUnread()}
          onGrouping={(value) => setView("grouping", value)}
          onOrdering={(value) => setView("ordering", value)}
          onShow={(key, value) => setView("show", key, value)}
          onFilter={toggleFilter}
          onResetFilters={() => setLocal("filters", { status: [], server: [], project: [] })}
          onMarkRead={markAllRead}
        />
        <IconButton
          icon={<Icon name="plus" />}
          variant="ghost-muted"
          size="small"
          aria-label={language.t("command.session.new")}
          onClick={props.onNewSession}
        />
      </div>
      <SidebarFilterChips
        state={state()}
        servers={serverOptions()}
        projects={projectOptions()}
        onRemove={(kind, value) => toggleFilter(kind, value, false)}
      />
      <div class="flex min-h-0 flex-1 flex-col" classList={{ hidden: !local.open }}>
        {props.children({ sections: sections(), tabFooter, tabLabel })}
        <Show when={filterCount() > 0 && !visibleRows().some((row) => !row.active)}>
          <div class="px-2 py-2 text-12-regular text-v2-text-text-faint">
            {language.t("sidebar.view.noMatch")}{" "}
            <button
              type="button"
              class="underline hover:text-v2-text-text-base"
              onClick={() => setLocal("filters", { status: [], server: [], project: [] })}
            >
              {language.t("sidebar.view.resetFilters")}
            </button>
          </div>
        </Show>
      </div>
    </div>
  )
}
