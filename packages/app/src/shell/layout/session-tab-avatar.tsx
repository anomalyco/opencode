import type { LocalProject } from "@/shell/state/layout"
import type { ServerConnection } from "@/runtime/server/registry"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import {
  displayName,
  getProjectAvatarGenerated,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { Show } from "solid-js"

export function SessionTabAvatar(props: {
  project?: LocalProject
  directory: string
  sessionId: string
  server: ServerConnection.Key
}) {
  const state = useSessionTabAvatarState(
    () => props.server,
    () => props.sessionId,
    () => true,
  )

  return (
    <SessionTabAvatarView
      project={props.project}
      directory={props.directory}
      unread={state.unread()}
      loading={state.loading()}
    />
  )
}

export function SessionTabAvatarView(props: {
  project?: LocalProject
  directory: string
  unread: boolean
  loading?: boolean
}) {
  const tint = () => {
    const icon = props.project?.icon

    if (!icon?.color || getProjectAvatarSource(props.project?.id, icon)) return

    return `var(--v2-avatar-border-${getProjectAvatarVariant(icon.color)})`
  }

  return (
    <Show
      when={props.loading}
      fallback={
        <ProjectAvatar
          fallback={displayName(props.project ?? { worktree: props.directory })}
          src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
          variant={getProjectAvatarVariant(props.project?.icon?.color)}
          generated={getProjectAvatarGenerated(props.project ?? { worktree: props.directory })}
          unread={props.unread}
        />
      }
    >
      <SessionProgressIndicatorV2 style={{ color: tint() }} />
    </Show>
  )
}
