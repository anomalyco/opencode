import { Button } from "@opencode/ui/button"
import { Menu } from "@opencode/ui/menu"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { InboxSessionCard, InboxSessionList, type InboxSectionSelection, type InboxSelectionControls } from "./inbox"
import type { InboxStatus } from "./inbox-model"
import {
  INITIAL_INBOX_SELECTION_STATE,
  selectInboxAllSelected,
  selectInboxIsSelected,
  selectInboxSelectedCount,
  selectInboxSelectedKeys,
  selectInboxSelecting,
  transitionInboxSelection,
  type InboxSelectionEvent,
} from "./inbox-selection-machine"
import { useLanguage } from "@/runtime/i18n/language"

const now = Date.UTC(2026, 10, 3, 12)

const titles = [
  "Tooltip status on latest dev",
  "Cross-platform synchronization",
  "User feedback analysis",
  "Add button component",
  "Investigate synchronization across distributed sessions and remote worktrees",
  "Review keyboard navigation",
]

function SessionListStory(props: {
  currentCount: number
  needsCount: number
  unreadCount: number
  recentCount: number
  workingCount: number
  archived: boolean
  workingExpanded: boolean
  selectedSession: string
  width: number
  height: number
  currentArchived: boolean
  neverRun: boolean
  loading: boolean
  announcement: string
  recentExpanded: boolean
}) {
  const language = useLanguage()

  const [state, setState] = createStore<{
    selected: string
    expanded: boolean
    archived: boolean
    removed: string[]
    readOverride: Record<string, "read" | "unread" | undefined>
    action: string
    recentExpanded: boolean
  }>({
    selected: props.selectedSession,
    expanded: props.workingExpanded,
    archived: props.archived,
    removed: [],
    readOverride: {},
    action: "",
    recentExpanded: props.recentExpanded,
  })

  const [selection, setSelection] = createSignal(INITIAL_INBOX_SELECTION_STATE)

  const dispatchSelection = (event: InboxSelectionEvent) =>
    setSelection((previous) => transitionInboxSelection(previous, event))

  createEffect(() => setState("selected", props.selectedSession))
  createEffect(() => setState("expanded", props.workingExpanded))
  createEffect(() => setState("archived", props.archived))
  createEffect(() => setState("recentExpanded", props.recentExpanded))

  const sessions = (section: "current" | "needs" | "unread" | "recent" | "working", count: number) =>
    Array.from({ length: count }, (_, index) => {
      const id = `${section}-${index}`
      const override = state.readOverride[id]

      const status = (): InboxStatus => {
        if (override === "read") return "ready"

        if (override === "unread") return "done"

        if (section === "current") return "ready"

        if (section === "working") return "working"

        if (section === "needs") return index % 2 === 0 ? "approval" : "input"

        if (section === "unread") return index % 2 === 0 ? "done" : "failed"

        return "ready"
      }

      return {
        id,
        index,
        status: status(),
        title:
          props.neverRun && section === "recent" && index === 0
            ? "New session — never run"
            : (titles[index % titles.length] ?? ""),
      }
    }).filter((session) => !state.removed.includes(session.id))

  const current = createMemo(() => sessions("current", props.currentCount))

  const needs = createMemo(() => sessions("needs", props.needsCount))

  const allUnreadAndRecent = createMemo(() => [
    ...sessions("unread", props.unreadCount),
    ...sessions("recent", props.recentCount),
  ])

  const unread = createMemo(() =>
    allUnreadAndRecent().filter((session) => session.status === "done" || session.status === "failed"),
  )

  const recent = createMemo(() => allUnreadAndRecent().filter((session) => session.status === "ready"))

  const visibleRecent = createMemo(() => (state.recentExpanded ? recent() : recent().slice(0, 10)))

  const working = createMemo(() => sessions("working", props.workingCount))

  const visibleItems = createMemo(() => [
    ...current(),
    ...needs(),
    ...unread(),
    ...visibleRecent(),
    ...(state.expanded ? working() : []),
  ])

  const visibleKeys = createMemo(() => visibleItems().map((item) => item.id))

  createEffect(() => {
    dispatchSelection({ type: "sync.visible", visible: new Set(visibleKeys()) })
  })

  const selectedItems = createMemo(() => {
    const keys = selectInboxSelectedKeys(selection())

    return visibleItems().filter((item) => keys.has(item.id))
  })

  const remove = (id: string, action: string) => {
    setState("removed", (removed) => [...removed, id])
    setState("action", action)
  }

  const removeMany = (ids: string[], action: string) => {
    setState("removed", (removed) => [...removed, ...ids])
    setState("action", action)
    dispatchSelection({ type: "clear" })
  }

  const markReadSelected = () => {
    const targets = selectedItems().filter((item) => item.status === "done" || item.status === "failed")

    targets.forEach((item) => setState("readOverride", item.id, "read"))
    setState("action", `Marked ${targets.length} as read`)
    dispatchSelection({ type: "clear" })
  }

  const markUnreadSelected = () => {
    const targets = selectedItems().filter((item) => item.status === "ready")

    targets.forEach((item) => setState("readOverride", item.id, "unread"))
    setState("action", `Marked ${targets.length} as unread`)
    dispatchSelection({ type: "clear" })
  }

  const archiveSelected = () => {
    const ids = selectedItems().map((item) => item.id)

    removeMany(ids, `Archived ${ids.length} sessions`)
    setState("archived", true)
  }

  const deleteSelected = () => {
    const ids = selectedItems().map((item) => item.id)

    removeMany(ids, `Deleted ${ids.length} sessions`)
  }

  const canMarkRead = () => selectedItems().some((item) => item.status === "done" || item.status === "failed")

  const canMarkUnread = () => selectedItems().some((item) => item.status === "ready")

  const bulkMenu = () => (
    <>
      <Show when={canMarkRead()}>
        <Menu.Item onSelect={markReadSelected}>{language.t("session.markRead")}</Menu.Item>
      </Show>
      <Show when={canMarkUnread()}>
        <Menu.Item onSelect={markUnreadSelected}>{language.t("session.markUnread")}</Menu.Item>
      </Show>
      <Menu.Item onSelect={archiveSelected}>{language.t("common.archive")}</Menu.Item>
      <Menu.Separator />
      <Menu.Item onSelect={deleteSelected}>{language.t("common.delete")}…</Menu.Item>
    </>
  )

  const sectionSelection = (keys: () => string[]): InboxSectionSelection => ({
    get allSelected() {
      return selectInboxAllSelected(selection(), keys())
    },
    get selecting() {
      return selectInboxSelecting(selection())
    },
    onToggleAll: () => dispatchSelection({ type: "section.toggle", keys: keys() }),
  })

  const selectionControls: InboxSelectionControls = {
    get count() {
      return selectInboxSelectedCount(selection())
    },
    get total() {
      return visibleKeys().length
    },
    get canMarkRead() {
      return canMarkRead()
    },
    get canMarkUnread() {
      return canMarkUnread()
    },
    get canArchive() {
      return selectedItems().length > 0
    },
    get canDelete() {
      return selectedItems().length > 0
    },
    onToggle: (key) => dispatchSelection({ type: "toggle", key }),
    onRange: (target, fallbackAnchor, additive) =>
      dispatchSelection({
        type: "range",
        target,
        ordered: visibleKeys(),
        fallbackAnchor: fallbackAnchor ?? state.selected,
        additive,
      }),
    onSelectAll: () => dispatchSelection({ type: "select.all", ordered: visibleKeys() }),
    onToggleAll: () => {
      if (selectInboxAllSelected(selection(), visibleKeys())) {
        dispatchSelection({ type: "clear" })

        return
      }

      dispatchSelection({ type: "select.all", ordered: visibleKeys() })
    },
    onMarkRead: markReadSelected,
    onMarkUnread: markUnreadSelected,
    onArchive: archiveSelected,
    onDelete: deleteSelected,
    onClear: () => dispatchSelection({ type: "clear" }),
  }

  const rows = (list: typeof recent) => (
    <For each={list()}>
      {(session) => (
        <InboxSessionCard
          itemKey={session.id}
          project={{
            id: session.index % 3 === 2 ? "lab-port-ui" : "lab-opencode",
            name: session.index % 3 === 2 ? "port-ui" : "opencode",
            worktree: "/workspace/opencode",
            icon: { color: session.index % 3 === 2 ? "purple" : "blue" },
          }}
          directory={session.index % 2 === 0 ? "/workspace/opencode/worktrees/tooltip-status" : "/workspace/opencode"}
          title={session.title}
          status={session.status}
          selected={state.selected === session.id}
          checked={selectInboxIsSelected(selection(), session.id)}
          selecting={selectInboxSelecting(selection())}
          archived={props.currentArchived && session.id.startsWith("current-")}
          server={session.index % 3 === 2 ? "Build server · build.example.internal" : undefined}
          branch={session.index % 4 === 3 ? undefined : "dev"}
          worktree={session.index % 2 === 0}
          now={now}
          since={now - (session.index + 1) * 7 * 60_000}
          onSelectClick={(action) => {
            if (action.kind === "range") {
              dispatchSelection({
                type: "range",
                target: session.id,
                ordered: visibleKeys(),
                fallbackAnchor: state.selected,
                additive: action.additive,
              })

              return
            }

            dispatchSelection({ type: "toggle", key: session.id })
          }}
          bulkMenu={selectInboxSelectedCount(selection()) > 1 ? bulkMenu : undefined}
          onOpen={() => {
            dispatchSelection({ type: "clear" })
            setState("selected", session.id)
          }}
          onArchive={() => {
            remove(session.id, `Archived ${session.title}`)
            setState("archived", true)
          }}
          onUnarchive={() => setState("action", `Unarchived ${session.title}`)}
          onDelete={() => remove(session.id, `Deleted ${session.title}`)}
        />
      )}
    </For>
  )

  const sections = [
    {
      id: "needs",
      get label() {
        return language.t("sidebar.inbox.section.needsAttention")
      },
      get count() {
        return needs().length
      },
      selection: sectionSelection(() => needs().map((item) => item.id)),
      rows: () => rows(needs),
    },
    {
      id: "unread",
      get label() {
        return language.t("sidebar.inbox.section.unread")
      },
      get count() {
        return unread().length
      },
      selection: sectionSelection(() => unread().map((item) => item.id)),
      rows: () => rows(unread),
    },
    {
      id: "recent",
      get label() {
        return language.t("sidebar.inbox.section.recent")
      },
      get count() {
        return visibleRecent().length
      },
      selection: sectionSelection(() => visibleRecent().map((item) => item.id)),
      rows: () => rows(visibleRecent),
      more: () => (
        <Show when={recent().length > 10}>
          <Button
            variant="ghost-muted"
            size="normal"
            class="w-full justify-start px-2"
            aria-expanded={state.recentExpanded}
            onClick={() => setState("recentExpanded", !state.recentExpanded)}
          >
            {language.t(state.recentExpanded ? "sidebar.inbox.showLess" : "sidebar.inbox.showMore")}
          </Button>
        </Show>
      ),
    },
  ]

  return (
    <div class="flex flex-col gap-3">
      <div
        class="flex min-h-0 flex-col overflow-hidden rounded-[6px] bg-v2-background-bg-deep py-2 ps-[11px] pe-[3px]"
        style={{ width: `${props.width}px`, height: `${props.height}px` }}
      >
        <InboxSessionList
          loading={props.loading}
          announcement={props.announcement}
          selection={selectionControls}
          current={{
            get count() {
              return current().length
            },
            rows: () => rows(current),
          }}
          sections={sections}
          archived={state.archived}
          working={{
            get count() {
              return working().length
            },
            rows: () => rows(working),
            get expanded() {
              return state.expanded
            },
            onToggle: () => setState("expanded", !state.expanded),
            selection: sectionSelection(() => working().map((item) => item.id)),
          }}
          onArchived={() => setState("action", "Archived sessions requested (local story only)")}
        />
      </div>
      <div class="flex items-center gap-3 text-[12px] leading-4 text-v2-text-text-muted">
        <Button
          variant="ghost-muted"
          size="small"
          onClick={() => {
            dispatchSelection({ type: "clear" })
            setState({
              selected: props.selectedSession,
              expanded: props.workingExpanded,
              archived: props.archived,
              removed: [],
              readOverride: {},
              action: "",
              recentExpanded: props.recentExpanded,
            })
          }}
        >
          Reset list
        </Button>
        <span aria-live="polite">{state.action}</span>
      </div>
      <span class="max-w-[360px] text-[12px] leading-4 text-v2-text-text-muted">
        Click to select; right-click to archive or delete. Working collapses. All actions stay local to this story.
      </span>
    </div>
  )
}

