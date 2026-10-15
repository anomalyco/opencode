import { isSessionNotFoundError, type SessionInfo } from "@opencode/client/promise"
import { useQueries, useQueryClient } from "@tanstack/solid-query"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { createStore } from "solid-js/store"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, startTransition, type JSX } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { displayName } from "@opencode/ui/project-avatar"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useSettings } from "@/settings/model"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { sessionBusy, sessionRequests } from "@/shell/layout/project-avatar-state"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { pathKey } from "@/workspaces/path-key"
import { sessionTabTitle } from "./tab-title"
import { loadHomeSessionIndex, mergeHomeSessionIndex } from "@/home/sessions/index"

// Keep the immutable result opaque so Solid Query does not recursively unwrap every session.
const selectSessions = (sessions: SessionInfo[]) => () => sessions

// Branch lookups each run git on the server, so load them a few at a time.
const BRANCH_BATCH = 4

// `since` is when the inbox was first used; Recent only lists sessions that finished a run after it.
const InboxState = Persistence.struct({
  workingExpanded: Schema.Boolean,
  since: Persistence.optional(Schema.Number),
})

type InboxStatus = "approval" | "input" | "working" | "failed" | "done" | "ready"

type InboxEntry = {
  key: string
  conn: ServerConnection.Any
  server: ServerConnection.Key
  ctx: ReturnType<ReturnType<typeof useGlobal>["ensureServerCtx"]>
  session: SessionInfo
  status: InboxStatus
}

