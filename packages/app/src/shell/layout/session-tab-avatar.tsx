import { getProjectAvatarVariant, type LocalProject } from "@/shell/state/layout"
import type { ServerConnection } from "@/runtime/server/registry"
import { displayName, getProjectAvatarSource } from "@/shell/layout/helpers"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { ProjectAvatar } from "@opencode-ai/ui/project-avatar"
import { SessionProgressIndicatorV2 } from "@opencode-ai/session-ui/v2/session-progress-indicator-v2"
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
  loading: boolean
}) {
  return (
    <Show
      when={props.loading}
      fallback={
        <ProjectAvatar
          fallback={displayName(props.project ?? { worktree: props.directory })}
          src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
          variant={getProjectAvatarVariant(props.project?.icon?.color)}
          unread={props.unread}
        />
      }
    >
      <SessionProgressIndicatorV2 />
    </Show>
  )
}
