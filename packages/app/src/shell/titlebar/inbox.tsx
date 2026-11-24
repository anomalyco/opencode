import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  on,
  Show,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createElementSize } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { Loader } from "@opencode/ui/loader"
import { displayName } from "@opencode/ui/project-avatar"
import { useServers } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import type { LocalProject } from "@/shell/state/layout"
import { sessionTabTitle } from "./tab-title"
import { sessionLabel, sessionTitle } from "@/session/title"
import { createSessionExporter } from "@/session/commands/export-session"
import { SessionReadMenuItem } from "@/session/session-read-menu-item"
import { RenameDialog } from "./project-session-row"
import {
  createSessionInbox,
  inboxArchived,
  inboxCanMarkRead,
  inboxCanMarkUnread,
  type InboxEntry,
  type InboxStatus,
} from "./inbox-model"
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
import { compareWorking, workingSince } from "./inbox-working"
import { useGlobal } from "@/runtime/server/runtime"
import { useLayout } from "@/shell/state/layout"
import { findSessionTab, tabKey, useTabs, type DraftTab } from "@/shell/tabs/tabs"
import { createDraftComposerState } from "@/composer/state"
import { isAttachment } from "@/composer/prompt-parts"
import "./inbox.css"

const RECENT_LIMIT = 10

const InboxState = Persistence.struct({
  workingExpanded: Schema.Boolean,
  recentExpanded: Schema.Boolean,
})

const InboxNavigation = createContext<Accessor<string | undefined>>()

export type InboxSelectClick = {
  readonly kind: "toggle" | "range"
  readonly additive: boolean
}

export type InboxSectionSelection = {
  readonly allSelected: boolean
  readonly selecting: boolean
  readonly onToggleAll: () => void
}

export type InboxSelectionControls = {
  readonly count: number
  readonly total: number
  readonly canMarkRead?: boolean
  readonly canMarkUnread?: boolean
  readonly canArchive?: boolean
  readonly canUnarchive?: boolean
  readonly canDiscardDrafts?: boolean
  readonly draftCount?: number
  readonly canDelete?: boolean
  readonly onToggle: (key: string) => void
  readonly onRange: (target: string, fallbackAnchor?: string, additive?: boolean) => void
  readonly onSelectAll: () => void
  readonly onToggleAll: () => void
  readonly onMarkRead?: () => void
  readonly onMarkUnread?: () => void
  readonly onArchive?: () => void
  readonly onUnarchive?: () => void
  readonly onDiscardDrafts?: () => void
  readonly onDelete?: () => void
  readonly onClear: () => void
}