export default {
  title: "App/Inbox/Session lists",
  id: "app-inbox-session-lists",
  render: SessionListStory,
  args: {
    currentCount: 0,
    needsCount: 2,
    unreadCount: 2,
    recentCount: 6,
    workingCount: 2,
    archived: true,
    workingExpanded: true,
    selectedSession: "recent-1",
    width: 280,
    height: 640,
    currentArchived: false,
    neverRun: false,
    loading: false,
    announcement: "",
    recentExpanded: false,
  },
  argTypes: {
    currentCount: { control: { type: "range", min: 0, max: 1, step: 1 } },
    needsCount: { control: { type: "range", min: 0, max: 12, step: 1 } },
    unreadCount: { control: { type: "range", min: 0, max: 20, step: 1 } },
    recentCount: { control: { type: "range", min: 0, max: 20, step: 1 } },
    workingCount: { control: { type: "range", min: 0, max: 12, step: 1 } },
    selectedSession: {
      control: "select",
      options: ["current-0", "recent-1", "recent-0", "needs-0", "working-0", "unread-0", "none"],
    },
    width: { control: { type: "range", min: 136, max: 640, step: 8 } },
    height: { control: { type: "range", min: 240, max: 900, step: 20 } },
  },
  parameters: {
    docs: {
      description: {
        component:
          "The production inbox list and cards with local fixtures. Click to select, collapse Working, right-click to archive or delete, and reset without touching real sessions. Archived records an action rather than opening the live search dialog.",
      },
    },
  },
}

