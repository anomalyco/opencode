import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, startTransition, Switch, untrack } from "solid-js"
import { createOverlayFocus } from "@opencode/ui/context/overlay-focus"
import { createStore } from "solid-js/store"
import { Key } from "@solid-primitives/keyed"
import type { SessionInfo } from "@opencode/client/promise"
import { createSimpleContext } from "@opencode/ui/context"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { uuid } from "@opencode/util/uuid"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { sessionStatus, useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { tabHref, tabKey, useTabs, type Tab } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"
import { useDialog } from "@opencode/ui/context/dialog"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { DeleteSessionDialog } from "./recent-sessions"
import { notifySessionTabsRemoved } from "./session-events"
import { sessionTabTitle } from "./tab-title"
import { createMinuteClock, SessionDetail, sessionAge } from "./session-detail"
import { groupKey, pinDragSourceOf, pinDropTarget, sessionKey, stripDropBefore, type PinDragSource } from "./pin-drag"
import { useSortable } from "@dnd-kit/solid/sortable"
import {
  createGroup,
  moveGroup,
  place,
  type PinTarget,
  EMPTY_PINS,
  groupOf,
  isPinned,
  moveToGroup,
  pin,
  pinKey,
  PinsStateSchema,
  prunePins,
  removeFromGroup,
  toggleGroup,
  ungroup,
  unpin,
  unpinGroup,
  updateGroup,
  type PinGroup,
  type PinRef,
  type PinsState,
} from "@/shell/tabs/pins"
import { AUTO_TAB_GROUP_COLORS, nextManualGroupColor, type TabGroupColor } from "./tab-groups"
import { TabNavItem } from "./tab-nav"
import { syncInactiveSession, type TabStripLeading } from "./tab-strip"
import "./tab-groups.css"
import "./pinned-area.css"

type Orientation = "horizontal" | "vertical"

/** Pinned sessions and their groups, shared by every tab position and the List layout. */
export const { use: usePins, provider: PinsProvider } = createSimpleContext({
  name: "Pins",
  gate: false,
  init: () => {
    const global = useGlobal()
    const layout = useLayout()
    const settings = useSettings()
    const tabs = useTabs()
    const language = useLanguage()

    const [state, setState, , ready] = persisted(Persist.global("navigation.pins"), PinsStateSchema, EMPTY_PINS)
    const [local, setLocal] = createStore<{ unread: Record<string, boolean> }>({ unread: {} })

    const apply = (next: (current: PinsState) => PinsState) => {
      const current: PinsState = { items: state.items, collapsed: state.collapsed }
      const result = next(current)

      if (result !== current) setState(result)
    }

    const refOf = (tab: Tab | undefined): PinRef | undefined =>
      tab?.type === "session" ? { server: tab.server, sessionId: tab.sessionId } : undefined

    const ctxOf = (ref: PinRef) => global.serverCtx(ServerConnection.Key.make(ref.server))

    // The server context each pin's one load ran against, so a replaced context loads it again.
    const loads = new Map<string, ServerCtx>()

    // Pins outside the loaded sessions load one at a time; a pin whose session is gone is dropped.
    createEffect(() => {
      if (!ready() || !settings.appearance.navigationPrototype()) return
      const missing = (ref: PinRef) => !!ctxOf(ref)?.data.session.missing(ref.sessionId)

      apply((current) => prunePins(current, missing))
      state.items
        .flatMap((item) => (item.type === "session" ? [item] : item.sessions))
        .forEach((ref) => {
          const ctx = ctxOf(ref)
          const key = pinKey(ref)

          if (!ctx || ctx.sdk.connection.status() !== "connected") return

          if (ctx.data.session.get(ref.sessionId) || loads.get(key) === ctx) return
          loads.set(key, ctx)
          void ctx.data.session.sync(ref.sessionId).catch(() => {
            if (loads.get(key) === ctx) loads.delete(key)
          })
        })
    })

    const session = (ref: PinRef): SessionInfo | undefined => ctxOf(ref)?.data.session.get(ref.sessionId)

    // The pinned session on screen, by its root: a subagent's route still marks its parent's pin.
    const current = createMemo((): PinRef | undefined => {
      const route = layout.route()

      if (route.type !== "session") return

      return {
        server: route.server,
        sessionId: global.serverCtx(route.server)?.data.session.root(route.sessionId) ?? route.sessionId,
      }
    })

    const isCurrent = (ref: PinRef) => {
      const tab = current()

      return !!tab && tab.server === ref.server && tab.sessionId === ref.sessionId
    }

    // A closed group still shows the session you are in, so landing in it never hides where you are.
    const visible = (group: PinGroup) => (state.collapsed[group.id] ? group.sessions.filter(isCurrent) : group.sessions)

    // What a closed group's hidden sessions need from you: an answer outranks unread work.
    const mark = (ref: PinRef) => {
      const ctx = ctxOf(ref)

      if (!ctx) return
      const info = session(ref)

      const value = sessionStatus(ctx, ref.sessionId, {
        root: true,
        autoApprove: settings.permissions.autoApproves(projectSettingsKey(ctx.sdk.scope, info?.projectID)),
        snapshot: info,
      })

      if (value === "input") return "attention"

      if (value === "unread" && !global.sessionPreferences.muted(ref.server, ref.sessionId)) return "unread"
    }

    const hiddenMark = (group: PinGroup) => {
      if (!state.collapsed[group.id]) return
      const marks = group.sessions.filter((ref) => !isCurrent(ref)).map(mark)

      if (marks.includes("attention")) return "attention"

      if (marks.includes("unread")) return "unread"
    }

    const keyOf = (ref: PinRef) =>
      tabKey({ type: "session", server: ServerConnection.Key.make(ref.server), sessionId: ref.sessionId })

    const keys = createMemo(() =>
      state.items.flatMap((item) => (item.type === "session" ? [keyOf(item)] : visible(item).map(keyOf))),
    )

    const open = (ref: PinRef) => {
      const ctx = ctxOf(ref)
      const info = session(ref)

      void startTransition(() => {
        tabs.select(tabs.addSessionTab({ server: ServerConnection.Key.make(ref.server), sessionId: ref.sessionId }))

        if (ctx && info) ctx.projects.touch(ctx.projects.forSession(info)?.worktree ?? info.location.directory)
      })
    }

    const groupName = (number: number) => language.t("tabs.groups.unnamed", { number })

    const groups = () => state.items.filter((item): item is PinGroup => item.type === "group")

    // A pin, a group, or a tab being dragged: pins and tabs sort as one list, and where the drop lands relative to the
    // pinned area decides whether it's pinned, where, and in which group.
    const [drag, setDrag] = createStore<{ source: PinDragSource | undefined; target: PinTarget | undefined }>({
      source: undefined,
      target: undefined,
    })

    // A drag starts from a sortable id: a pinned row's or group's, or a tab's key.
    const dragStart = (id: string) => {
      const tab = tabs.store.find((item) => tabKey(item) === id)
      const ref = tab ? refOf(tab) : undefined
      const source = pinDragSourceOf(id) ?? (ref ? { kind: "session" as const, ref } : undefined)

      if (source) setDrag({ source, target: undefined })
    }

    const dragMove = (point: { x: number; y: number }) => {
      const source = drag.source

      if (!source) return
      const target = pinDropTarget(point, source)

      setDrag("target", target === "outside" ? undefined : target)
    }

    // Drops the drag at `point`. Returns whether the pins took it, so a tab strip skips its own reorder.
    const dragEnd = (point: { x: number; y: number } | undefined) => {
      const source = drag.source

      setDrag({ source: undefined, target: undefined })

      if (!source || !point) return false
      const target = pinDropTarget(point, source)

      if (target !== "outside") {
        if (source.kind === "group") {
          if (!target.group) apply((value) => moveGroup(value, source.id, target.index))

          return true
        }

        apply((value) => place(value, source.ref, target))

        return true
      }

      if (source.kind !== "session" || !isPinned(state, source.ref)) return false
      unpinTo(source.ref, stripDropBefore(point))

      return true
    }

    // Unpins a session dropped among the tabs, opening its tab there if it had none.
    const unpinTo = (ref: PinRef, before: string | undefined) => {
      const key = keyOf(ref)

      apply((value) => unpin(value, ref))

      if (!tabs.store.some((tab) => tabKey(tab) === key)) {
        // List shows every session, so an unpinned one is already in Recent; Tabs needs its tab back.
        if (settings.appearance.navigation() === "list") return
        tabs.addSessionTab({ server: ServerConnection.Key.make(ref.server), sessionId: ref.sessionId })

        return
      }

      const rest = tabs.store.map(tabKey).filter((item) => item !== key)
      const index = before ? rest.indexOf(before) : -1

      tabs.reorder(index === -1 ? [...rest, key] : rest.toSpliced(index, 0, key))
    }

    // With nothing pinned, a drag slides the pinned area's header and divider in, to drag past; they stay a moment
    // after the drag so they can animate away.
    const [preview, setPreview] = createSignal<"open" | "closing" | undefined>()

    createEffect(() => {
      if (drag.source) return setPreview("open")

      if (!untrack(preview)) return
      setPreview("closing")
      const timer = setTimeout(() => setPreview(undefined), 180)

      onCleanup(() => clearTimeout(timer))
    })

    // Every sortable row the pinned area renders, in order: loose pins, and each group followed by its visible rows.
    const sortables = createMemo(() =>
      state.items.flatMap((item) =>
        item.type === "session" ? [sessionKey(item)] : [`group:${item.id}`, ...visible(item).map(sessionKey)],
      ),
    )

    return {
      ready,
      state,
      now: createMinuteClock(),
      drag,
      dragging: () => !!drag.source,
      preview,
      sortables,
      dragStart,
      dragMove,
      dragEnd,
      groups,
      refOf,
      session,
      isCurrent,
      visible,
      keyOf,
      keys,
      open,
      /** Closes a pinned session the way a browser closes a pinned tab: its tab goes, and so does the pin. */
      close: (ref: PinRef) => {
        const index = tabs.store.findIndex((tab) => {
          const item = refOf(tab)

          return !!item && item.server === ref.server && item.sessionId === ref.sessionId
        })

        apply((value) => unpin(value, ref))

        if (index !== -1) tabs.closeTab(index)
      },
      openKey: (key: string) => {
        const ref = state.items
          .flatMap((item) => (item.type === "session" ? [item] : item.sessions))
          .find((item) => keyOf(item) === key)

        if (ref) open(ref)
      },
      currentKey: () => {
        const ref = current()

        return ref && isPinned(state, ref) ? keyOf(ref) : undefined
      },
      /** Whether an open tab is shown in the pinned area instead of among the unpinned tabs. */
      holds: (tab: Tab) => {
        const ref = refOf(tab)

        return !!ref && isPinned(state, ref)
      },
      pinned: (ref: PinRef) => isPinned(state, ref),
      groupOf: (ref: PinRef) => groupOf(state, ref),
      unread: (key: string) => !!local.unread[key],
      hiddenMark,
      setUnread: (key: string, value: boolean) => setLocal("unread", key, value),
      pin: (ref: PinRef) => apply((value) => pin(value, ref)),
      unpin: (ref: PinRef) => apply((value) => unpin(value, ref)),
      newGroup: (ref: PinRef) => {
        const existing = groups().map((group) => ({ id: group.id, name: group.name, color: group.color }))
        const taken = new Set(existing.map((group) => group.name))

        const number = Array.from({ length: existing.length + 1 }, (_, index) => index + 1).find(
          (value) => !taken.has(groupName(value)),
        )

        apply((value) =>
          createGroup(value, ref, {
            id: uuid(),
            name: groupName(number ?? existing.length + 1),
            color: nextManualGroupColor(existing),
          }),
        )
      },
      moveToGroup: (ref: PinRef, id: string) => apply((value) => moveToGroup(value, ref, id)),
      removeFromGroup: (ref: PinRef) => apply((value) => removeFromGroup(value, ref)),
      ungroup: (id: string) => apply((value) => ungroup(value, id)),
      unpinGroup: (id: string) => apply((value) => unpinGroup(value, id)),
      rename: (id: string, name: string) => apply((value) => updateGroup(value, id, { name })),
      recolor: (id: string, color: TabGroupColor) => apply((value) => updateGroup(value, id, { color })),
      toggle: (id: string) => apply((value) => toggleGroup(value, id)),
    }
  },
})

/**
 * Feeds the tab strip so pinned sessions share the ⌘1–9 numbers with the tabs after them. Side tabs render the pinned
 * area inside the strip's scroll; top tabs keep it outside, fixed while the tabs scroll (see `PinnedArea`).
 */
export function createPinnedLeading(orientation: Orientation): () => TabStripLeading | undefined {
  const pins = usePins()

  const settings = useSettings()

  // Built once here, so it only renders while the experiment is on.
  const content = (
    <Show when={settings.appearance.navigationPrototype()}>
      <PinnedArea orientation={orientation} divider={orientation === "vertical"} />
    </Show>
  )

  return () =>
    pins.state.items.length === 0 && !pins.preview()
      ? undefined
      : {
          content,
          sortables: pins.sortables().length,
          keys: pins.keys(),
          unread: pins.unread,
          navigate: pins.openKey,
        }
}

/**
 * Pinned sessions and groups. Side layouts label it Pinned; side tabs (`divider`) end it with a divider before the
 * unpinned tabs, while List follows it with its own Recent section. Top tabs set it between two short dividers.
 */
export function PinnedArea(props: { orientation: Orientation; divider?: boolean; detail?: boolean }) {
  const pins = usePins()
  const tabs = useTabs()
  const language = useLanguage()
  const empty = () => pins.state.items.length === 0

  return (
    <div
      data-component="pinned-area"
      data-orientation={props.orientation}
      data-preview={empty() ? pins.preview() : undefined}
      class="flex shrink-0"
      classList={{
        // The titlebar row drags the window; like the tab strip, the pinned area has to opt out to take clicks.
        "flex-row items-center gap-1 [app-region:no-drag]": props.orientation === "horizontal",
        "w-full flex-col gap-[3px]": props.orientation === "vertical",
        // In List, Recent's heading follows; leave room so the two sections read as separate.
        "pb-4": props.orientation === "vertical" && !props.divider,
      }}
    >
      {/* With nothing pinned, a drag shows only the divider; the header appears once the drag crosses it. */}
      <Show
        when={props.orientation === "vertical"}
        fallback={
          <Show when={!empty()}>
            <div role="separator" aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-v2-border-border-muted" />
          </Show>
        }
      >
        <Show when={!empty() || pins.drag.target}>
          <SectionLabel label={language.t("sidebar.recent.pinned")} />
        </Show>
      </Show>
      <Key each={pins.state.items} by={(item) => (item.type === "session" ? pinKey(item) : `group:${item.id}`)}>
        {(item) => (
          <Switch>
            <Match when={sessionItem(item())}>
              {(ref) => <PinnedSession pin={ref()} orientation={props.orientation} detail={props.detail} />}
            </Match>
            <Match when={groupItem(item())}>
              {(group) => <PinnedGroupView group={group()} orientation={props.orientation} detail={props.detail} />}
            </Match>
          </Switch>
        )}
      </Key>
      <Show
        when={props.orientation === "horizontal"}
        fallback={
          <Show when={props.divider && (pins.preview() || tabs.store.some((tab) => !pins.holds(tab)))}>
            <div role="separator" aria-hidden="true" class="mx-2 my-3 h-px shrink-0 bg-v2-border-border-muted" />
          </Show>
        }
      >
        <div role="separator" aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-v2-border-border-muted" />
      </Show>
    </div>
  )
}

/** A pinned row or group sorts in the strip's drag list (or List's), numbered by its place among the pinned rows. */
function usePinSortable(key: () => string, type: "pin" | "pin-group") {
  const pins = usePins()

  return useSortable({
    get id() {
      return key()
    },
    get index() {
      return pins.sortables().indexOf(key())
    },
    group: "tab-items",
    type,
    // Groups never nest: a group sorts among the pins, and sessions sort anywhere in them.
    accept: (source: { type?: unknown }) => (type === "pin-group" ? source.type === "pin-group" : source.type !== "pin-group"),
  })
}

// Renaming or recoloring a group replaces its object, so these unwrap the live item instead of keying on it, which
// would remount the group and close its menu mid-edit.
function sessionItem(item: PinsState["items"][number]) {
  return item.type === "session" ? item : undefined
}

function groupItem(item: PinsState["items"][number]) {
  return item.type === "group" ? item : undefined
}

function SectionLabel(props: { label: string; class?: string }) {
  return (
    <div
      class={`flex h-6 shrink-0 items-center px-2 text-[13px] leading-[var(--line-height-compact)] font-medium text-v2-text-text-muted ${props.class ?? ""}`}
    >
      <span class="min-w-0 truncate">{props.label}</span>
    </div>
  )
}

function PinnedGroupView(props: {
  group: PinGroup
  orientation: Orientation
  detail?: boolean
}) {
  const pins = usePins()
  const language = useLanguage()
  const [menu, setMenu] = createStore({ open: false })

  const overlayFocus = createOverlayFocus()
  const open = () => !pins.state.collapsed[props.group.id]
  const sortable = usePinSortable(() => groupKey(props.group.id), "pin-group")

  // A session held over a closed group drops into it, so the group lights up like a folder row.
  const into = () =>
    pins.drag.source?.kind === "session" && pins.drag.target?.group === props.group.id && pins.visible(props.group).length === 0

  const trigger = (
    <button
      type="button"
      data-slot="pinned-group-trigger"
      data-group-color={props.group.color}
      aria-expanded={open()}
      aria-label={props.group.name}
      class="flex shrink-0 items-center rounded-[6px] focus-visible:-outline-offset-2"
      classList={{
        "size-7 justify-center hover:bg-v2-overlay-simple-overlay-hover": props.orientation === "horizontal",
        "h-7 w-full gap-2 ps-2 pe-8 text-start group-hover/row:bg-v2-overlay-simple-overlay-hover":
          props.orientation === "vertical",
      }}
      onClick={() => pins.toggle(props.group.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        overlayFocus.openChanged(true)
        setMenu("open", true)
      }}
    >
      <span class="relative flex shrink-0">
        <GroupSquare color={props.group.color} />
        <Show when={pins.hiddenMark(props.group)}>
          {(value) => <span data-slot="pinned-group-mark" data-mark={value()} aria-hidden="true" />}
        </Show>
      </span>
      <Show when={props.orientation === "vertical"}>
        <span
          dir="auto"
          data-slot="pinned-group-label"
          class="min-w-0 truncate text-[13px] leading-[var(--line-height-compact)] font-medium"
        >
          {props.group.name}
        </span>
        <Icon
          name="fill-triangle-down"
          class="shrink-0 text-v2-icon-icon-muted opacity-0 transition-[transform,opacity] group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none"
          classList={{ "-rotate-90 rtl:rotate-90": !open() }}
        />
      </Show>
    </button>
  )

  return (
    <div
      data-component="pinned-group"
      data-orientation={props.orientation}
      data-group-color={props.group.color}
      data-pin-item={`group:${props.group.id}`}
      data-pin-group={props.group.id}
      data-drop={into() ? "into" : undefined}
      ref={sortable.ref}
      class="relative flex shrink-0"
      classList={{
        "flex-row items-center gap-1": props.orientation === "horizontal",
        "w-full flex-col gap-[3px]": props.orientation === "vertical",
      }}
    >
      <Menu
        modal={false}
        gutter={4}
        placement={props.orientation === "vertical" ? "bottom-end" : "bottom-start"}
        open={menu.open}
        onOpenChange={(value) => {
          overlayFocus.openChanged(value)
          setMenu("open", value)
        }}
      >
        {/* Side tabs open the menu from a ⋯ at the row's end too; right-click opens it in both layouts. */}
        <Show
          when={props.orientation === "horizontal"}
          fallback={
            <div data-slot="pinned-group-row" class="group/row relative flex w-full">
              {trigger}
              <Menu.Trigger
                as={IconButton}
                variant="ghost-muted"
                size="small"
                icon={<Icon name="outline-dots" />}
                aria-label={language.t("navigation.group.options")}
                data-slot="pinned-group-options"
                class="absolute inset-y-0 end-1 my-auto opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                classList={{ "!opacity-100": menu.open }}
              />
            </div>
          }
        >
          <Menu.Trigger as="span" aria-hidden="true" disabled class="pointer-events-none absolute size-px" />
          <Tooltip placement="bottom" value={props.group.name} class="flex shrink-0">
            {trigger}
          </Tooltip>
        </Show>
        <Menu.Portal>
          <Menu.Content class="w-48" onCloseAutoFocus={(event) => overlayFocus.restore(event)}>
            <GroupEditor group={props.group} />
            <Menu.Separator />
            <Menu.Item onSelect={() => pins.ungroup(props.group.id)}>{language.t("tabs.groups.ungroup")}</Menu.Item>
            <Menu.Item onSelect={() => pins.unpinGroup(props.group.id)}>
              {language.t("navigation.group.unpin")}
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
      {/* Side tabs indent a group's sessions to its label, under a line from its square; top tabs keep them inline
          inside the group's border. */}
      <div
        data-slot="pinned-group-sessions"
        classList={{
          "relative flex flex-col gap-[3px] ps-6": props.orientation === "vertical",
          contents: props.orientation === "horizontal",
        }}
      >
        <For each={pins.visible(props.group)}>
          {(ref) => (
            <PinnedSession pin={ref} orientation={props.orientation} detail={props.detail} grouped />
          )}
        </For>
      </div>
    </div>
  )
}

/** The group's name, in the same bare field as the new session project search, then its color as a radio list. */
function GroupEditor(props: { group: PinGroup }) {
  const pins = usePins()
  const language = useLanguage()

  return (
    <>
      <div data-slot="pinned-group-name" onKeyDown={(event) => event.stopPropagation()}>
        <TextInput
          appearance="large"
          dir="auto"
          autocomplete="off"
          spellcheck={false}
          value={props.group.name}
          placeholder={language.t("tabs.groups.name.placeholder")}
          aria-label={language.t("tabs.groups.name.placeholder")}
          leadingIcon={<GroupSquare color={props.group.color} />}
          onFocusIn={(event) => event.stopPropagation()}
          onInput={(event) => pins.rename(props.group.id, event.currentTarget.value)}
        />
      </div>
      <Menu.Separator />
      <Menu.RadioGroup
        value={props.group.color}
        onChange={(color) => {
          const next = AUTO_TAB_GROUP_COLORS.find((item) => item === color)

          if (next) pins.recolor(props.group.id, next)
        }}
        aria-label={language.t("tabs.groups.color")}
      >
        <For each={AUTO_TAB_GROUP_COLORS}>
          {(color) => (
            <Menu.RadioItem value={color}>
              <GroupSquare color={color} />
              {language.t(`tabs.groups.color.${color}`)}
            </Menu.RadioItem>
          )}
        </For>
      </Menu.RadioGroup>
    </>
  )
}

/** A group's marker everywhere it shows: a small square of its color, styled like a project avatar. */
export function GroupSquare(props: { color: TabGroupColor }) {
  return <span data-slot="pinned-group-rect" data-group-color={props.color} aria-hidden="true" />
}

function PinnedSession(props: {
  pin: PinRef
  orientation: Orientation
  grouped?: boolean
  detail?: boolean
}) {
  const pins = usePins()
  const dialog = useDialog()
  const language = useLanguage()
  const sortable = usePinSortable(() => sessionKey(props.pin), "pin")
  const server = () => ServerConnection.Key.make(props.pin.server)
  const key = () => pins.keyOf(props.pin)
  const session = () => pins.session(props.pin)
  const global = useGlobal()

  const status = useSessionTabAvatarState(
    server,
    () => props.pin.sessionId,
    () => true,
    session,
  )

  const muted = () => global.sessionPreferences.muted(props.pin.server, props.pin.sessionId)
  const unread = createMemo(() => status.unread() && !status.loading() && !muted())

  createEffect(() => pins.setUnread(key(), unread()))

  // A permission asked before this window connected only shows once loaded, as for an unselected tab.
  createEffect(() => {
    const ctx = global.serverCtx(server())

    if (!ctx || pins.isCurrent(props.pin) || !status.loading() || ctx.sdk.connection.status() !== "connected") return
    syncInactiveSession(ctx, props.pin.sessionId)
  })

  // List's metadata: what the session is doing when it needs you or runs, otherwise how long ago it was updated.
  const meta = () => {
    if (!props.detail) return

    if (status.attention()) return language.t("sidebar.recent.meta.attention")

    if (status.loading()) return language.t("sidebar.recent.meta.working")
    const info = session()

    return info ? sessionAge(language, pins.now(), info.time.updated ?? info.time.created) : undefined
  }

  const shortcut = () => {
    const index = pins.keys().indexOf(key())

    return index !== -1 && index < 9 ? index + 1 : undefined
  }

  const remove = () => {
    const ctx = global.serverCtx(server())
    const info = session()

    if (!ctx || !info) return
    const ids = sessionTreeIDs(ctx.data.session.list(), info.id)

    void ctx.data.session
      .remove(info.id)
      .then(() => notifySessionTabsRemoved({ server: server(), directory: info.location.directory, sessionIDs: ids }))
      .catch((cause) =>
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(cause, language.t("session.delete.failed.title")),
        }),
      )
  }

  return (
    <div
      data-titlebar-tab-slot
      data-pinned-slot
      data-orientation={props.orientation}
      data-active={pins.isCurrent(props.pin)}
      data-pin-item={props.grouped ? undefined : sessionKey(props.pin)}
      data-pin-group-row={props.grouped ? sessionKey(props.pin) : undefined}
      ref={sortable.ref}
      class="relative flex shrink-0"
      classList={{ "w-7": props.orientation === "horizontal", "w-full": props.orientation === "vertical" }}
    >
      <TabNavItem
        href={tabHref({ type: "session", server: server(), sessionId: props.pin.sessionId })}
        server={server()}
        session={session()}
        preparing={false}
        muted={muted()}
        label={meta()}
        detail={props.detail ? <SessionDetail server={props.pin.server} session={session()} /> : undefined}
        unread={unread()}
        attention={status.attention()}
        loading={status.loading()}
        shortcut={shortcut()}
        onNavigate={() => pins.open(props.pin)}
        active={pins.isCurrent(props.pin)}
        orientation={props.orientation}
        menuItems={() => <PinMenuItems pin={props.pin} />}
        onClose={() => pins.close(props.pin)}
        onDelete={() =>
          dialog.show(() => (
            <DeleteSessionDialog
              title={sessionTabTitle(session()?.title, language.t("command.session.new"))}
              onConfirm={remove}
            />
          ))
        }
      />
    </div>
  )
}