/** The experimental Inbox interface mode: the session inbox in place of vertical tabs. */
export function SidebarInbox() {
  const language = useLanguage()
  const dialog = useDialog()
  const servers = useServers()
  const inbox = createSessionInbox({ archived: true })
  const tabs = useTabs()
  const layout = useLayout()
  const global = useGlobal()

  const exporter = createSessionExporter()

  const [state, setState, , ready] = persisted(Persist.global("sidebar.inbox"), InboxState, {
    workingExpanded: true,
    recentExpanded: false,
  })

  const [announcement, setAnnouncement] = createStore({ text: "" })
  const [selection, setSelection] = createSignal(INITIAL_INBOX_SELECTION_STATE)

  const dispatchSelection = (event: InboxSelectionEvent) =>
    setSelection((previous) => transitionInboxSelection(previous, event))

  const clearSelection = () => dispatchSelection({ type: "clear" })

  createEffect((previous: { underway: Map<string, number>; statuses: Map<string, InboxStatus> } | undefined) => {
    if (inbox.loading()) return

    const entries = inbox.entries()

    // Runs the server's index shows as started at the first paint, keyed by their start. The running-session snapshot
    // can land after that paint and move them into Working; they had already started, so they are not announced.
    const underway =
      previous?.underway ??
      new Map(
        entries.flatMap((entry) => {
          const since = workingSince(entry.session)

          return since === undefined ? [] : [[entry.key, since] as const]
        }),
      )

    if (previous) {
      const text = entries
        .flatMap((entry) => {
          const status = previous.statuses.get(entry.key)

          if (status === undefined || status === entry.status || entry.status === "ready") return []

          const since = workingSince(entry.session)

          if (entry.status === "working" && since !== undefined && underway.get(entry.key) === since) return []

          return [
            language.t(`sidebar.inbox.announce.${entry.status}`, {
              title: sessionTabTitle(entry.session.title, language.t("session.tab.session")),
            }),
          ]
        })
        .join("\n")

      if (text) setAnnouncement("text", text)
    }

    return { underway, statuses: new Map(entries.map((entry) => [entry.key, entry.status])) }
  })

  const sections = createMemo(() => {
    const list = inbox.entries()

    // Archived sessions are available through the Archived search dialog, not in the sidebar list.
    const active = list.filter((entry) => !inboxArchived(entry))

    const needs = active
      .filter((entry) => entry.status === "approval" || entry.status === "input")
      .toSorted((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity))

    const unread = active
      .filter((entry) => entry.status === "done" || entry.status === "failed")
      .toSorted((a, b) => (b.since ?? 0) - (a.since ?? 0))

    const read = active.filter((entry) => entry.status === "ready").toSorted((a, b) => (b.since ?? 0) - (a.since ?? 0))

    const recent = state.recentExpanded ? read : read.slice(0, RECENT_LIMIT)

    // `time.updated` moves with every message of a run, so keep Working ordered by run start.
    const working = active.filter((entry) => entry.status === "working").toSorted(compareWorking)

    const current = list.find((entry) => inbox.selected(entry))

    return {
      needs,
      unread,
      recent,
      more: read.length > RECENT_LIMIT,
      current:
        current && ![...needs, ...unread, ...recent, ...working].some((entry) => entry.key === current.key)
          ? [current]
          : [],
      archived: list.some(inboxArchived),
      working,
    }
  })

  // The inbox lists sessions, not tabs, so drafts get their own group: the open one and every other still holding
  // something, newest first. Without it a draft left for a session can't be reached again.
  const draftComposer = (tab: DraftTab) => tabs.state(tab, "prompt", () => createDraftComposerState(tab.draftID))

  const draftText = (tab: DraftTab) =>
    draftComposer(tab)
      .current()
      .flatMap((part) => (part.type === "text" ? [part.content] : []))
      .join("")
      .trim()

  const draftSelected = (tab: DraftTab) => {
    const route = layout.route()

    return route.type === "draft" && route.draftID === tab.draftID
  }

  // The store's own tab objects, so typing in a draft doesn't remount its row.
  const drafts = createMemo(() =>
    tabs.store
      .filter((tab): tab is DraftTab => {
        if (tab.type !== "draft") return false

        if (draftSelected(tab)) return true

        const composer = draftComposer(tab)

        return !!draftText(tab) || composer.current().some(isAttachment) || composer.context.items().length > 0
      })
      .toReversed(),
  )

  const closeTabKeys = (keys: ReadonlySet<string>) => {
    if (keys.size === 0) return

    tabs.closeTabs(
      [...keys],
      tabs.store.find((tab) => !keys.has(tabKey(tab))),
    )
  }

  const discardDraft = (tab: DraftTab) => {
    const index = tabs.store.findIndex((item) => tabKey(item) === tabKey(tab))

    if (index !== -1) tabs.closeTab(index)
  }

  const visibleKeys = createMemo(() => [
    ...sections().current.map((entry) => entry.key),
    ...drafts().map(tabKey),
    ...sections().needs.map((entry) => entry.key),
    ...sections().unread.map((entry) => entry.key),
    ...sections().recent.map((entry) => entry.key),
    ...(state.workingExpanded ? sections().working.map((entry) => entry.key) : []),
  ])

  createEffect(() => {
    dispatchSelection({ type: "sync.visible", visible: new Set(visibleKeys()) })
  })

  const activeKey = createMemo(() => {
    const current = inbox.entries().find((entry) => inbox.selected(entry))

    if (current) return current.key

    const draft = drafts().find(draftSelected)

    return draft ? tabKey(draft) : undefined
  })

  const selectedEntries = createMemo(() => {
    const keys = selectInboxSelectedKeys(selection())

    if (keys.size === 0) return []

    return visibleKeys().flatMap((key) => {
      if (!keys.has(key)) return []
      const entry = inbox.byKey().get(key)

      return entry ? [entry] : []
    })
  })

  const selectedDrafts = createMemo(() => {
    const keys = selectInboxSelectedKeys(selection())

    if (keys.size === 0) return []

    return drafts().filter((tab) => keys.has(tabKey(tab)))
  })

  const selectedSummary = createMemo(() => {
    const entries = selectedEntries()
    const draftList = selectedDrafts()
    const markRead = entries.filter(inboxCanMarkRead).length
    const markUnread = entries.filter(inboxCanMarkUnread).length
    const archive = entries.filter((entry) => !inboxArchived(entry)).length
    const unarchive = entries.filter(inboxArchived).length
    const openTabs = entries.filter((entry) => !!findSessionTab(tabs.store, entry.server, entry.session.id)).length

    return {
      sessions: entries.length,
      drafts: draftList.length,
      markRead,
      markUnread,
      archive,
      unarchive,
      openTabs,
    }
  })

  const handleSelectClick = (key: string, action: InboxSelectClick) => {
    if (action.kind === "range") {
      dispatchSelection({
        type: "range",
        target: key,
        ordered: visibleKeys(),
        fallbackAnchor: activeKey(),
        additive: action.additive,
      })

      return
    }

    dispatchSelection({ type: "toggle", key })
  }

  const markReadSelected = () => {
    const entries = selectedEntries()

    clearSelection()
    inbox.markReadMany(entries)
  }

  const markUnreadSelected = () => {
    const entries = selectedEntries()

    clearSelection()
    inbox.markUnreadMany(entries)
  }

  const archiveSelected = () => {
    const entries = selectedEntries()

    clearSelection()
    void inbox.archiveMany(entries)
  }

  const unarchiveSelected = () => {
    const entries = selectedEntries()

    clearSelection()
    void inbox.unarchiveMany(entries)
  }

  const closeOpenTabsSelected = () => {
    const keys = new Set(
      selectedEntries().flatMap((entry) => {
        const tab = findSessionTab(tabs.store, entry.server, entry.session.id)

        return tab ? [tabKey(tab)] : []
      }),
    )

    clearSelection()
    closeTabKeys(keys)
  }

  const discardDraftsSelected = () => {
    const keys = new Set(selectedDrafts().map(tabKey))

    clearSelection()
    closeTabKeys(keys)
  }

  const deleteSelected = () => {
    const entries = selectedEntries()
    const draftList = selectedDrafts()

    if (entries.length === 0) {
      if (draftList.length > 0) discardDraftsSelected()

      return
    }

    if (entries.length === 1 && draftList.length === 0) {
      const target = entries[0]

      void dialog.show(() => (
        <DeleteDialog
          title={target.session.title}
          onConfirm={() => {
            clearSelection()
            void inbox.remove(target)
          }}
        />
      ))

      return
    }

    void dialog.show(() => (
      <BulkDeleteDialog
        count={entries.length}
        onConfirm={() => {
          clearSelection()
          void inbox.removeMany(entries)
        }}
      />
    ))
  }

  const bulkMenu = () => {
    const summary = selectedSummary()

    return (
      <>
        <Show when={summary.markRead > 0}>
          <Menu.Item onSelect={markReadSelected}>
            {language.plural("sidebar.inbox.bulk.markRead", summary.markRead, { count: summary.markRead })}
          </Menu.Item>
        </Show>
        <Show when={summary.markUnread > 0}>
          <Menu.Item onSelect={markUnreadSelected}>
            {language.plural("sidebar.inbox.bulk.markUnread", summary.markUnread, { count: summary.markUnread })}
          </Menu.Item>
        </Show>
        <Show when={summary.openTabs > 0}>
          <Menu.Item onSelect={closeOpenTabsSelected}>
            {language.plural("sidebar.inbox.bulk.closeTab", summary.openTabs, { count: summary.openTabs })}
          </Menu.Item>
        </Show>
        <Show when={summary.archive > 0}>
          <Menu.Item onSelect={archiveSelected}>
            {language.plural("sidebar.inbox.bulk.archive", summary.archive, { count: summary.archive })}
          </Menu.Item>
        </Show>
        <Show when={summary.unarchive > 0}>
          <Menu.Item onSelect={unarchiveSelected}>
            {language.plural("sidebar.inbox.bulk.unarchive", summary.unarchive, { count: summary.unarchive })}
          </Menu.Item>
        </Show>
        <Show when={summary.drafts > 0}>
          <Menu.Item onSelect={discardDraftsSelected}>
            {language.plural("sidebar.inbox.bulk.discardDraft", summary.drafts, { count: summary.drafts })}
          </Menu.Item>
        </Show>
        <Show when={summary.sessions > 0}>
          <Menu.Separator />
          <Menu.Item onSelect={deleteSelected}>
            {language.plural("sidebar.inbox.bulk.delete", summary.sessions, { count: summary.sessions })}
          </Menu.Item>
        </Show>
        <Menu.Separator />
        <Menu.Item onSelect={clearSelection}>{language.t("sidebar.inbox.selection.clear")}</Menu.Item>
      </>
    )
  }

  const sectionSelection = (keys: () => string[]): InboxSectionSelection => ({
    get allSelected() {
      return selectInboxAllSelected(selection(), keys())
    },
    get selecting() {
      return selectInboxSelecting(selection())
    },
    onToggleAll: () => dispatchSelection({ type: "section.toggle", keys: keys() }),
  })

  const selectedWorking = createMemo(() => sections().working.find((entry) => inbox.selected(entry))?.key)

  // Expand when a working session becomes current, not on each update or manual collapse.
  createEffect(() => {
    if (!ready() || !selectedWorking()) return
    setState("workingExpanded", true)
  })

  // The client only refreshes `time.idle` for loaded sessions when a run ends, so load every working one.
  createEffect(() => {
    sections().working.forEach((entry) => {
      if (entry.ctx.data.session.get(entry.session.id)) return
      void entry.ctx.data.session.sync(entry.session.id).catch(() => undefined)
    })
  })

  // Git info is not stored on the session, so eagerly load it for every shown row.
  createEffect(() => {
    const visible = sections()

    inbox.loadBranches([...visible.needs, ...visible.current, ...visible.working, ...visible.unread, ...visible.recent])
  })

  // Takes an accessor so only the For tracks the section. Reading it here would recreate the For, remounting every
  // row on any session change and resetting the list's scroll.
  const rows = (list: () => InboxEntry[]) => (
    <For each={list().map((entry) => entry.key)}>
      {(key) => (
        <Show when={inbox.byKey().get(key)}>
          {(entry) => (
            <InboxSessionCard
              itemKey={key}
              project={entry().ctx.projects.forSession(entry().session)}
              directory={entry().session.location.directory}
              title={entry().session.title}
              status={entry().status}
              server={servers.tag(entry().conn)}
              since={entry().since}
              selected={inbox.selected(entry())}
              checked={selectInboxIsSelected(selection(), key)}
              selecting={selectInboxSelecting(selection())}
              now={inbox.now(entry().status)}
              branch={inbox.branch(entry())}
              worktree={inbox.inWorktree(entry())}
              archived={inboxArchived(entry())}
              onSelectClick={(action) => handleSelectClick(key, action)}
              bulkMenu={selectInboxSelectedCount(selection()) > 1 ? bulkMenu : undefined}
              actions={
                <>
                  <Menu.Item
                    onSelect={() => {
                      const current = entry()

                      void dialog.show(() => (
                        <RenameDialog
                          title={sessionLabel(current.session)}
                          onRename={(title) => inbox.rename(current, title)}
                        />
                      ))
                    }}
                  >
                    {language.t("common.rename")}
                  </Menu.Item>
                  <Menu.Item
                    disabled={exporter.exporting({ server: entry().server, sessionID: entry().session.id })}
                    onSelect={() => exporter.export({ server: entry().server, sessionID: entry().session.id })}
                  >
                    {language.t("common.export")}…
                  </Menu.Item>
                  <SessionReadMenuItem server={entry().server} session={entry().session} />
                  <Menu.Separator />
                </>
              }
              onOpen={() => {
                if (selectInboxSelecting(selection())) clearSelection()
                inbox.open(entry())
              }}
              onArchive={() => void inbox.archive(entry())}
              onUnarchive={() => void inbox.unarchive(entry())}
              onDelete={() => {
                const current = entry()

                void dialog.show(() => (
                  <DeleteDialog title={current.session.title} onConfirm={() => void inbox.remove(current)} />
                ))
              }}
            />
          )}
        </Show>
      )}
    </For>
  )

  // Render slots inside InboxNavigation without recreating section objects on updates.
  const groups = [
    {
      id: "drafts",
      get label() {
        return language.t("sidebar.inbox.section.drafts")
      },
      get count() {
        return drafts().length
      },
      selection: sectionSelection(() => drafts().map(tabKey)),
      rows: () => (
        <For each={drafts()}>
          {(tab) => {
            const key = tabKey(tab)

            return (
              <InboxDraftCard
                itemKey={key}
                project={global.serverCtx(tab.server)?.projects.forDirectory(tab.directory)}
                directory={tab.directory}
                title={draftText(tab).split("\n")[0]}
                selected={draftSelected(tab)}
                checked={selectInboxIsSelected(selection(), key)}
                selecting={selectInboxSelecting(selection())}
                onSelectClick={(action) => handleSelectClick(key, action)}
                bulkMenu={selectInboxSelectedCount(selection()) > 1 ? bulkMenu : undefined}
                onOpen={() => {
                  if (selectInboxSelecting(selection())) clearSelection()
                  tabs.select(tab)
                }}
                onDiscard={() => discardDraft(tab)}
              />
            )
          }}
        </For>
      ),
    },
    {
      id: "needs",
      get label() {
        return language.t("sidebar.inbox.section.needsAttention")
      },
      get count() {
        return sections().needs.length
      },
      selection: sectionSelection(() => sections().needs.map((entry) => entry.key)),
      rows: () => rows(() => sections().needs),
    },
    {
      id: "unread",
      get label() {
        return language.t("sidebar.inbox.section.unread")
      },
      get count() {
        return sections().unread.length
      },
      selection: sectionSelection(() => sections().unread.map((entry) => entry.key)),
      rows: () => rows(() => sections().unread),
    },
    {
      id: "recent",
      get label() {
        return language.t("sidebar.inbox.section.recent")
      },
      get count() {
        return sections().recent.length
      },
      selection: sectionSelection(() => sections().recent.map((entry) => entry.key)),
      rows: () => rows(() => sections().recent),
      more: () => (
        <Show when={sections().more}>
          <Button
            variant="ghost-muted"
            size="normal"
            class="w-full justify-start px-2 focus-visible:-outline-offset-2"
            aria-expanded={state.recentExpanded}
            onClick={() => setState("recentExpanded", !state.recentExpanded)}
          >
            {language.t(state.recentExpanded ? "sidebar.inbox.showLess" : "sidebar.inbox.showMore")}
          </Button>
        </Show>
      ),
    },
  ]

  const selectionControls: InboxSelectionControls = {
    get count() {
      return selectInboxSelectedCount(selection())
    },
    get total() {
      return visibleKeys().length
    },
    get canMarkRead() {
      return selectedSummary().markRead > 0
    },
    get canMarkUnread() {
      return selectedSummary().markUnread > 0
    },
    get canArchive() {
      return selectedSummary().archive > 0
    },
    get canUnarchive() {
      return selectedSummary().unarchive > 0
    },
    get canDiscardDrafts() {
      return selectedSummary().drafts > 0
    },
    get draftCount() {
      return selectedSummary().drafts
    },
    get canDelete() {
      return selectedSummary().sessions > 0
    },
    onToggle: (key) => dispatchSelection({ type: "toggle", key }),
    onRange: (target, fallbackAnchor, additive) =>
      dispatchSelection({
        type: "range",
        target,
        ordered: visibleKeys(),
        fallbackAnchor: fallbackAnchor ?? activeKey(),
        additive,
      }),
    onSelectAll: () => dispatchSelection({ type: "select.all", ordered: visibleKeys() }),
    onToggleAll: () => {
      if (selectInboxAllSelected(selection(), visibleKeys())) {
        clearSelection()

        return
      }

      dispatchSelection({ type: "select.all", ordered: visibleKeys() })
    },
    onMarkRead: markReadSelected,
    onMarkUnread: markUnreadSelected,
    onArchive: archiveSelected,
    onUnarchive: unarchiveSelected,
    onDiscardDrafts: discardDraftsSelected,
    onDelete: deleteSelected,
    onClear: clearSelection,
  }

  return (
    <InboxSessionList
      loading={inbox.loading()}
      announcement={announcement.text}
      selection={selectionControls}
      current={{
        get count() {
          return sections().current.length
        },
        rows: () => rows(() => sections().current),
      }}
      sections={groups}
      working={{
        get count() {
          return sections().working.length
        },
        rows: () => rows(() => sections().working),
        get expanded() {
          return state.workingExpanded
        },
        onToggle: () => setState("workingExpanded", !state.workingExpanded),
        selection: sectionSelection(() => sections().working.map((entry) => entry.key)),
      }}
      archived={sections().archived}
      onArchived={async () => {
        const { DialogSessionSearch } = await import("@/shell/commands/session-search")

        void dialog.show(() => <DialogSessionSearch archived />)
      }}
    />
  )
}

