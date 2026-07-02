import { createEffect, createMemo, createSignal, onCleanup, Show, type Ref } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection, serverName } from "@/context/server"
import { displayName, projectForSession } from "@/pages/layout/helpers"
import { SessionTabAvatar } from "@/pages/layout/session-tab-avatar"
import { showToast } from "@/utils/toast"
import type { Session } from "@opencode-ai/sdk/v2"
import { canOpenTabRename, forwardTabRef } from "./titlebar-tab-gesture"
import { TabPreviewPopover } from "./titlebar-tab-popover"
import "./titlebar-tab-nav.css"

// MouseEvent.button uses 1 for the middle/wheel button.
const MIDDLE_MOUSE_BUTTON = 1

export function TabNavItem(props: {
  ref?: Ref<HTMLDivElement>
  href: string
  server: ServerConnection.Key
  session: () => Session | undefined
  fallbackTitle?: string
  onTitleChange?: (title: string) => void
  onTitleChangeFailed?: (title: string) => void
  onClose: () => void
  onNavigate: () => void
  active?: boolean
  forceTruncate?: boolean
  suppressNavigation?: () => boolean
  dragging?: boolean
  pressed?: boolean
  hidden?: boolean
}) {
  const language = useLanguage()
  const [editing, setEditing] = createSignal(false)
  const [titleOverflowing, setTitleOverflowing] = createSignal(false)
  let tabRoot!: HTMLDivElement
  let titleEl!: HTMLSpanElement
  let committing = false
  let measureFrame: number | undefined

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }
  const global = useGlobal()
  const serverCtx = createMemo(() => {
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === props.server)
    if (conn) return global.ensureServerCtx(conn)
  })
  const project = createMemo(() => {
    const session = props.session()
    if (!session) return
    return projectForSession(session, serverCtx()?.projects.list() ?? [])
  })
  const title = createMemo(() => props.session()?.title ?? props.fallbackTitle)

  const projectName = createMemo(() => {
    const session = props.session()
    if (!session) return
    return displayName(project() ?? { worktree: session.directory })
  })
  const previewPath = createMemo(() => {
    const session = props.session()
    if (!session) return
    const home = serverCtx()?.sync.data.path.home
    return home ? session.directory.replace(home, "~") : session.directory
  })
  // Only label the server when multiple servers are connected.
  const serverLabel = createMemo(() => {
    if (global.servers.list().length <= 1) return
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === props.server)
    return conn ? serverName(conn) : undefined
  })

  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const previewBlocked = () => !!props.dragging || editing() || !!props.pressed || !props.session()

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
    props.forceTruncate
    editing()
    scheduleTitleOverflow()
  })

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

  const rename = async (title: string) => {
    const ctx = serverCtx()
    const session = props.session()
    if (!ctx || !session) return
    const client = ctx.sdk.createClient({ directory: session.directory, throwOnError: true })
    await client.session.update({ sessionID: session.id, title })
  }

  const closeRename = async (save: boolean) => {
    if (committing || !editing()) return
    committing = true

    const original = props.session()?.title ?? ""
    const next = (titleEl.textContent ?? "").trim()

    titleEl.scrollLeft = 0
    if (save && next && next !== original) props.onTitleChange?.(next)
    setEditing(false)

    if (!save || !next || next === original) {
      committing = false
      return
    }

    try {
      await rename(next)
    } catch (err) {
      props.onTitleChangeFailed?.(original)
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : undefined,
      })
    }

    committing = false
  }

  createEffect(() => {
    if (editing()) return
    if (!titleEl) return
    const value = title()
    if (value === undefined) return
    titleEl.textContent = value
  })

  const openRename = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!canOpenTabRename(props.dragging, editing(), committing)) return
    const session = props.session()
    if (!session) return
    titleEl.textContent = session.title
    setEditing(true)

    requestAnimationFrame(() => {
      titleEl.focus()
      selectTitle()
    })
  }

  createEffect(() => {
    if (!editing()) return

    const cleanup = makeEventListener(
      document,
      "pointerdown",
      (event) => {
        const target = event.target
        if (!(target instanceof Node)) return
        if (tabRoot.contains(target)) return
        void closeRename(true)
      },
      { capture: true },
    )

    onCleanup(cleanup)
  })

  const tab = (
    <div
      ref={(el) => {
        tabRoot = el
        forwardTabRef(props.ref, el)
      }}
      data-titlebar-tab
      data-slot="titlebar-tab-item"
      data-title-overflow={titleOverflowing()}
      data-editing={editing()}
      class="group relative flex h-7 w-full min-w-0 select-none flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] bg-[var(--tab-bg)] px-1.5 [container-type:inline-size] [--tab-bg:var(--v2-background-bg-deep)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] has-[>a:focus-visible]:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[dragging='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[pressed='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[editing='true']:[--tab-bg:var(--v2-background-bg-layer-02)]"
      classList={{ invisible: props.hidden }}
      data-active={props.active}
      data-dragging={props.dragging}
      data-pressed={props.pressed}
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
      <Show when={title() !== undefined}>
        <a
          data-slot="tab-link"
          data-titlebar-tab-link
          href={props.href}
          draggable={false}
          onDragStart={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            if (editing()) return
            if (props.suppressNavigation?.()) return
            props.onNavigate()
          }}
          class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base group-data-[editing='true']:text-v2-text-text-base [-webkit-user-drag:none]"
        >
          <Show when={props.session()}>
            {(session) => (
              <span data-slot="project-avatar-slot">
                <SessionTabAvatar
                  project={project()}
                  directory={session().directory}
                  sessionId={session().id}
                  server={props.server}
                />
              </span>
            )}
          </Show>
          <span
            ref={(el) => {
              titleEl = el
              titleEl.textContent = title() ?? ""
            }}
            data-slot="tab-title"
            data-titlebar-tab-title
            class="min-w-0 flex-1 outline-none leading-4"
            classList={{
              "overflow-hidden text-clip whitespace-nowrap": !editing(),
              "select-text": editing(),
            }}
            contenteditable={editing() ? true : undefined}
            onDblClick={openRename}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") {
                event.preventDefault()
                void closeRename(true)
                return
              }
              if (event.key !== "Escape") return
              event.preventDefault()
              titleEl.textContent = props.session()?.title ?? ""
              void closeRename(false)
            }}
            onBlur={() => void closeRename(true)}
            onPointerDown={(event) => {
              if (!editing()) return
              event.stopPropagation()
            }}
            onClick={(event) => {
              if (!editing()) return
              event.preventDefault()
            }}
          />
        </a>
      </Show>

      <div data-slot="tab-close" class="group-hover:bg-[var(--tab-bg)] group-data-[active=true]:bg-[var(--tab-bg)]">
        <IconButtonV2
          size="small"
          variant="ghost-muted"
          class="hover-reveal relative z-10 group-hover:opacity-100 group-data-[active=true]:opacity-100 group-data-[editing=true]:opacity-100"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
        />
      </div>
    </div>
  )

  return (
    <TabPreviewPopover
      trigger={tab}
      open={popoverOpen() && !previewBlocked()}
      onOpenChange={(value) => {
        if (value && previewBlocked()) return
        setPopoverOpen(value)
      }}
      data={{
        projectName: projectName(),
        title: props.session()?.title,
        path: previewPath(),
        serverName: serverLabel(),
      }}
    />
  )
}

