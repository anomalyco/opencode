import { Schema } from "effect"
import { createEffect, createMemo, mapArray, Show } from "solid-js"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Icon } from "@opencode/ui/icon"
import { displayName } from "@opencode/ui/project-avatar"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useSettings } from "@/settings/model"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { tabKey, useTabs, type Tab } from "@/shell/tabs/tabs"
import { autoTabGroups, groupedTabOrder } from "./auto-tab-groups"
import type { TabStripSection } from "./tab-strip"

const CollapsedState = Persistence.struct({ collapsed: Persistence.record(Schema.Boolean) })

/**
 * The open tabs, grouped by project or server as Settings picks, for top and side tabs. Top tabs set groups apart with a
 * divider; side tabs give each group a header that collapses it. Each is undefined while tabs are not grouped.
 */
export function createAutoTabSections(input: {
  /** Tabs shown elsewhere (pinned), left out of every group. */
  hidden: (tab: Tab) => boolean
  currentTab: () => Tab | undefined
}) {
  const settings = useSettings()
  const global = useGlobal()
  const servers = useServers()
  const tabs = useTabs()

  // Only side tabs collapse.
  const [state, setState] = persisted(Persist.window("tabs.autoGroups"), CollapsedState, { collapsed: {} })

  const connOf = (server: string | undefined) =>
    global.servers.list().find((conn) => ServerConnection.key(conn) === server)

  const projectOf = (tab: Tab) => {
    const ctx = global.serverCtx(tab.server)

    if (tab.type === "draft") return ctx?.projects.forDirectory(tab.directory)
    const session = ctx?.data.session.get(tab.sessionId)

    if (session) return ctx?.projects.forSession(session)
    const directory = tabs.info[tabKey(tab)]?.directory

    return directory ? ctx?.projects.forDirectory(directory) : undefined
  }

  const items = createMemo(() =>
    tabs.store
      .filter((tab) => !input.hidden(tab))
      .map((tab) => ({ tab, server: tab.server, project: projectOf(tab)?.id })),
  )

  const group = (collapsed: Readonly<Record<string, boolean>>) =>
    autoTabGroups({
      grouping: settings.appearance.tabGrouping(),
      servers: global.servers.list().length,
      items: items(),
      collapsed,
      current: input.currentTab(),
    })

  const groups = createMemo(() => group(state.collapsed))

  const topGroups = createMemo(() => group({}))

  // Each group's tabs stay together in the saved order, so opening, closing and dragging tabs never reorders groups.
  createEffect(() => {
    const value = topGroups()

    if (!tabs.ready() || !value) return
    const order = tabs.store.map(tabKey)
    const next = groupedTabOrder(order, value)

    if (next.some((key, index) => key !== order[index])) tabs.reorder(next)
  })

  const groupByKey = createMemo(() => new Map(groups()?.map((group) => [group.key, group])))

  function GroupHeader(props: { groupKey: string }) {
    const group = () => groupByKey().get(props.groupKey)

    const project = () => {
      const value = group()

      if (!value?.project || !value.server) return

      return global
        .serverCtx(value.server)
        ?.projects.list()
        .find((item) => item.id === value.project)
    }

    const label = () => {
      const value = project()

      if (value) return displayName(value)
      const conn = connOf(group()?.server)

      return conn ? servers.label(conn) : (group()?.project ?? group()?.server)
    }

    // A collapsed group shows what its hidden tabs would: one working, or one waiting on the user or unread.
    const statuses = createMemo(
      mapArray(
        () => group()?.allTabs ?? [],
        (tab) =>
          tab.type === "session"
            ? useSessionTabAvatarState(
                () => tab.server,
                () => tab.sessionId,
                () => true,
              )
            : undefined,
      ),
    )

    const status = () => {
      const all = statuses().flatMap((value) => (value ? [value] : []))

      if (all.some((value) => value.loading())) return "busy"

      if (all.some((value) => value.attention())) return "attention"

      if (all.some((value) => value.unread())) return "unread"
    }

    const tag = () => {
      const conn = group()?.spansServers ? connOf(group()?.server) : undefined

      return conn ? servers.tag(conn) : undefined
    }

    return (
      <Show when={group()}>
        {(value) => (
          <button
            type="button"
            data-slot="auto-tab-group-header"
            class="group/auto-tab-group flex h-7 w-full min-w-0 shrink-0 cursor-default items-center gap-2 rounded-[6px] px-2 text-start text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted [font-weight:440] hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:text-v2-text-text-base [&:not(:first-child)]:mt-2"
            aria-expanded={!value().collapsed}
            onClick={() => setState("collapsed", props.groupKey, !value().collapsed)}
          >
            <span class="flex size-4 shrink-0 items-center justify-center">
              <Show when={project()} fallback={<Icon name="server" class="text-v2-icon-icon-muted" />}>
                {(item) => <ProjectIcon project={item()} />}
              </Show>
            </span>
            <span class="min-w-0 truncate" dir="auto">
              {label()}
            </span>
            <Show when={tag()}>
              {(text) => <span class="min-w-0 shrink-[2] truncate text-v2-text-text-faint">{text()}</span>}
            </Show>
            <Show when={value().collapsed ? status() : undefined}>
              {(mark) => (
                <Show when={mark() !== "busy"} fallback={<ActivityRing class="shrink-0" />}>
                  <span
                    aria-hidden="true"
                    class="size-1.5 shrink-0 rounded-full"
                    classList={{
                      "bg-v2-background-bg-accent": mark() === "unread",
                      "bg-v2-state-fg-warning": mark() === "attention",
                    }}
                  />
                </Show>
              )}
            </Show>
            <Icon
              name="fill-triangle-down"
              class="shrink-0 text-v2-icon-icon-muted opacity-0 transition-[transform,opacity] motion-reduce:transition-none group-hover/auto-tab-group:opacity-100 group-focus-visible/auto-tab-group:opacity-100 [@media(hover:none)]:opacity-100"
              classList={{ "-rotate-90 rtl:rotate-90": value().collapsed }}
            />
          </button>
        )}
      </Show>
    )
  }

  // Built once per group, so a header keeps its hover and focus while the group's tabs or collapsed state change.
  const headers = createMemo(
    mapArray(
      () => (groups() ?? []).flatMap((value) => (value.kind === "other" ? [] : [value.key])),
      (key) => [key, <GroupHeader groupKey={key} />] as const,
    ),
  )

  const headerByKey = createMemo(() => new Map(headers()))

  return {
    horizontal: createMemo(() =>
      topGroups()?.map((value, index): TabStripSection => ({ key: value.key, tabs: value.tabs, separator: index > 0 })),
    ),
    vertical: createMemo(() =>
      groups()?.map((value, index): TabStripSection => ({
        key: value.key,
        tabs: value.tabs,
        header: headerByKey().get(value.key),
        hideAvatars: value.kind === "project",
        separator: index > 0 && value.kind === "other",
      })),
    ),
  }
}
