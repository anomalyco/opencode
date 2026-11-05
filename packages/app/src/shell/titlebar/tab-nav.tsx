import { createEffect, createMemo, createSignal, onCleanup, Show, untrack, type Ref } from "solid-js"
import { createStore } from "solid-js/store"
import { Predicate } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { useServerCtx } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { displayName } from "@opencode/ui/project-avatar"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import type { SessionInfo } from "@opencode/client/promise"
import { showToast } from "@/shell/notifications/toast"
import { sessionLastRunLabel, sessionTabTitle } from "./tab-title"
import { createSessionBranches } from "./session-branches"
import { pathKey } from "@/workspaces/path-key"
import { TabPreviewPopover } from "./tab-popover"
import {
  INITIAL_TAB_RENAME_STATE,
  isTabRenaming,
  selectTabMenuOpen,
  selectTabPreviewBlocked,
  transitionTabRename,
  type TabRenameEffect,
  type TabRenameEvent,
  type TabRenameSource,
} from "./tab-rename-machine"
import "./tab-nav.css"

// MouseEvent.button uses 1 for the middle/wheel button.
const MIDDLE_MOUSE_BUTTON = 1

export type TabCloseActions = {
  onClose: () => void
  onCloseOthers?: () => void
  onCloseAfter?: () => void
}

function TabCloseMenuItems(props: TabCloseActions & { orientation?: "horizontal" | "vertical"; label?: string }) {
  const language = useLanguage()

  return (
    <>
      <Menu.Item onSelect={props.onClose}>{props.label ?? language.t("common.closeTab")}</Menu.Item>
      <Show when={props.label === undefined}>
        <Menu.Item disabled={!props.onCloseOthers} onSelect={props.onCloseOthers}>
          {language.t("common.closeOtherTabs")}
        </Menu.Item>
        <Menu.Item disabled={!props.onCloseAfter} onSelect={props.onCloseAfter}>
          {language.t(
            props.orientation === "vertical"
              ? "common.closeTabsBelow"
              : language.direction() === "rtl"
                ? "common.closeTabsToLeft"
                : "common.closeTabsToRight",
          )}
        </Menu.Item>
      </Show>
    </>
  )
}