export function DraftTabItem(props: {
  ref?: Ref<HTMLDivElement>
  href: string
  title: string
  active?: boolean
  onNavigate: () => void
  onClose: () => void
  suppressNavigation?: () => boolean
  dragging?: boolean
  pressed?: boolean
  hidden?: boolean
}) {
  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }
  return (
    <div
      ref={(el) => forwardTabRef(props.ref, el)}
      data-titlebar-tab
      data-slot="titlebar-tab-item"
      data-active={props.active}
      data-dragging={props.dragging}
      data-pressed={props.pressed}
      class="group relative flex h-7 w-full min-w-0 flex-row items-center gap-1.5 overflow-hidden rounded-[6px] bg-[var(--tab-bg)] px-1.5 [container-type:inline-size] whitespace-nowrap [--tab-bg:var(--v2-background-bg-deep)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] has-[>a:focus-visible]:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[dragging='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[pressed='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[editing='true']:[--tab-bg:var(--v2-background-bg-layer-02)]"
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
      <a
        data-slot="tab-link"
        data-titlebar-tab-link
        href={props.href}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          if (props.suppressNavigation?.()) return
          props.onNavigate()
        }}
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base [-webkit-user-drag:none]"
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          <IconV2 name="edit" />
        </span>
        <span
          data-titlebar-tab-title
          class="min-w-0 flex-1 overflow-hidden text-clip whitespace-nowrap outline-none leading-4"
        >
          {props.title}
        </span>
      </a>
      <div data-slot="tab-close" class="group-hover:bg-[var(--tab-bg)] group-data-[active=true]:bg-[var(--tab-bg)]">
        <IconButtonV2
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
          class="hover-reveal relative z-10 group-hover:opacity-100 group-data-[active=true]:opacity-100 group-data-[editing=true]:opacity-100"
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
          aria-label="Close tab"
        />
      </div>
    </div>
  )
}
