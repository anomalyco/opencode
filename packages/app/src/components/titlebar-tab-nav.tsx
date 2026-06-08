import { createMemo, createResource, Show } from "solid-js"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { getProjectAvatarVariant, type LocalProject } from "@/context/layout"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { displayName, getProjectAvatarSource, projectForSession } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"

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

  const [session] = createResource(
    () => {
      const ctx = dirSyncCtx()
      if (!ctx || !props.sessionId) return
      return [props.sessionId, ctx] as const
    },
    async ([sessionId, dirSyncCtx]) => {
      await dirSyncCtx.session.sync(sessionId).catch(() => {})
      return dirSyncCtx.session.get(sessionId)
    },
    { initialValue: props.sessionId ? dirSyncCtx()?.session.get(props.sessionId) : undefined },
  )

  return (
    <div
      ref={props.ref}
      data-titlebar-tab
      class="group relative flex h-7 min-w-24 max-w-60 flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] bg-[var(--tab-bg)] px-1.5 [--tab-bg:var(--v2-background-bg-deep)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[dragging='true']:[--tab-bg:var(--v2-background-bg-layer-02)] data-[pressed='true']:[--tab-bg:var(--v2-background-bg-layer-02)]"
      classList={{ invisible: props.hidden }}
      data-active={props.active}
      data-dragging={props.dragging}
      data-pressed={props.pressed}
      onMouseDown={(event) => {
        if (event.button !== 1) return
        closeTab(event)
      }}
    >
      <Show when={session.latest}>
        {(session) => {
          const project = createMemo(() => projectForSession(session(), serverCtx()?.projects.list() ?? []))

          return (
            <a
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
              <span data-slot="project-avatar-slot">
                <ProjectTabAvatar
                  project={project()}
                  directory={props.directory}
                  sessionId={session().id}
                  activeServer={props.activeServer}
                />
              </span>
              <span class="min-w-0 flex-1">{session().title}</span>
            </a>
          )
        }}
      </Show>

      <div
        class="absolute not-group-hover:not-group-data-[active=true]:not-data-[truncate=true]:left-52 group-hover:right-0 group-data-[active=true]:right-0 data-[truncate=true]:right-0 inset-y-0 flex flex-row items-center pr-1 py-1 w-8 pl-2"
        data-truncate={props.forceTruncate}
      >
        <div
          class="absolute inset-0 rounded-r-[6px] bg-(image:--inactive-bg) group-hover:bg-(image:--active-bg) group-data-[active=true]:bg-(image:--active-bg)"
          style={{
            "--inactive-bg": "linear-gradient(to right, transparent 0%, var(--tab-bg) 80%)",
            "--active-bg": "linear-gradient(90deg, transparent 0%, var(--tab-bg) 25%)",
          }}
        />
        <IconButtonV2
          size="small"
          variant="ghost-muted"
          class="opacity-0 group-hover:opacity-100 group-data-[active='true']:opacity-100 z-10"
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
        />
      </div>
    </div>
  )
}
