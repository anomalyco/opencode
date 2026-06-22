import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { getProjectAvatarVariant, type LocalProject } from "@/context/layout"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { displayName, getProjectAvatarSource, projectForSession } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { showToast } from "@/utils/toast"
import "./titlebar-tab-nav.css"

function ProjectTabAvatar(props: {
  project?: LocalProject
  directory: string
  sessionId: string
  activeServer: boolean
}) {
  const directory = () => props.directory
  const sessionId = () => props.sessionId
  const state = useSessionTabAvatarState(directory, sessionId, () => props.activeServer)
  return (
    <ProjectAvatar
      fallback={displayName(props.project ?? { worktree: props.directory })}
      src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
      variant={getProjectAvatarVariant(props.project?.icon?.color)}
      unread={state.unread()}
      loading={state.loading()}
    />
  )
}

export function TabNavItem(props: {
  ref?: HTMLDivElement
  href: string
  server: ServerConnection.Key
  directory: string
  sessionId?: string
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
  const dirSyncCtx = createMemo(() => serverCtx()?.sync.createDirSyncContext(props.directory))

  createEffect(() => {
    const ctx = dirSyncCtx()
    const sessionID = props.sessionId
    if (!ctx || !sessionID) return
    void ctx.session.sync(sessionID).catch(() => {})
  })

  const session = createMemo(() => {
    const ctx = dirSyncCtx()
    const sessionID = props.sessionId
    if (!ctx || !sessionID) return
    const info = ctx.session.get(sessionID)
    void info?.title
    return info
  })

  const measureTitleOverflow = () => {
    if (!titleEl || editing()) {
      setTitleOverflowing(false)
      return
    }
    setTitleOverflowing(titleEl.scrollWidth > titleEl.clientWidth)
  }

  createEffect(() => {
    session()?.title
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
    const sessionID = props.sessionId
    if (!ctx || !sessionID) return
    const client = ctx.sdk.createClient({ directory: props.directory, throwOnError: true })
    await client.session.update({ sessionID, title })
  }

  const closeRename = async (save: boolean) => {
    if (committing || !editing()) return
    committing = true

    const original = session()?.title ?? ""
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
    const title = session()?.title
    if (title === undefined || !titleEl) return
    titleEl.textContent = title
  })

  const openRename = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (props.dragging || editing()) return
    const current = session()
    if (!current) return

    titleEl.textContent = current.title
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
      <Show when={session()}>
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
                <ProjectTabAvatar
                  project={project()}
                  directory={props.directory}
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
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
        />
      </div>
    </div>
  )
}