export function SidebarInbox() {
  const global = useGlobal()
  const servers = useServers()
  const settings = useSettings()
  const layout = useLayout()
  const tabs = useTabs()
  const language = useLanguage()

  const [state, setState, , ready] = persisted(Persist.global("sidebar.inbox"), InboxState, {
    workingExpanded: true,
  })

  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))

  const queryClient = useQueryClient()
  const connections = createMemo(() => servers.visible.map((conn) => ({ conn, ctx: global.ensureServerCtx(conn) })))

  // The inbox stays mounted and rarely refetches the index, so drop sessions the server no longer has.
  const forget = (conn: ServerConnection.Any, sessionID: string) =>
    queryClient.setQueryData<SessionInfo[]>(["home-sessions", conn], (current) =>
      current?.filter((session) => session.id !== sessionID),
    )

  createEffect(() => {
    connections().forEach((item) => {
      onCleanup(item.ctx.data.on("session.deleted", (event) => forget(item.conn, event.data.sessionID)))
    })
  })

  // Shares the Home query cache so renames and deletions there refresh the inbox too.
  const queries = useQueries(() => ({
    queries: connections().map((item) => ({
      queryKey: ["home-sessions", item.conn] as const,
      enabled: item.ctx.sdk.connection.status() === "connected",
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        loadHomeSessionIndex((input, options) => item.ctx.sdk.api.session.list(input, options), signal),
      retry: false,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      select: selectSessions,
    })),
  }))

  const entries = createMemo(() =>
    connections()
      .flatMap((item, index) => {
        const data = item.ctx.data
        const notification = item.ctx.notification.session
        const server = ServerConnection.key(item.conn)

        // A root session counts as working while any session in its family is busy.
        const busyRoots = new Set(
          [...data.session.list().map((session) => session.id), ...data.session.active()]
            .filter((id) => sessionBusy(data, id))
            .map((id) => data.session.root(id)),
        )

        const status = (id: string): InboxStatus => {
          const requests = sessionRequests(data, id, true, settings.permissions.autoApprove())

          if (requests.permission) return "approval"

          if (requests.form) return "input"

          if (busyRoots.has(id)) return "working"

          if (notification.unseenHasError(id)) return "failed"

          if (notification.unseenCount(id) > 0) return "done"

          return "ready"
        }

        return data.session.apply(mergeHomeSessionIndex(queries[index]?.data?.() ?? [], data.session.list())).map(
          (session): InboxEntry => ({
            key: `${server}\0${session.id}`,
            conn: item.conn,
            server,
            ctx: item.ctx,
            session,
            status: status(session.id),
          }),
        )
      })
      .toSorted((a, b) => b.session.time.updated - a.session.time.updated),
  )

  const sections = createMemo(() => {
    const list = entries()

    return {
      needs: list.filter((entry) => entry.status === "approval" || entry.status === "input"),
      // The most recently finished session comes first.
      inbox: list
        .filter((entry) => {
          const since = state.since

          return !busy(entry.status) && since !== undefined && (entry.session.time.idle ?? 0) >= since
        })
        .toSorted((a, b) => (b.session.time.idle ?? 0) - (a.session.time.idle ?? 0)),
      working: list.filter((entry) => entry.status === "working"),
    }
  })

  // The client only refreshes `time.idle` for loaded sessions when a run ends, so load every working one.
  createEffect(() => {
    sections().working.forEach((entry) => {
      if (entry.ctx.data.session.get(entry.session.id)) return
      void entry.ctx.data.session.sync(entry.session.id).catch(() => undefined)
    })
  })

  // The inbox starts empty and fills as sessions finish runs.
  createEffect(() => {
    if (ready() && state.since === undefined) setState("since", Date.now())
  })

  // Rows are keyed by stable strings so live session updates do not remount them.
  const byKey = createMemo(() => new Map(entries().map((entry) => [entry.key, entry])))

  const active = createMemo(() => {
    const route = layout.route()

    if (route.type !== "session") return

    return { server: route.server, sessionId: route.sessionId }
  })

  const selected = (entry: InboxEntry) => {
    const current = active()

    return (
      current?.server === entry.server &&
      (current.sessionId === entry.session.id || entry.ctx.data.session.root(current.sessionId) === entry.session.id)
    )
  }

  // Git info is not stored on the session, so eagerly load it for every shown row and mark each location
  // settled once its load ends.
  const [vcs, setVcs] = createStore({ settled: {} as Record<string, true> })
  const queued = new Set<string>()
  const queue: InboxEntry[] = []
  let draining = false

  const drain = async () => {
    if (draining) return
    draining = true

    while (queue.length) {
      await Promise.all(
        queue.splice(0, BRANCH_BATCH).map((entry) =>
          entry.ctx.data.location.vcs
            .sync(entry.session.location)
            .catch(() => undefined)
            .then(() => setVcs("settled", locationKey(entry), true)),
        ),
      )
    }

    draining = false
  }

  createEffect(() => {
    const visible = sections()

    ;[...visible.needs, ...visible.working, ...visible.inbox].forEach((entry) => {
      const key = locationKey(entry)

      if (queued.has(key)) return
      queued.add(key)
      queue.push(entry)
    })
    void drain()
  })

  const branchLoading = (entry: InboxEntry) =>
    !vcs.settled[locationKey(entry)] && !entry.ctx.data.location.vcs.info(entry.session.location)

  const open = (entry: InboxEntry) => {
    const directory = entry.ctx.projects.forSession(entry.session)?.worktree ?? entry.session.location.directory
    void entry.ctx.data.session.message.sync(entry.session.id).catch((error: unknown) => {
      if (isSessionNotFoundError(error)) forget(entry.conn, entry.session.id)
    })
    void startTransition(() => {
      tabs.select(tabs.addSessionTab({ server: entry.server, sessionId: entry.session.id }))
      entry.ctx.data.session.remember(entry.session)
      entry.ctx.projects.open(directory)
      entry.ctx.projects.touch(directory)
    })
  }

  const rows = (list: InboxEntry[]) => (
    <For each={list.map((entry) => entry.key)}>
      {(key) => (
        <Show when={byKey().get(key)}>
          {(entry) => (
            <InboxRow
              entry={entry()}
              selected={selected(entry())}
              now={now()}
              branchLoading={branchLoading(entry())}
              onOpen={() => open(entry())}
            />
          )}
        </Show>
      )}
    </For>
  )

  return (
    <div data-slot="sidebar-inbox" class="flex min-h-0 flex-1 flex-col">
      <div data-slot="sidebar-inbox-scroll" class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-1">
        <Show when={sections().needs.length > 0}>
          <div class="flex shrink-0 flex-col gap-px pb-3">
            <SectionHeader label={language.t("sidebar.inbox.section.needsAttention")} count={sections().needs.length} />
            {rows(sections().needs)}
          </div>
        </Show>
        <Show
          when={sections().inbox.length > 0}
          fallback={
            <Show when={sections().needs.length === 0 && sections().working.length === 0}>
              <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
                {language.t("sidebar.inbox.empty")}
              </div>
            </Show>
          }
        >
          <Show when={sections().needs.length > 0}>
            <SectionHeader label={language.t("sidebar.inbox.section.recent")} />
          </Show>
          {rows(sections().inbox)}
        </Show>
      </div>
      {/* Working sessions sit in a shelf pinned below the scrolling list. */}
      <Show when={sections().working.length > 0}>
        <div
          data-slot="sidebar-inbox-working"
          class="flex max-h-[40%] shrink-0 flex-col gap-px border-t border-v2-border-border-muted pt-1.5"
        >
          <SectionHeader
            label={language.t("sidebar.inbox.section.working")}
            count={sections().working.length}
            expanded={state.workingExpanded}
            onToggle={() => setState("workingExpanded", !state.workingExpanded)}
          />
          <div class="flex min-h-0 flex-col gap-px overflow-y-auto">
            {/* A collapsed shelf still shows the session that is open. */}
            {rows(sections().working.filter((entry) => state.workingExpanded || selected(entry)))}
          </div>
        </div>
      </Show>
    </div>
  )
}

