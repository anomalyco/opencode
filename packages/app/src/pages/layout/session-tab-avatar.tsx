import type { LocalProject } from "@/context/layout"
import { getProjectAvatarVariant } from "@/context/layout"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { SessionProgressIndicatorV2 } from "@opencode-ai/session-ui/v2/session-progress-indicator-v2"
import { Show } from "solid-js"

export function SessionTabAvatar(props: {
  project?: LocalProject
  directory: string
  sessionId: string
  activeServer: boolean
}) {
  const directory = () => props.directory
  const sessionId = () => props.sessionId
  const state = useSessionTabAvatarState(directory, sessionId, () => props.activeServer)
  return (
    <Show
      when={state.loading()}
      fallback={
        <ProjectAvatar
          fallback={displayName(props.project ?? { worktree: props.directory })}
          src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
          variant={getProjectAvatarVariant(props.project?.icon?.color)}
          unread={state.unread()}
        />
      }
    >
      <span class="relative block size-4 shrink-0">
        <SessionProgressIndicatorV2 class="absolute inset-0 group-hover:invisible" />
        <span class="invisible absolute inset-0 group-hover:visible">
          <ProjectAvatar
            fallback={displayName(props.project ?? { worktree: props.directory })}
            src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
            variant={getProjectAvatarVariant(props.project?.icon?.color)}
            unread={state.unread()}
          />
        </span>
      </span>
    </Show>
  )
}
