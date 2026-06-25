import { createEffect, createMemo, createSignal, onCleanup, Show, type Ref } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { projectForSession } from "@/pages/layout/helpers"
import { SessionTabAvatar } from "@/pages/layout/session-tab-avatar"
import { showToast } from "@/utils/toast"
import type { Session } from "@opencode-ai/sdk/v2"
import { canOpenTabRename, forwardTabRef } from "./titlebar-tab-gesture"
import "./titlebar-tab-nav.css"

export function TabNavItem(props: {
  ref?: Ref<HTMLDivElement>
  href: string
  server: ServerConnection.Key
  session: () => Session | undefined
  onTitleChange?: (title: string) => void
  onTitleChangeFailed?: (title: string) => void
  onClose: () => void
  onNavigate: () => void
  active?: boolean
  activeServer: boolean
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
    props.session()?.title
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
    const title = props.session()?.title
    if (title === undefined) return
    titleEl.textContent = title
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

  return (
    <div
      ref={(el) => {
        tabRoot = el
        forwardTabRef(props.ref, el)
      }}
      data-titlebar-tab
      data-slot="titlebar-tab-item"
      data-title-overflow={titleOverflowing()}
      data-editing={editing()}
      class="group relative flex h-7 min-w-24 max-w-60 select-none flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] bg-[var(--tab-bg)] px-1.5 [--tab-bg:var(--v2-background-bg-deep)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] has-[>a:focus-visible]:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[dragging='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[pressed='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[editing='true']:[--tab-bg:var(--v2-background-bg-layer-02)]"
      classList={{ invisible: props.hidden }}
      data-active={props.active}
      data-dragging={props.dragging}
      data-pressed={props.pressed}
      onMouseDown={(event) => {
        if (event.button !== 1) return
        closeTab(event)
      }}
    >
      <Show when={props.session()}>
        {(session) => {
          return (
            <a
              data-slot="tab-link"
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
              <span data-slot="project-avatar-slot">
                <SessionTabAvatar
                  project={project()}
                  directory={session().directory}
                  sessionId={session().id}
                  activeServer={props.activeServer}
                />
              </span>
              <span
                ref={(el) => {
                  titleEl = el
                  titleEl.textContent = session().title
                }}
                data-slot="tab-title"
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
                  titleEl.textContent = session().title
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
          )
        }}
      </Show>

      <div data-slot="tab-close">
        <IconButtonV2
          size="small"
          variant="ghost-muted"
          class="relative z-10 opacity-0 group-hover:opacity-100 group-data-[active=true]:opacity-100 group-data-[editing=true]:opacity-100"
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
      class="group relative shrink-0 flex h-7 max-w-60 flex-row items-center gap-1.5 overflow-hidden rounded-[6px] bg-[var(--tab-bg)] pl-1.5 pr-8 whitespace-nowrap [--tab-bg:var(--v2-background-bg-deep)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] has-[>a:focus-visible]:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:has-[>a:focus-visible]:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:[--tab-bg:var(--v2-overlay-simple-overlay-pressed)] data-[dragging='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[pressed='true']:[--tab-bg:var(--v2-background-bg-layer-02)]"
      classList={{ invisible: props.hidden }}
      onMouseDown={(event) => {
        if (event.button !== 1) return
        closeTab(event)
      }}
    >
      <a
        data-slot="tab-link"
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
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 overflow-hidden text-[13px] font-medium leading-5 text-v2-text-text-faint group-data-[active='true']:text-[var(--v2-text-text-base)]"
      >
        <span class="flex size-4 shrink-0 rotate-90 items-center justify-center">
          <IconV2 name="edit" />
        </span>
        <span class="truncate leading-5">{props.title}</span>
      </a>
      <div data-slot="tab-close" class="absolute right-0 inset-y-0 flex w-7 items-center justify-center">
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
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
          aria-label="Close tab"
        />
      </div>
    </div>
  )
}