/** Pin, unpin and group items, for pinned sessions and for an unpinned tab's menu. */
export function PinMenuItems(props: { pin: PinRef }) {
  const pins = usePins()
  const language = useLanguage()
  const group = () => pins.groupOf(props.pin)

  return (
    <>
      <Menu.Item onSelect={() => (pins.pinned(props.pin) ? pins.unpin(props.pin) : pins.pin(props.pin))}>
        {language.t(pins.pinned(props.pin) ? "sidebar.recent.unpin" : "sidebar.recent.pin")}
      </Menu.Item>
      <Menu.Sub gutter={4} overflowPadding={16} overlap>
        <Menu.SubTrigger class="[&_[data-slot=menu-v2-item-chevron]]:text-v2-icon-icon-muted">
          <span>{language.t("tabs.groups.addToGroup")}</span>
        </Menu.SubTrigger>
        <Menu.Portal>
          <Menu.SubContent class="min-w-[164px]">
            <Menu.Item onSelect={() => pins.newGroup(props.pin)}>
              <Icon name="plus" />
              <span>{language.t("tabs.groups.new")}</span>
            </Menu.Item>
            <Show when={pins.groups().length > 0}>
              <Menu.Separator />
            </Show>
            <For each={pins.groups()}>
              {(item) => (
                <Menu.CheckboxItem
                  closeOnSelect
                  checked={group()?.id === item.id}
                  onChange={(checked) =>
                    checked ? pins.moveToGroup(props.pin, item.id) : pins.removeFromGroup(props.pin)
                  }
                >
                  <span class="flex size-4 shrink-0 items-center justify-center">
                    <GroupSquare color={item.color} />
                  </span>
                  <span class="min-w-0 truncate" dir="auto">
                    {item.name}
                  </span>
                </Menu.CheckboxItem>
              )}
            </For>
            <Show when={group()}>
              <Menu.Separator />
              <Menu.Item onSelect={() => pins.removeFromGroup(props.pin)}>
                <span>{language.t("tabs.groups.removeFromGroup")}</span>
              </Menu.Item>
            </Show>
          </Menu.SubContent>
        </Menu.Portal>
      </Menu.Sub>
    </>
  )
}