// The session leaves the list at once, so the dialog closes before the delete request instead of after it.
function DeleteDialog(props: { title: string | undefined; onConfirm: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const layer = useDialogLayer()

  const close = () => dialog.close(layer?.id)

  const confirm = () => {
    if (dialog.closing) return
    close()
    props.onConfirm()
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.delete.title")}
          description={language.t("session.delete.confirm", {
            name: sessionTitle(props.title) ?? language.t("command.session.new"),
          })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" autofocus disabled={dialog.closing} onClick={close}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="danger" disabled={dialog.closing} onClick={confirm}>
          {language.t("session.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function BulkDeleteDialog(props: { count: number; onConfirm: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const layer = useDialogLayer()

  const close = () => dialog.close(layer?.id)

  const confirm = () => {
    if (dialog.closing) return
    close()
    props.onConfirm()
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.plural("sidebar.inbox.deleteMany.title", props.count, { count: props.count })}
          description={language.plural("sidebar.inbox.deleteMany.confirm", props.count, { count: props.count })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" autofocus disabled={dialog.closing} onClick={close}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="danger" disabled={dialog.closing} onClick={confirm}>
          {language.plural("sidebar.inbox.deleteMany.button", props.count, { count: props.count })}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function InboxSelectionBar(props: { selection: InboxSelectionControls; ref: (element: HTMLDivElement) => void }) {
  const language = useLanguage()

  const allSelected = () => props.selection.total > 0 && props.selection.count >= props.selection.total
  const discardDrafts = () => !!props.selection.canDiscardDrafts && !props.selection.canDelete

  const hasActions = () =>
    !!(
      props.selection.canMarkRead ||
      props.selection.canMarkUnread ||
      props.selection.canArchive ||
      props.selection.canUnarchive ||
      discardDrafts() ||
      props.selection.canDelete
    )

  return (
    <div
      ref={props.ref}
      data-slot="sidebar-inbox-selection"
      role="toolbar"
      aria-label={language.t("sidebar.inbox.selection.toolbar")}
      class="absolute inset-x-0 bottom-1 z-10 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[6px] bg-v2-background-bg-base p-1 ps-2"
    >
      <div class="flex h-6 min-w-[88px] flex-1 basis-0 items-center gap-2">
        <Checkbox
          appearance="compact"
          surface="base"
          hideLabel
          checked={allSelected()}
          indeterminate={props.selection.count > 0 && !allSelected()}
          onChange={props.selection.onToggleAll}
        >
          {language.t(allSelected() ? "sidebar.inbox.selection.deselectAll" : "sidebar.inbox.selection.selectAll")}
        </Checkbox>
        <span class="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium tracking-[-0.04px] text-v2-text-text-base tabular-nums">
          {language.plural("sidebar.inbox.selection.count", props.selection.count, { count: props.selection.count })}
        </span>
      </div>
      <div class="ms-auto flex h-6 shrink-0 items-center gap-0.5">
        <Show when={props.selection.canMarkRead}>
          <SelectionAction icon="eye" label={language.t("session.markRead")} onClick={props.selection.onMarkRead} />
        </Show>
        <Show when={props.selection.canMarkUnread}>
          <SelectionAction
            icon="outline-eye-slash"
            label={language.t("session.markUnread")}
            onClick={props.selection.onMarkUnread}
          />
        </Show>
        <Show when={props.selection.canArchive}>
          <SelectionAction icon="archive" label={language.t("common.archive")} onClick={props.selection.onArchive} />
        </Show>
        <Show when={props.selection.canUnarchive}>
          <SelectionAction
            icon="reset"
            label={language.t("sidebar.inbox.unarchive")}
            onClick={props.selection.onUnarchive}
          />
        </Show>
        <Show when={discardDrafts()}>
          <SelectionAction
            icon="trash"
            label={language.plural("sidebar.inbox.bulk.discardDraft", props.selection.draftCount ?? 1, {
              count: props.selection.draftCount ?? 1,
            })}
            onClick={props.selection.onDiscardDrafts}
          />
        </Show>
        <Show when={props.selection.canDelete}>
          <SelectionAction icon="trash" label={language.t("common.delete")} onClick={props.selection.onDelete} />
        </Show>
        <Show when={hasActions()}>
          <span aria-hidden="true" class="mx-0.5 h-4 w-px shrink-0 bg-v2-border-border-muted" />
        </Show>
        <SelectionAction
          icon="close"
          label={language.t("sidebar.inbox.selection.clear")}
          onClick={props.selection.onClear}
        />
      </div>
    </div>
  )
}

function SelectionAction(props: { icon: IconName; label: string; onClick?: () => void }) {
  return (
    <Tooltip placement="top" value={props.label} class="flex shrink-0">
      <IconButton
        variant="ghost-muted"
        size="normal"
        icon={<Icon name={props.icon} />}
        aria-label={props.label}
        onClick={props.onClick}
      />
    </Tooltip>
  )
}

export function InboxSessionList(props: {
  loading?: boolean
  announcement?: string
  selection?: InboxSelectionControls
  current: { count: number; rows: () => JSX.Element }
  sections: {
    id: string
    label: string
    count: number
    selection?: InboxSectionSelection
    rows: () => JSX.Element
    more?: () => JSX.Element
  }[]
  working: {
    count: number
    rows: () => JSX.Element
    expanded: boolean
    onToggle: () => void
    selection?: InboxSectionSelection
  }
  archived: boolean
  onArchived: () => void
}) {
  const language = useLanguage()
  const id = createUniqueId()

  const [navigation, setNavigation] = createStore<{ focused?: string }>({})

  let container: HTMLDivElement | undefined
  const [bar, setBar] = createSignal<HTMLDivElement>()
  const barSize = createElementSize(bar)
  const selecting = () => !!props.selection && props.selection.count > 0
  // The floating bar covers the end of the list, so the list gains matching end padding to keep its last rows reachable.
  const clearance = () => (selecting() && barSize.height ? barSize.height + 8 : 0)

  // Clear selection on Escape even when focus moved away from the sidebar after pointer selection.
  // Capture phase checks overlays before Kobalte dismisses them on document, so one Escape closes only the overlay.
  makeEventListener(
    window,
    "keydown",
    (event) => {
      if (!selecting()) return

      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return

      if (document.querySelector('[role="menu"][data-expanded], [role="listbox"][data-expanded], [role="dialog"]'))
        return

      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return

      event.preventDefault()
      props.selection?.onClear()
    },
    { capture: true },
  )

  createEffect(
    on(
      () => [
        props.loading,
        props.current.count,
        ...props.sections.map((section) => section.count),
        props.working.count,
        props.working.expanded,
      ],
      () => {
        if (props.loading) return

        const rows = Array.from(
          container?.querySelectorAll<HTMLButtonElement>('[data-slot="sidebar-inbox-item"]') ?? [],
        )

        const target =
          rows.find((row) => row.id === navigation.focused) ??
          rows.find((row) => row.dataset.state === "active") ??
          rows[0]

        setNavigation("focused", target?.id)
      },
    ),
  )

  return (
    <InboxNavigation.Provider value={() => navigation.focused}>
      <div
        ref={container}
        data-slot="sidebar-inbox"
        data-focus-scope
        aria-busy={props.loading}
        class="flex min-h-0 flex-1 flex-col"
        onFocusIn={(event) => {
          const row = event.target.closest<HTMLButtonElement>('[data-slot="sidebar-inbox-item"]')

          if (row) setNavigation("focused", row.id)
        }}
        onKeyDown={(event) => {
          if (
            props.selection &&
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === "a"
          ) {
            if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]'))
              return

            event.preventDefault()
            props.selection.onSelectAll()

            return
          }

          if (event.altKey || event.ctrlKey || event.metaKey) return

          const rows = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-slot="sidebar-inbox-item"]'),
          )

          const index = rows.findIndex((row) => row === event.target)

          if (index === -1) return

          if (!event.shiftKey && event.key.toLowerCase() === "x" && props.selection) {
            const key = rows[index].dataset.inboxKey

            if (!key) return

            event.preventDefault()
            props.selection.onToggle(key)
            rows[index].scrollIntoView({ block: "nearest" })

            return
          }

          let next = index

          switch (event.key) {
            case "Home":
              next = 0
              break
            case "End":
              next = rows.length - 1
              break
            case "ArrowUp":
              next = Math.max(0, index - 1)
              break
            case "ArrowDown":
              next = Math.min(rows.length - 1, index + 1)
              break
            default:
              return
          }

          event.preventDefault()

          if (event.shiftKey && props.selection) {
            const fromKey = rows[index].dataset.inboxKey
            const toKey = rows[next].dataset.inboxKey

            if (toKey) props.selection.onRange(toKey, fromKey)
          }

          rows[next].focus({ preventScroll: true })
          rows[next].scrollIntoView({ block: "nearest" })
        }}
      >
        <span class="sr-only" role="status" aria-atomic="true">
          {props.announcement}
        </span>
        <Show
          when={!props.loading}
          fallback={
            <div class="flex justify-center p-2">
              <Loader role="img" aria-hidden="false" aria-label={language.t("common.loading")} />
            </div>
          }
        >
          <div class="relative flex min-h-0 flex-1 flex-col">
            <div
              data-slot="sidebar-inbox-scroll"
              data-scrollable
              class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
              style={{ "padding-bottom": `${4 + clearance()}px`, "scroll-padding-bottom": `${clearance()}px` }}
            >
              <Show when={props.current.count > 0}>
                <div class="flex shrink-0 flex-col gap-0.5 pb-2.5">{props.current.rows()}</div>
              </Show>
              <For each={props.sections}>
                {(section) => (
                  <Show when={section.count > 0}>
                    <div
                      role="group"
                      aria-labelledby={`${id}-${section.id}`}
                      class="flex shrink-0 flex-col gap-2 pb-2.5"
                    >
                      <SectionHeader id={`${id}-${section.id}`} label={section.label} selection={section.selection} />
                      <div class="flex flex-col gap-0.5">{section.rows()}</div>
                      {section.more?.()}
                    </div>
                  </Show>
                )}
              </For>
              <Show
                when={
                  props.current.count === 0 &&
                  props.working.count === 0 &&
                  props.sections.every((section) => section.count === 0)
                }
              >
                <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
                  {language.t("sidebar.inbox.empty")}
                </div>
              </Show>
              <Show when={props.archived}>
                <div class="shrink-0 pt-3">
                  <Button
                    variant="ghost-muted"
                    size="normal"
                    class="w-full justify-start px-2 focus-visible:-outline-offset-2"
                    onClick={props.onArchived}
                  >
                    {language.t("sidebar.inbox.section.archived")}
                  </Button>
                </div>
              </Show>
            </div>
            {/* Floats over the end of the list so starting or ending a selection never moves a row. */}
            <Show when={selecting() ? props.selection : undefined}>
              {(selection) => <InboxSelectionBar selection={selection()} ref={setBar} />}
            </Show>
          </div>
          {/* Working sessions sit in a shelf pinned below the scrolling list. */}
          <Show when={props.working.count > 0}>
            <div
              data-slot="sidebar-inbox-working"
              role="group"
              aria-labelledby={`${id}-working`}
              class="relative flex max-h-[40%] shrink-0 flex-col gap-2 pt-[7px]"
            >
              <span
                aria-hidden="true"
                class="pointer-events-none absolute top-0 h-px bg-v2-border-border-muted"
                style={{
                  "inset-inline-start": "calc(1px - var(--sidebar-inset-start, 11px))",
                  "inset-inline-end": "calc(1px - (var(--sidebar-inset-end, 3px) + var(--sidebar-divider-bleed, 0px)))",
                }}
              />
              <SectionHeader
                id={`${id}-working`}
                label={language.t("sidebar.inbox.section.working")}
                expanded={props.working.expanded}
                shimmer={!props.working.expanded}
                onToggle={props.working.onToggle}
                selection={props.working.expanded ? props.working.selection : undefined}
              />
              <Show when={props.working.expanded}>
                <div data-scrollable class="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                  {props.working.rows()}
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </InboxNavigation.Provider>
  )
}

function SectionHeader(props: {
  id: string
  label: string
  expanded?: boolean
  shimmer?: boolean
  onToggle?: () => void
  selection?: InboxSectionSelection
}) {
  const language = useLanguage()

  const content = (): JSX.Element => (
    <>
      <span id={props.id} class="min-w-0 truncate">
        <Show when={props.shimmer} fallback={props.label}>
          <TextShimmer text={props.label} active />
        </Show>
      </span>
      <Show when={props.onToggle}>
        <Icon
          name="fill-triangle-down"
          class="shrink-0 transition-transform"
          classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
        />
      </Show>
    </>
  )

  const selectAction = () => (
    <Show when={props.selection}>
      {(selection) => (
        <button
          type="button"
          class="ms-auto shrink-0 rounded-[4px] px-1 text-[12px] leading-4 font-normal text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:-outline-offset-2"
          classList={{
            "opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100": !selection().selecting,
          }}
          onClick={selection().onToggleAll}
        >
          {language.t(
            selection().allSelected ? "sidebar.inbox.selection.deselect" : "sidebar.inbox.selection.selectAll",
          )}
        </button>
      )}
    </Show>
  )

  return (
    <Show
      when={props.onToggle}
      fallback={
        <div class="group/header flex h-6 shrink-0 items-center gap-1.5 px-2 text-[13px] leading-4 font-medium text-v2-text-text-muted">
          {content()}
          {selectAction()}
        </div>
      }
    >
      {(toggle) => (
        <div class="group/header flex h-6 shrink-0 items-center gap-1">
          <button
            type="button"
            aria-expanded={props.expanded}
            class="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-2 text-start text-[13px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:-outline-offset-2"
            onClick={toggle()}
          >
            {content()}
          </button>
          <Show when={props.selection}>
            <div class="pe-1">{selectAction()}</div>
          </Show>
        </div>
      )}
    </Show>
  )
}

function handleCardClick(
  event: MouseEvent & { currentTarget: HTMLElement },
  onSelectClick: ((action: InboxSelectClick) => void) | undefined,
  onOpen: () => void,
) {
  const action = onSelectClick ? selectClickAction(event) : undefined

  if (!onSelectClick || !action) return onOpen()

  event.preventDefault()
  onSelectClick(action)
  // The selection bar can appear over the clicked row; scroll-padding keeps the row clear of it.
  event.currentTarget.scrollIntoView({ block: "nearest" })
}

function selectClickAction(event: MouseEvent): InboxSelectClick | undefined {
  if (event.shiftKey) return { kind: "range", additive: event.metaKey || event.ctrlKey }

  if (event.metaKey || event.ctrlKey) return { kind: "toggle", additive: false }

  if (event.target instanceof Element && event.target.closest('[data-slot="inbox-select-hit"]'))
    return { kind: "toggle", additive: false }

  return undefined
}

export function InboxDraftCard(props: {
  itemKey?: string
  project?: LocalProject
  directory: string
  title: string
  selected: boolean
  checked?: boolean
  selecting?: boolean
  onSelectClick?: (action: InboxSelectClick) => void
  bulkMenu?: () => JSX.Element
  onOpen: () => void
  onDiscard: () => void
}) {
  const language = useLanguage()
  const navigation = useContext(InboxNavigation)
  const id = createUniqueId()

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="button"
        type="button"
        id={id}
        tabIndex={navigation ? (navigation() === id ? 0 : -1) : 0}
        aria-current={props.selected ? "page" : undefined}
        data-slot="sidebar-inbox-item"
        data-inbox-key={props.itemKey}
        data-state={props.selected ? "active" : undefined}
        data-selectable={props.onSelectClick ? "" : undefined}
        data-checked={props.checked ? "" : undefined}
        data-selecting={props.selecting ? "" : undefined}
        class="group flex h-[54px] w-full shrink-0 select-none flex-col gap-1.5 rounded-[6px] p-2 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2 data-[checked]:bg-v2-overlay-simple-overlay-pressed data-[state=active]:bg-v2-overlay-simple-overlay-pressed"
        onClick={(event) => handleCardClick(event, props.onSelectClick, props.onOpen)}
      >
        <span class="flex h-4 w-full min-w-0 shrink-0 items-center gap-2">
          <span
            data-slot={props.onSelectClick ? "inbox-select-hit" : undefined}
            class="relative flex size-4 shrink-0 items-center justify-center"
          >
            <Show when={props.onSelectClick}>
              <span aria-hidden="true" class="absolute inset-[-6px]" />
            </Show>
            <span data-slot="inbox-card-avatar" class="flex size-4 items-center justify-center">
              <SessionTabAvatarView project={props.project} directory={props.directory} unread={false} />
            </span>
            <Show when={props.onSelectClick}>
              <span data-slot="inbox-card-checkbox" class="flex size-4 items-center justify-center">
                <Checkbox appearance="compact" presentation checked={!!props.checked} />
              </span>
            </Show>
          </span>
          <span
            dir="auto"
            class="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium tracking-[-0.04px] text-v2-text-text-base"
          >
            {props.title || language.t("command.session.new")}
          </span>
        </span>
        <span class="flex h-4 w-full min-w-0 shrink-0 items-center ps-6 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted">
          <span dir="auto" class="min-w-0 truncate">
            {displayName(props.project ?? { worktree: props.directory })}
          </span>
        </span>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Show
            when={props.checked && props.bulkMenu ? props.bulkMenu : undefined}
            fallback={
              <>
                <Show when={props.onSelectClick}>
                  <Menu.Item onSelect={() => props.onSelectClick?.({ kind: "toggle", additive: false })}>
                    {language.t(props.checked ? "sidebar.inbox.selection.deselect" : "sidebar.inbox.selection.select")}
                  </Menu.Item>
                  <Menu.Separator />
                </Show>
                <Menu.Item onSelect={props.onDiscard}>{language.t("sidebar.inbox.discardDraft")}</Menu.Item>
              </>
            }
          >
            {(menu) => menu()()}
          </Show>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

export function InboxSessionCard(props: {
  itemKey?: string
  project?: LocalProject
  directory: string
  title?: string
  status: InboxStatus
  server?: string
  since: number | undefined
  selected: boolean
  checked?: boolean
  selecting?: boolean
  now: number
  branch: string | undefined
  worktree: boolean
  archived: boolean
  onSelectClick?: (action: InboxSelectClick) => void
  bulkMenu?: () => JSX.Element
  onOpen: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
  actions?: JSX.Element
}) {
  const language = useLanguage()
  const navigation = useContext(InboxNavigation)
  const id = createUniqueId()

  const status = () => props.status

  const compact = (seconds: number) => {
    if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

    if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

    return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
  }

  const statusLabel = (value: InboxStatus) =>
    value === "ready" ? undefined : language.t(`sidebar.inbox.status.${value}`)

  const age = () => {
    if (props.since === undefined) return

    const seconds = Math.max(0, Math.floor((props.now - props.since) / 1000))

    if (status() === "working" && seconds < 60) return language.plural("sidebar.inbox.elapsed.seconds", seconds)

    return seconds < 60 ? language.t("sidebar.inbox.time.now") : compact(seconds)
  }

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="button"
        type="button"
        id={id}
        tabIndex={navigation ? (navigation() === id ? 0 : -1) : 0}
        aria-current={props.selected ? "page" : undefined}
        data-slot="sidebar-inbox-item"
        data-inbox-key={props.itemKey}
        data-status={status()}
        data-state={props.selected ? "active" : undefined}
        data-selectable={props.onSelectClick ? "" : undefined}
        data-checked={props.checked ? "" : undefined}
        data-selecting={props.selecting ? "" : undefined}
        class="group flex h-[54px] w-full shrink-0 select-none flex-col gap-1.5 rounded-[6px] p-2 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2 data-[checked]:bg-v2-overlay-simple-overlay-pressed data-[state=active]:bg-v2-overlay-simple-overlay-pressed"
        classList={{
          "transition-opacity hover:opacity-100 focus-visible:opacity-100": !props.selected && !props.checked,
          "opacity-50": props.archived && !props.selected && !props.checked,
        }}
        onClick={(event) => handleCardClick(event, props.onSelectClick, props.onOpen)}
      >
        <span class="flex h-4 w-full min-w-0 shrink-0 items-center gap-2">
          <span
            data-slot={props.onSelectClick ? "inbox-select-hit" : undefined}
            class="relative flex size-4 shrink-0 items-center justify-center"
          >
            <Show when={props.onSelectClick}>
              <span aria-hidden="true" class="absolute inset-[-6px]" />
            </Show>
            <span data-slot="inbox-card-avatar" class="flex size-4 items-center justify-center">
              <SessionTabAvatarView project={props.project} directory={props.directory} unread={false} />
            </span>
            <Show when={props.onSelectClick}>
              <span data-slot="inbox-card-checkbox" class="flex size-4 items-center justify-center">
                <Checkbox appearance="compact" presentation checked={!!props.checked} />
              </span>
            </Show>
          </span>
          <span
            dir="auto"
            class="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium tracking-[-0.04px] text-v2-text-text-base"
          >
            {sessionTabTitle(props.title, language.t("session.tab.session"))}
          </span>
        </span>
        <span class="relative flex h-4 w-full min-w-0 shrink-0 items-center gap-2 ps-6 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted">
          <Show when={props.server}>
            {(name) => (
              <Tooltip placement="right" value={name()} class="absolute start-0 top-0 flex size-4 shrink-0">
                <Icon name="server" aria-label={name()} class="text-v2-icon-icon-muted" />
              </Tooltip>
            )}
          </Show>
          <span class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-v2-icon-icon-muted">
            <span dir="auto" class="min-w-0 truncate text-v2-text-text-muted">
              {displayName(props.project ?? { worktree: props.directory })}
            </span>
            <Show when={props.worktree}>
              <Tooltip placement="right" value={props.directory} class="flex shrink-0">
                <Icon name="outline-worktree" />
              </Tooltip>
            </Show>
            <Show when={props.branch}>
              {(name) => (
                <Tooltip placement="right" value={name()} class="flex shrink-0">
                  <Icon name="branch" />
                </Tooltip>
              )}
            </Show>
          </span>
          <span class="ms-auto flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums">
            <Show when={status() !== "ready"}>
              <span class="sr-only">{statusLabel(status())}</span>
              <Show
                when={status() === "working"}
                fallback={
                  <span
                    aria-hidden="true"
                    class="size-[7px] shrink-0 rounded-full"
                    classList={{
                      "bg-v2-state-fg-warning": status() === "approval" || status() === "input",
                      "bg-v2-state-fg-danger": status() === "failed",
                      "bg-v2-background-bg-accent": status() === "done",
                    }}
                  />
                }
              >
                <ActivityRing class="shrink-0 text-v2-icon-icon-muted" />
              </Show>
            </Show>
            {/* Announce only the state, not each age update. */}
            <Show when={age()}>
              {(label) => (
                <span aria-hidden={status() === "ready" ? undefined : "true"} class="text-v2-text-text-faint">
                  {label()}
                </span>
              )}
            </Show>
          </span>
        </span>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Show
            when={props.checked && props.bulkMenu ? props.bulkMenu : undefined}
            fallback={
              <>
                {props.actions}
                <Show when={props.onSelectClick}>
                  <Menu.Item onSelect={() => props.onSelectClick?.({ kind: "toggle", additive: false })}>
                    {language.t(props.checked ? "sidebar.inbox.selection.deselect" : "sidebar.inbox.selection.select")}
                  </Menu.Item>
                </Show>
                <Show
                  when={props.archived}
                  fallback={<Menu.Item onSelect={props.onArchive}>{language.t("common.archive")}</Menu.Item>}
                >
                  <Menu.Item onSelect={props.onUnarchive}>{language.t("sidebar.inbox.unarchive")}</Menu.Item>
                </Show>
                <Menu.Separator />
                <Menu.Item onSelect={props.onDelete}>{language.t("common.delete")}…</Menu.Item>
              </>
            }
          >
            {(menu) => menu()()}
          </Show>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}
