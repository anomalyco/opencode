import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
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
import "./titlebar-tab-nav.css"

export function TabNavItem(props: {
  ref?: HTMLDivElement
  href: string
  server: ServerConnection.Key
  session: Session
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

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }
  const global = useGlobal()
  const serverCtx = createMemo(() => {
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === props.server)
    if (conn) return global.createServerCtx(conn)
  })

  const measureTitleOverflow = () => {
    if (!titleEl || editing()) {
      setTitleOverflowing(false)
      return
    }
    setTitleOverflowing(titleEl.scrollWidth > titleEl.clientWidth)
  }

  createEffect(() => {
    props.session.title
    props.forceTruncate
    editing()
    requestAnimationFrame(measureTitleOverflow)
  })

  createResizeObserver(
    () => tabRoot,
    () => requestAnimationFrame(measureTitleOverflow),
  )

  const selectTitle = () => {
    const range = document.createRange()
    range.selectNodeContents(titleEl)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const rename = async (title: string) => {
    const ctx = serverCtx()
    if (!ctx) return
    const client = ctx.sdk.createClient({ directory: props.session.directory, throwOnError: true })
    await client.session.update({ sessionID: props.session.id, title })
  }

  const closeRename = async (save: boolean) => {
    if (committing || !editing()) return
    committing = true

    const original = props.session.title
    const next = (titleEl.textContent ?? "").trim()

    titleEl.scrollLeft = 0
    setEditing(false)

    if (!save || !next || next === original) {
      committing = false
      return
    }

    try {
      await rename(next)
    } catch (err) {
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
    titleEl.textContent = props.session.title
  })

  const openRename = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (props.dragging || editing()) return
    titleEl.textContent = props.session.title
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
        props.ref = el
      }}
      data-titlebar-tab
      data-title-overflow={titleOverflowing()}
      data-editing={editing()}
      class="group relative flex h-7 max-w-60 select-none flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] bg-[var(--tab-bg)] px-1.5 [--tab-bg:var(--v2-background-bg-deep)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[dragging='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[pressed='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[editing='true']:[--tab-bg:var(--v2-background-bg-layer-02)]"
      classList={{ invisible: props.hidden }}
      data-active={props.active}
      data-dragging={props.dragging}
      data-pressed={props.pressed}
      onMouseDown={(event) => {
        if (event.button !== 1) return
        closeTab(event)
      }}
    >
      <Show when={props.session}>
        {(session) => {
          const project = createMemo(() => projectForSession(session(), serverCtx()?.projects.list() ?? []))

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
                ref={titleEl}
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
                  titleEl.textContent = props.session.title
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
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
        />
      </div>
    </div>
  )
}

export function DraftTabItem(props: {
  ref?: HTMLDivElement
  href: string
  title: string
  active?: boolean
  onNavigate: () => void
  onClose: () => void
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
      ref={props.ref}
      data-titlebar-tab
      data-active={props.active}
      data-dragging={props.dragging}
      data-pressed={props.pressed}
      class="group relative shrink-0 flex h-7 max-w-60 flex-row items-center gap-1.5 overflow-hidden rounded-[6px] bg-[var(--tab-bg)] pl-1.5 pr-8 whitespace-nowrap [--tab-bg:var(--v2-background-bg-deep)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:[--tab-bg:var(--v2-overlay-simple-overlay-pressed)] data-[dragging='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[pressed='true']:[--tab-bg:var(--v2-background-bg-layer-02)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--v2-border-border-focus)]"
      classList={{ invisible: props.hidden }}
      onMouseDown={(event) => {
        if (event.button !== 1) return
        closeTab(event)
      }}
    >
      <a
        href={props.href}
        onClick={(event) => {
          event.preventDefault()
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