export function TabNavItem(
  props: TabCloseActions & {
    ref?: Ref<HTMLDivElement>
    href: string
    server: ServerConnection.Key
    session: SessionInfo | undefined
    preparing: boolean
    unread: boolean
    attention: boolean
    loading: boolean
    fallbackTitle?: string
    fallbackDirectory?: string
    /** Shows a title at once: the optimistic one, or the one to restore when its save fails. */
    onRememberTitle: (sessionID: string, title: string | undefined) => void
    onSaveTitle: (sessionID: string, title: string, signal: AbortSignal) => Promise<void>
    closable?: boolean
    closeLabel?: string
    closeMenuLabel?: string
    showSessionDetails?: boolean
    onDelete: () => void
    onNavigate: () => void
    active?: boolean
    suppressNavigation?: boolean
    dragging?: boolean
    pressed?: boolean
    hidden?: boolean
    orientation?: "horizontal" | "vertical"
  },
) {
  const language = useLanguage()
  const [renameState, setRenameState] = createSignal(INITIAL_TAB_RENAME_STATE)
  const editing = () => isTabRenaming(renameState())
  const [titleOverflowing, setTitleOverflowing] = createSignal(false)
  let tabRoot!: HTMLDivElement
  let titleEl!: HTMLSpanElement
  let measureFrame: number | undefined
  let armFrame: number | undefined
  const saves = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (props.closable === false) return
    props.onClose()
  }

  const servers = useServers()
  const serverCtx = useServerCtx(() => servers.list.find((item) => ServerConnection.key(item) === props.server))

  // The project icon stays put; status shows where the close button appears on hover.
  const status = () => {
    if (props.preparing || props.loading) return "busy"

    if (!props.session || props.active) return

    if (props.attention) return "attention"

    if (props.unread) return "unread"
  }

  const dotted = () => status() === "attention" || status() === "unread"

  const project = createMemo(() => {
    const session = props.session

    if (session) return serverCtx()?.projects.forSession(session)

    if (!props.fallbackDirectory) return

    return serverCtx()?.projects.forDirectory(props.fallbackDirectory) ?? { worktree: props.fallbackDirectory }
  })

  const title = createMemo(() => {
    const session = props.session

    return sessionTabTitle(session ? session.title : props.fallbackTitle, language.t("session.tab.session"))
  })

  const projectName = createMemo(() => {
    const session = props.session

    if (!session) return

    return displayName(project() ?? { worktree: session.location.directory })
  })

  const previewPath = createMemo(() => {
    const session = props.session

    if (!session) return
    const home = serverCtx()?.sync.data.path.home
    const directory = session.location.directory

    if (!home || !directory.startsWith(home) || !/^([/\\]|$)/.test(directory.slice(home.length))) return directory

    return "~" + directory.slice(home.length)
  })

  // Only label the server when multiple servers are connected, and never the current one.
  const serverLabel = createMemo(() => {
    if (servers.list.length <= 1) return
    const conn = servers.list.find((item) => ServerConnection.key(item) === props.server)

    return conn ? servers.tag(conn) : undefined
  })

  // Like the TUI, a prompt sent to a background tab's session pulses the tab once.
  const [promptPulse, setPromptPulse] = createSignal(0)
  createEffect(() => {
    const data = serverCtx()?.data
    const sessionID = props.session?.id

    if (!data || !sessionID) return
    onCleanup(
      data.on("session.inbox.enqueued", (event) => {
        if (props.active || event.data.item.type !== "user" || data.session.root(event.data.sessionID) !== sessionID)
          return
        setPromptPulse((count) => count + 1)
      }),
    )
  })

  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const branches = createSessionBranches()
  const branchEntry = () => {
    if (!props.showSessionDetails) return
    const ctx = serverCtx()
    const session = props.session
    return ctx && session ? { ctx, session, server: props.server } : undefined
  }
  createEffect(() => {
    if (!popoverOpen()) return
    const entry = branchEntry()
    if (entry) branches.load([entry])
  })
  const branch = () => {
    const entry = branchEntry()
    return entry && branches.branch(entry)
  }
  const worktree = createMemo(() => {
    if (!props.showSessionDetails) return
    const value = project()
    const directory = props.session?.location.directory
    if (!value || !directory || !("sandboxes" in value)) return
    const key = pathKey(directory)
    return (
      value.sandboxes
        .filter((root) => key === pathKey(root) || key.startsWith(`${pathKey(root)}/`))
        .toSorted((a, b) => b.length - a.length)[0] ?? value.worktree
    )
  })

  const previewBlocked = () =>
    !!props.dragging || selectTabPreviewBlocked(renameState()) || !!props.pressed || !props.session

  const measureTitleOverflow = () => {
    if (!titleEl || editing()) {
      setTitleOverflowing(false)

      return
    }

    setTitleOverflowing(titleEl.scrollWidth > titleEl.clientWidth)
  }

  const scheduleTitleOverflow = () => {
    if (measureFrame !== undefined) return
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined
      measureTitleOverflow()
    })
  }

  createEffect(() => {
    title()
    props.active
    props.orientation
    editing()
    scheduleTitleOverflow()
  })

  // The overflow fade changes title padding; observe the stable tab box, not that feedback.
  createResizeObserver(() => tabRoot, scheduleTitleOverflow)
  onCleanup(() => {
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
  })

  const selectTitle = () => {
    const range = document.createRange()
    range.selectNodeContents(titleEl)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const focusTitle = (select: boolean) => {
    titleEl.focus()

    if (select) selectTitle()
  }

  const dispatchRename = (event: TabRenameEvent) => {
    const previous = untrack(renameState)
    const next = transitionTabRename(previous, event)

    if (next.state !== previous) setRenameState(next.state)
    next.effects.forEach(runRenameEffect)
  }

  function runRenameEffect(effect: TabRenameEffect) {
    if (effect.type === "editor.arm") {
      titleEl.textContent = effect.text

      if (effect.source === "pointer") {
        focusTitle(true)

        return armAfter(effect.attempt, 1)
      }

      // A menu pick arms from `onCloseAutoFocus`; two frames on, it arms anyway in case the menu closed without it.
      return armAfter(effect.attempt, 2)
    }

    if (effect.type === "editor.disarm") return disarm()

    if (effect.type === "editor.reset") {
      titleEl.scrollLeft = 0

      return
    }

    if (effect.type === "session.remember") return props.onRememberTitle(effect.sessionID, effect.title)

    if (effect.type === "save.start") {
      const attempt = effect.attempt
      const controller = new AbortController()

      const timer = setTimeout(
        () => dispatchRename({ type: "save.timed-out", attempt, currentTitle: props.session?.title }),
        effect.timeoutMs,
      )

      saves.set(attempt, { controller, timer })
      void props.onSaveTitle(effect.sessionID, effect.title, controller.signal).then(
        () => {
          clearSave(attempt)
          dispatchRename({ type: "save.succeeded", attempt, title: effect.title })
        },
        (error) => {
          clearSave(attempt)

          // Only a timeout aborts a save, and the machine already left it.
          if (controller.signal.aborted) return
          dispatchRename({ type: "save.failed", attempt, currentTitle: props.session?.title, error })
        },
      )

      return
    }

    if (effect.type === "save.abort") {
      saves.get(effect.attempt)?.controller.abort()

      return clearSave(effect.attempt)
    }

    // A committed save keeps going when the tab unmounts, as when the tab layout changes.
    if (effect.type === "save.clear-timers") return [...saves.keys()].forEach(clearSave)

    showToast({
      title: language.t("common.requestFailed"),
      description: effect.error instanceof Error ? effect.error.message : undefined,
    })
  }

  function clearSave(attempt: number) {
    clearTimeout(saves.get(attempt)?.timer)
    saves.delete(attempt)
  }

  // After the attempt's frames the title holds focus, so a blur ends the edit from then on.
  function armAfter(attempt: number, frames: number) {
    disarm()
    armFrame = requestAnimationFrame(() => {
      armFrame = undefined

      if (frames > 1) return armAfter(attempt, frames - 1)
      const current = untrack(renameState)

      if (current.status !== "arming" || current.attempt !== attempt) return

      if (document.activeElement !== titleEl) focusTitle(!current.edited)
      dispatchRename({ type: "edit.armed", attempt })
    })
  }

  function disarm() {
    if (armFrame !== undefined) cancelAnimationFrame(armFrame)
    armFrame = undefined
  }

  const startRename = (source: TabRenameSource) =>
    dispatchRename({
      type: "edit.start",
      source,
      sessionID: props.session?.id,
      title: props.session?.title ?? "",
      enabled: !props.dragging,
    })

  // Reads the title's text first, so the machine saves what the field shows.
  const endRename = (type: "edit.submit" | "edit.blur") => {
    dispatchRename({ type: "edit.input", value: titleEl.textContent ?? "" })
    dispatchRename({ type, currentTitle: props.session?.title })
  }

  createEffect(() => {
    const sessionID = props.session?.id
    untrack(() => dispatchRename({ type: "session.changed", sessionID }))
  })

  onCleanup(() => dispatchRename({ type: "disposed" }))

  createEffect(() => {
    if (editing()) return

    if (!titleEl) return
    const value = title()

    if (value === undefined) return
    titleEl.textContent = value
  })

  createEffect(() => {
    if (!editing()) return

    const cleanup = makeEventListener(
      document,
      "pointerdown",
      (event) => {
        const target = event.target

        if (!(target instanceof Node)) return

        if (tabRoot.contains(target)) return
        endRename("edit.submit")
      },
      { capture: true },
    )

    onCleanup(cleanup)
  })

  const tab = () => (
    <div
      ref={(el) => {
        tabRoot = el

        if (Predicate.isFunction(props.ref)) props.ref(el)
      }}
      data-titlebar-tab
      data-slot="titlebar-tab-item"
      data-orientation={props.orientation ?? "horizontal"}
      data-title-overflow={titleOverflowing()}
      data-editing={editing()}
      class="group relative flex h-7 w-full min-w-0 select-none flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] px-1.5 [container-type:inline-size]"
      classList={{ invisible: props.hidden }}
      data-active={props.active}
      data-status={status()}
      data-dragging={props.dragging}
      data-state={props.active || props.pressed ? "pressed" : undefined}
      onMouseDown={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onAuxClick={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        closeTab(event)
      }}
    >
      <Show when={promptPulse()} keyed>
        <span data-slot="tab-prompt-pulse" aria-hidden="true" onAnimationEnd={() => setPromptPulse(0)} />
      </Show>
      <Menu.Context.Trigger
        as="a"
        disabled={editing() || props.dragging}
        aria-haspopup="menu"
        aria-expanded={selectTabMenuOpen(renameState())}
        data-slot="tab-link"
        data-titlebar-tab-link
        href={props.href}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onMouseDown={(event) => {
          // Navigate on mousedown to shave the press-release delay off tab switches.
          if (event.button !== 0) return

          if (editing()) return

          if (props.suppressNavigation) return
          props.onNavigate()
        }}
        onClick={(event) => {
          event.preventDefault()

          // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
          if (event.detail > 0) return

          if (editing()) return

          if (props.suppressNavigation) return
          props.onNavigate()
        }}
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base group-data-[editing='true']:text-v2-text-text-base [-webkit-user-drag:none]"
      >
        <span data-slot="project-avatar-slot" class="flex size-4 shrink-0 items-center justify-center">
          <Show
            when={props.session?.location.directory ?? props.fallbackDirectory}
            fallback={
              <span class="block size-4 rounded-[3px] border border-v2-border-border-muted" aria-hidden="true" />
            }
          >
            {(directory) => <SessionTabAvatarView project={project()} directory={directory()} unread={false} />}
          </Show>
          <Show when={dotted()}>
            <span data-slot="tab-avatar-unread-dot" aria-hidden="true" />
          </Show>
        </span>
        <span
          ref={(el) => {
            titleEl = el
            titleEl.textContent = title() ?? ""
          }}
          data-slot="tab-title"
          data-titlebar-tab-title
          dir="auto"
          class="min-w-0 flex-1 outline-none leading-4"
          classList={{
            "overflow-hidden text-clip whitespace-nowrap": !editing(),
            "select-text": editing(),
          }}
          contenteditable={editing() ? "plaintext-only" : undefined}
          onDblClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            startRename("pointer")
          }}
          onKeyDown={(event) => {
            event.stopPropagation()

            if (event.key === "Enter") {
              event.preventDefault()
              endRename("edit.submit")

              return
            }

            if (event.key !== "Escape") return
            event.preventDefault()
            dispatchRename({ type: "edit.cancel" })
          }}
          onInput={() => dispatchRename({ type: "edit.input", value: titleEl.textContent ?? "" })}
          onBlur={() => endRename("edit.blur")}
          onPointerDown={(event) => {
            if (!editing()) return
            event.stopPropagation()
          }}
          onClick={(event) => {
            if (!editing()) return
            event.preventDefault()
          }}
        />
      </Menu.Context.Trigger>

      <div data-slot="tab-close">
        <span data-slot="tab-status" aria-hidden="true">
          <ActivityRing data-mark="busy" />
          <span data-mark="attention" data-slot="tab-status-dot" />
          <span data-mark="unread" data-slot="tab-status-dot" />
        </span>
        <Show when={props.closable !== false}>
          <IconButton
            size="small"
            variant="ghost-muted"
            class="hover-reveal relative z-10"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={closeTab}
            icon={<Icon name="xmark-small" />}
            aria-label={props.closeLabel ?? language.t("common.closeTab")}
          />
        </Show>
      </div>
    </div>
  )

  return (
    <Menu.Context
      modal={false}
      onOpenChange={(open) => {
        dispatchRename({ type: "menu.changed", open })

        if (open) setPopoverOpen(false)
      }}
    >
      <TabPreviewPopover
        trigger={tab()}
        orientation={props.orientation}
        open={popoverOpen() && !previewBlocked()}
        onOpenChange={(value) => {
          if (value && previewBlocked()) return
          setPopoverOpen(value)
        }}
        data={{
          projectName: projectName(),
          title: props.session?.title,
          path: previewPath(),
          serverName: serverLabel(),
          lastRun: props.showSessionDetails ? sessionLastRunLabel(props.session?.time, language) : undefined,
          branch: branch(),
          worktree: worktree(),
        }}
      />
      <Menu.Context.Portal>
        <Menu.Context.Content
          onCloseAutoFocus={(event) => {
            // The title, not the trigger, takes focus while renaming.
            const current = untrack(renameState)

            if (!isTabRenaming(current)) return
            event.preventDefault()

            if (current.status !== "arming") return
            focusTitle(!current.edited)
            armAfter(current.attempt, 1)
          }}
        >
          <Menu.Item disabled={!props.session} onSelect={() => startRename("menu")}>
            {language.t("common.rename")}
          </Menu.Item>
          <Show when={props.closable !== false}>
            <TabCloseMenuItems
              orientation={props.orientation}
              label={props.closeMenuLabel}
              onClose={props.onClose}
              onCloseOthers={props.onCloseOthers}
              onCloseAfter={props.onCloseAfter}
            />
          </Show>
          <Menu.Separator />
          <Menu.Item data-variant="critical" disabled={!props.session} onSelect={props.onDelete}>
            {language.t("session.delete.title")}…
          </Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

export function DraftTabItem(
  props: TabCloseActions & {
    ref?: Ref<HTMLDivElement>
    href: string
    title: string
    active?: boolean
    onNavigate: () => void
    suppressNavigation?: boolean
    dragging?: boolean
    pressed?: boolean
    hidden?: boolean
    orientation?: "horizontal" | "vertical"
  },
) {
  const language = useLanguage()

  const [menu, setMenu] = createStore({ open: false })

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }

  return (
    <Menu.Context modal={false} onOpenChange={(open) => setMenu("open", open)}>
      <div
        ref={(el) => {
          if (Predicate.isFunction(props.ref)) props.ref(el)
        }}
        data-titlebar-tab
        data-slot="titlebar-tab-item"
        data-orientation={props.orientation ?? "horizontal"}
        data-active={props.active}
        data-dragging={props.dragging}
        data-state={props.active || props.pressed ? "pressed" : undefined}
        class="group relative flex h-7 w-full min-w-0 flex-row items-center gap-1.5 overflow-hidden rounded-[6px] px-1.5 [container-type:inline-size] whitespace-nowrap"
        classList={{ invisible: props.hidden }}
        onMouseDown={(event) => {
          if (event.button !== MIDDLE_MOUSE_BUTTON) return
          event.preventDefault()
          event.stopPropagation()
        }}
        onAuxClick={(event) => {
          if (event.button !== MIDDLE_MOUSE_BUTTON) return
          closeTab(event)
        }}
      >
        <Menu.Context.Trigger
          as="a"
          disabled={props.dragging}
          aria-haspopup="menu"
          aria-expanded={menu.open}
          data-slot="tab-link"
          data-titlebar-tab-link
          href={props.href}
          draggable={false}
          onDragStart={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onMouseDown={(event) => {
            // Navigate on mousedown to shave the press-release delay off tab switches.
            if (event.button !== 0) return

            if (props.suppressNavigation) return
            props.onNavigate()
          }}
          onClick={(event) => {
            event.preventDefault()

            // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
            if (event.detail > 0) return

            if (props.suppressNavigation) return
            props.onNavigate()
          }}
          class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base [-webkit-user-drag:none]"
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            <svg
              class="text-v2-icon-icon-muted group-data-[active='true']:text-v2-icon-icon-base"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M9.00002 13.5H14M2.60419 10.9167V13.3958H5.08335L13.3959 5.08333L10.9167 2.60416L2.60419 10.9167Z"
                stroke="currentColor"
              />
            </svg>
          </span>
          <span
            data-titlebar-tab-title
            class="min-w-0 flex-1 overflow-hidden text-clip whitespace-nowrap outline-none leading-4"
          >
            {props.title}
          </span>
        </Menu.Context.Trigger>
        <div data-slot="tab-close">
          <IconButton
            size="small"
            variant="ghost-muted"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            class="hover-reveal relative z-10"
            onClick={closeTab}
            icon={<Icon name="xmark-small" />}
            aria-label={language.t("common.closeTab")}
          />
        </div>
      </div>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <TabCloseMenuItems
            orientation={props.orientation}
            onClose={props.onClose}
            onCloseOthers={props.onCloseOthers}
            onCloseAfter={props.onCloseAfter}
          />
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}
