import { Schema } from "effect"
import { batch, createEffect, createMemo, onCleanup, Show, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { Key } from "@solid-primitives/keyed"
import { Accessibility, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import type { SessionInfo } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { Menu } from "@opencode/ui/menu"
import { arrayMove } from "@/runtime/array-move"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { createSessionExporter } from "@/session/commands/export-session"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { SessionCopyMenu } from "@/session/session-copy-menu"
import { SessionReadMenuItem } from "@/session/session-read-menu-item"
import { errorMessage } from "@/shell/layout/helpers"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { showToast } from "@/shell/notifications/toast"
import { tabHref, tabKey, useTabs, type Tab } from "@/shell/tabs/tabs"
import {
  addPin,
  recentSessionEndpoints,
  recentSessionKey,
  removePin,
  reorderPins,
  splitRecentSessionKey,
} from "./recent-sessions-model"
import { DeleteSessionDialog } from "./recent-sessions"
import { notifySessionTabsRemoved } from "./session-events"
import { TabNavItem } from "./tab-nav"
import { syncInactiveSession, type TabStripLeading } from "./tab-strip"
import { sessionTabTitle } from "./tab-title"

// The Recent sidebar's pin list, so pins carry over between the sidebar layouts.
const PinsState = Persistence.struct({
  pins: Persistence.array(Schema.String),
})

export type SessionPins = ReturnType<typeof createSessionPins>

/** The ordered pinned sessions, local to this desktop. Two routes to the same endpoint pin one session. */
export function createSessionPins() {
  const servers = useServers()

  const [state, setState, , ready] = persisted(Persist.global("sidebar.recent"), PinsState, { pins: [] })

  const endpoints = createMemo(() => recentSessionEndpoints(servers.list, servers.ownUrl()))

  const identity = (server: string, sessionID: string) => recentSessionKey(endpoints().get(server) ?? server, sessionID)

  const identities = createMemo(
    () =>
      new Set(
        state.pins.flatMap((key) => {
          const pin = splitRecentSessionKey(key)

          return pin ? [identity(pin.server, pin.sessionID)] : []
        }),
      ),
  )

  const unpin = (server: string, sessionID: string) => {
    const next = removePin(state.pins, recentSessionKey(server, sessionID), endpoints())

    if (next.length !== state.pins.length) setState("pins", next)
  }

  return {
    ready,
    keys: () => state.pins,
    identity,
    pinned: (server: string, sessionID: string) => identities().has(identity(server, sessionID)),
    unpin,
    toggle: (server: string, sessionID: string) => {
      if (!identities().has(identity(server, sessionID))) {
        setState("pins", (pins) => addPin(pins, recentSessionKey(server, sessionID)))

        return
      }

      unpin(server, sessionID)
    },
    reorder: (visible: readonly string[], next: readonly string[]) =>
      setState("pins", reorderPins(state.pins, visible, next)),
  }
}

export function PinMuteMenuItems(props: { pins: SessionPins; server: string; sessionID: string }) {
  const language = useLanguage()

  const global = useGlobal()

  const muted = () => global.sessionPreferences.muted(props.server, props.sessionID)

  return (
    <>
      <Menu.Item onSelect={() => props.pins.toggle(props.server, props.sessionID)}>
        {language.t(props.pins.pinned(props.server, props.sessionID) ? "sidebar.recent.unpin" : "sidebar.recent.pin")}
      </Menu.Item>
      <Menu.Item onSelect={() => global.sessionPreferences.update("muted", props.server, props.sessionID, !muted())}>
        {language.t(muted() ? "sidebar.recent.unmute" : "sidebar.recent.mute")}
      </Menu.Item>
    </>
  )
}

type PinnedItem = { key: string; server: ServerConnection.Key; session: SessionInfo }

/**
 * The Pinned rows above the side tabs. A pinned session stays here when its tab closes, and selecting it reopens the
 * tab. Its open tab leaves the tab list below, so each session shows once.
 */
export function createPinnedSessions(input: {
  pins: SessionPins
  currentTab: () => Tab | undefined
  highlightActive: () => boolean
  onSelect: () => void
}) {
  const global = useGlobal()

  const tabs = useTabs()

  const language = useLanguage()

  const [unread, setUnread] = createStore<Record<string, boolean>>({})

  // The server context each pin's single load ran against, so a replaced context loads it again.
  const loads = new Map<string, ServerCtx>()

  // Pins outside the loaded sessions load one by one; a pin whose session is gone is dropped.
  createEffect(() => {
    if (!input.pins.ready()) return

    input.pins.keys().forEach((key) => {
      const pin = splitRecentSessionKey(key)

      if (!pin) return

      const ctx = global.serverCtx(ServerConnection.Key.make(pin.server))

      if (!ctx || ctx.sdk.connection.status() !== "connected") return

      if (ctx.data.session.missing(pin.sessionID)) {
        input.pins.unpin(pin.server, pin.sessionID)

        return
      }

      if (ctx.data.session.get(pin.sessionID) || loads.get(key) === ctx) return

      loads.set(key, ctx)
      void ctx.data.session.sync(pin.sessionID).catch(() => {
        if (loads.get(key) === ctx) loads.delete(key)
      })
    })
  })

  const items = createMemo(() => {
    const seen = new Set<string>()

    return input.pins.keys().flatMap((key): PinnedItem[] => {
      const pin = splitRecentSessionKey(key)

      if (!pin) return []

      const server = ServerConnection.Key.make(pin.server)

      const session = global.serverCtx(server)?.data.session.get(pin.sessionID)

      // An archived pin is hidden but kept, as in Recent.
      if (!session || session.time.archived !== undefined) return []

      const identity = input.pins.identity(pin.server, pin.sessionID)

      if (seen.has(identity)) return []
      seen.add(identity)

      return [{ key: tabKey({ type: "session", server, sessionId: session.id }), server, session }]
    })
  })

  const openTab = (item: PinnedItem) =>
    tabs.store.find((tab) => tab.type === "session" && tab.server === item.server && tab.sessionId === item.session.id)

  const active = (item: PinnedItem) => {
    const tab = input.currentTab()

    return (
      input.highlightActive() &&
      tab?.type === "session" &&
      input.pins.identity(tab.server, tab.sessionId) === input.pins.identity(item.server, item.session.id)
    )
  }

  const open = (item: PinnedItem) => {
    const ctx = global.serverCtx(item.server)

    if (!ctx) return

    input.onSelect()
    void startTransition(() => {
      tabs.select(tabs.addSessionTab({ server: item.server, sessionId: item.session.id }))
      ctx.projects.touch(ctx.projects.forSession(item.session)?.worktree ?? item.session.location.directory)
    })
  }

  const close = (item: PinnedItem) => {
    const index = tabs.store.findIndex(
      (tab) => tab.type === "session" && tab.server === item.server && tab.sessionId === item.session.id,
    )

    if (index !== -1) tabs.closeTab(index)
  }

  const rowRefs = new Map<string, HTMLDivElement>()

  const content = (
    <Show when={items().length > 0}>
      <div role="group" aria-labelledby="sidebar-organize-pinned" class="flex shrink-0 flex-col gap-1 pb-3">
        <SidebarSectionLabel id="sidebar-organize-pinned" label={language.t("sidebar.recent.pinned")} />
        <DragDropProvider
          sensors={[
            PointerSensor.configure({
              activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
              // Rows are links, which the default would refuse to drag from; only an inline rename should.
              preventActivation: (event) =>
                event.target instanceof Element &&
                !!event.target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]'),
            }),
          ]}
          modifiers={[RestrictToVerticalAxis]}
          plugins={(defaults) => [
            ...defaults.filter((plugin) => plugin !== Accessibility),
            Feedback.configure({ dropAnimation: null }),
          ]}
          onDragEnd={(event) => {
            const source = event.operation.source

            if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return

            const visible = items().map((item) => recentSessionKey(item.server, item.session.id))

            input.pins.reorder(visible, arrayMove(visible, source.initialIndex, source.index))
          }}
        >
          <div data-titlebar-tab-list data-focus-scope data-orientation="vertical" class="flex w-full min-w-0 flex-col">
            <Key each={items()} by={(item) => item.key}>
              {(item, index) => {
                const key = item().key

                onCleanup(() => rowRefs.delete(key))

                return (
                  <PinnedSessionRow
                    item={item()}
                    index={index()}
                    pins={input.pins}
                    open={!!openTab(item())}
                    active={active(item())}
                    shortcut={index() < 9 ? index() + 1 : undefined}
                    ref={(element) => rowRefs.set(key, element)}
                    onUnreadChange={(value) => setUnread(key, value)}
                    onOpen={() => open(item())}
                    onClose={() => close(item())}
                  />
                )
              }}
            </Key>
          </div>
        </DragDropProvider>
      </div>
    </Show>
  )

  return {
    count: () => items().length,
    /** Whether a tab belongs to Pinned rather than the tab list. */
    holds: (tab: Tab) => tab.type === "session" && items().some((item) => item.key === tabKey(tab)),
    leading: (): TabStripLeading => ({
      content,
      keys: items().map((item) => item.key),
      unread: (key) => !!unread[key],
      navigate: (key, reveal) => {
        const item = items().find((entry) => entry.key === key)

        if (!item) return

        open(item)

        if (reveal) rowRefs.get(key)?.scrollIntoView({ behavior: "instant", block: "nearest" })
      },
    }),
  }
}

export function SidebarSectionLabel(props: { id?: string; label: string; class?: string }) {
  return (
    <div
      id={props.id}
      class={`flex h-6 shrink-0 items-center px-2 text-[13px] leading-[var(--line-height-compact)] font-medium text-v2-text-text-muted ${props.class ?? ""}`}
    >
      <span class="min-w-0 truncate">{props.label}</span>
    </div>
  )
}

function PinnedSessionRow(props: {
  item: PinnedItem
  index: number
  pins: SessionPins
  open: boolean
  active: boolean
  shortcut: number | undefined
  ref: (element: HTMLDivElement) => void
  onUnreadChange: (unread: boolean) => void
  onOpen: () => void
  onClose: () => void
}) {
  const global = useGlobal()

  const language = useLanguage()

  const dialog = useDialog()

  const exporter = createSessionExporter()

  const sortable = useSortable({
    get id() {
      return props.item.key
    },
    get index() {
      return props.index
    },
  })

  const status = useSessionTabAvatarState(
    () => props.item.server,
    () => props.item.session.id,
    () => true,
    () => props.item.session,
  )

  const muted = () => global.sessionPreferences.muted(props.item.server, props.item.session.id)

  // A busy session shows its progress indicator instead of the unread dot; a muted one shows neither.
  const unread = createMemo(() => status.unread() && !status.loading() && !muted())

  createEffect(() => props.onUnreadChange(unread()))

  // A permission or form asked before this window connected only shows once loaded, as for an unselected side tab.
  createEffect(() => {
    const ctx = global.serverCtx(props.item.server)

    const id = props.item.session.id

    if (!ctx || props.active || !status.loading() || ctx.sdk.connection.status() !== "connected") return

    const timer = window.setTimeout(() => syncInactiveSession(ctx, id), 300)

    onCleanup(() => window.clearTimeout(timer))
  })

  const remove = () => {
    const ctx = global.serverCtx(props.item.server)

    if (!ctx) return

    const session = props.item.session

    const ids = sessionTreeIDs(ctx.data.session.list(), session.id)

    void ctx.data.session
      .remove(session.id)
      .then(() =>
        batch(() => {
          props.pins.unpin(props.item.server, session.id)
          notifySessionTabsRemoved({
            server: props.item.server,
            directory: session.location.directory,
            sessionIDs: ids,
          })
        }),
      )
      .catch((cause) =>
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(cause, language.t("session.delete.failed.title")),
        }),
      )
  }

  const exportTarget = () => ({ server: props.item.server, sessionID: props.item.session.id })

  const menu = (rename: () => void) => (
    <>
      <Menu.Item onSelect={() => props.pins.unpin(props.item.server, props.item.session.id)}>
        {language.t("sidebar.recent.unpin")}
      </Menu.Item>
      <Menu.Item
        onSelect={() => global.sessionPreferences.update("muted", props.item.server, props.item.session.id, !muted())}
      >
        {language.t(muted() ? "sidebar.recent.unmute" : "sidebar.recent.mute")}
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item onSelect={rename}>{language.t("common.rename")}</Menu.Item>
      <Menu.Item disabled={exporter.exporting(exportTarget())} onSelect={() => exporter.export(exportTarget())}>
        {language.t("common.export")}…
      </Menu.Item>
      <SessionCopyMenu session={props.item.session} />
      <SessionReadMenuItem server={props.item.server} session={props.item.session} />
      <Show when={props.open}>
        <Menu.Separator />
        <Menu.Item onSelect={props.onClose}>{language.t("common.closeTab")}</Menu.Item>
      </Show>
      <Menu.Separator />
      <Menu.Item
        onSelect={() =>
          void dialog.show(() => (
            <DeleteSessionDialog
              title={sessionTabTitle(props.item.session.title, language.t("command.session.new"))}
              onConfirm={remove}
            />
          ))
        }
      >
        {language.t("common.delete")}…
      </Menu.Item>
    </>
  )

  return (
    <div
      ref={sortable.ref}
      data-titlebar-tab-slot
      data-orientation="vertical"
      data-active={props.active}
      class="relative flex w-full shrink-0"
    >
      <TabNavItem
        ref={props.ref}
        href={tabHref({ type: "session", server: props.item.server, sessionId: props.item.session.id })}
        server={props.item.server}
        session={props.item.session}
        preparing={false}
        muted={muted()}
        unread={unread()}
        attention={status.attention()}
        loading={status.loading()}
        shortcut={props.shortcut}
        onNavigate={props.onOpen}
        active={props.active}
        dragging={sortable.isDragSource()}
        orientation="vertical"
        menu={menu}
      />
    </div>
  )
}