function SectionHeader(props: { label: string; count?: number; expanded?: boolean; onToggle?: () => void }) {
  const content = (): JSX.Element => (
    <>
      <span class="min-w-0 truncate">{props.label}</span>
      <Show when={props.count}>
        <span class="shrink-0 tabular-nums text-v2-text-text-faint">{props.count}</span>
      </Show>
      <Show when={props.onToggle}>
        <Icon
          name="chevron-down"
          size="small"
          class="ms-auto shrink-0 transition-transform"
          classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
        />
      </Show>
    </>
  )

  return (
    <Show
      when={props.onToggle}
      fallback={
        <div class="flex h-6 shrink-0 items-center gap-1.5 px-1.5 text-[12px] leading-4 font-medium text-v2-text-text-muted">
          {content()}
        </div>
      }
    >
      {(toggle) => (
        <button
          type="button"
          aria-expanded={props.expanded}
          class="flex h-6 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-start text-[12px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          onClick={toggle()}
        >
          {content()}
        </button>
      )}
    </Show>
  )
}

function InboxRow(props: {
  entry: InboxEntry
  selected: boolean
  now: number
  branchLoading: boolean
  onOpen: () => void
}) {
  const language = useLanguage()
  const project = createMemo(() => props.entry.ctx.projects.forSession(props.entry.session))
  const status = () => props.entry.status
  const unread = () => status() !== "ready" && status() !== "working"

  const worktree = () => inWorktree(props.entry)

  const branch = () => props.entry.ctx.data.location.vcs.info(props.entry.session.location)?.branch.current ?? undefined

  // Only sessions on a remote server are marked.
  const remote = () => !props.entry.ctx.isLocal

  const compact = (seconds: number) => {
    if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

    if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

    return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
  }

  const elapsed = () => {
    // `time.updated` moves when a prompt is enqueued, so it marks when the current run was requested.
    const seconds = Math.max(0, Math.floor((props.now - props.entry.session.time.updated) / 1000))

    return seconds < 60 ? language.plural("sidebar.inbox.elapsed.seconds", seconds) : compact(seconds)
  }

  const age = () => {
    const seconds = Math.max(
      0,
      Math.floor((props.now - (props.entry.session.time.idle ?? props.entry.session.time.updated)) / 1000),
    )

    return seconds < 60 ? language.t("sidebar.inbox.time.now") : compact(seconds)
  }

  return (
    <button
      type="button"
      data-slot="sidebar-inbox-item"
      data-status={status()}
      data-state={props.selected ? "active" : undefined}
      class="group flex w-full shrink-0 flex-col gap-0.5 rounded-[6px] px-1.5 py-1.5 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-background-bg-layer-02"
      classList={{
        "opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100":
          status() === "working" && !props.selected,
      }}
      onClick={props.onOpen}
    >
      <span class="flex h-4 w-full min-w-0 items-center gap-1.5 text-[12px] leading-4 text-v2-text-text-faint">
        <span class="flex size-4 shrink-0 items-center justify-center">
          <SessionTabAvatarView project={project()} directory={props.entry.session.location.directory} unread={false} />
        </span>
        <span class="min-w-0 truncate">
          {displayName(project() ?? { worktree: props.entry.session.location.directory })}
        </span>
        <span class="ms-auto shrink-0 tabular-nums" role={status() === "ready" ? undefined : "status"}>
          <Show when={status() !== "ready"} fallback={age()}>
            <span
              classList={{
                "text-v2-state-fg-warning": status() === "approval" || status() === "input",
                "text-v2-state-fg-info": status() === "working",
                "text-v2-state-fg-danger": status() === "failed",
                "text-v2-state-fg-success": status() === "done",
              }}
            >
              <Show
                when={status() === "working"}
                fallback={language.t(`sidebar.inbox.status.${status() as Exclude<InboxStatus, "ready">}`)}
              >
                {/* Announce only the status: the ticking duration would be re-read every second. */}
                <span class="sr-only">{language.t("sidebar.inbox.status.working")}</span>
                {/* Keep the status colour under the sweep. */}
                <span
                  aria-hidden="true"
                  class="[&_[data-component=text-shimmer]]:[--text-shimmer-base-color:var(--v2-state-fg-info)]"
                >
                  <TextShimmer text={language.t("sidebar.inbox.status.workingFor", { duration: elapsed() })} active />
                </span>
              </Show>
            </span>
          </Show>
        </span>
      </span>
      <span
        dir="auto"
        class="w-full min-w-0 truncate text-[13px] leading-4"
        // Rows recede once read so unread results stand out.
        classList={{
          "font-medium text-v2-text-text-base": unread(),
          "text-v2-text-text-muted": !unread(),
        }}
      >
        {sessionTabTitle(props.entry.session.title, language.t("session.tab.session"))}
      </span>
      <Show when={props.branchLoading || branch() || worktree() || remote()}>
        <span class="flex h-4 w-full min-w-0 items-center gap-1 text-[12px] leading-4 text-v2-text-text-faint">
          <Show when={props.branchLoading}>
            <span
              aria-hidden="true"
              class="h-2.5 w-24 max-w-full animate-pulse rounded-full bg-v2-background-bg-layer-03"
            />
          </Show>
          <Show when={!props.branchLoading && (branch() || worktree())}>
            <span class="flex min-w-0 items-center gap-1">
              {/* The worktree icon stands in for the branch icon to mark sessions outside the project checkout. */}
              <Icon name={worktree() ? "outline-worktree" : "branch"} size="small" class="shrink-0" />
              <Show when={branch()}>
                {(name) => (
                  <span dir="ltr" class="min-w-0 truncate">
                    {name()}
                  </span>
                )}
              </Show>
            </span>
          </Show>
          <Show when={remote()}>
            <Tooltip placement="right" value={serverName(props.entry.conn)} class="ms-auto flex shrink-0">
              <Icon name="server" size="small" aria-label={serverName(props.entry.conn)} />
            </Tooltip>
          </Show>
        </span>
      </Show>
    </button>
  )
}

function busy(status: InboxStatus) {
  return status === "working" || status === "approval" || status === "input"
}

function locationKey(entry: InboxEntry) {
  return `${entry.server}\0${pathKey(entry.session.location.directory)}`
}

function inWorktree(entry: InboxEntry) {
  const root = entry.ctx.projects.forSession(entry.session)?.worktree

  return !!root && pathKey(root) !== pathKey(entry.session.location.directory)
}