export const Mixed = {}

export const CurrentSession = { args: { currentCount: 1, selectedSession: "current-0" } }

export const CurrentOnly = {
  args: {
    currentCount: 1,
    needsCount: 0,
    unreadCount: 0,
    recentCount: 0,
    workingCount: 0,
    selectedSession: "current-0",
    archived: false,
  },
}

export const RecentOnly = { args: { needsCount: 0, unreadCount: 0, workingCount: 0 } }

export const NeedsAttention = {
  args: { needsCount: 4, unreadCount: 0, recentCount: 0, workingCount: 0, archived: false },
}

export const WorkingOnly = {
  args: {
    needsCount: 0,
    unreadCount: 0,
    recentCount: 0,
    workingCount: 3,
    selectedSession: "working-0",
    archived: false,
  },
}

export const WorkingCollapsed = { args: { workingExpanded: false, selectedSession: "working-0" } }

export const Empty = { args: { needsCount: 0, unreadCount: 0, recentCount: 0, workingCount: 0, archived: false } }

export const ManyUnread = { args: { unreadCount: 14 } }

export const NeverRun = { args: { neverRun: true } }

export const CurrentPastLimit = { args: { currentCount: 1, recentCount: 10, selectedSession: "current-0" } }

export const ArchivedCurrent = { args: { currentCount: 1, currentArchived: true, selectedSession: "current-0" } }

export const MoreRecent = { args: { recentCount: 16 } }

export const Dense = { args: { needsCount: 4, recentCount: 10, workingCount: 5 } }

export const Narrow = { args: { width: 136 } }

export const ShortSidebar = { args: { height: 360 } }

export const Loading = { args: { loading: true } }

export const RecentExpanded = { args: { recentCount: 16, recentExpanded: true } }

export const ArchivedOnly = { args: { needsCount: 0, unreadCount: 0, recentCount: 0, workingCount: 0 } }
