import type { LocalProject } from "@/shell/state/layout"
import type { ServerConnection } from "@/runtime/server/registry"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import {
  displayName,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { Show } from "solid-js"

const lawIcons = ["⚖️", "👩‍⚖️", "🏛️", "💼", "📚"]
const citrusIcons = ["🍊", "🍋", "🍋‍🟩"]
const sessionLawIcons = new Map<string, string>()
const sessionCitrusIcons = new Map<string, string>()

export function SessionTabAvatar(props: {
  project?: LocalProject
  directory: string
  sessionId: string
  server: ServerConnection.Key
}) {
  const lawIcon = sessionLawIcons.get(props.sessionId) ?? lawIcons[Math.floor(Math.random() * lawIcons.length)]!
  sessionLawIcons.set(props.sessionId, lawIcon)
  const citrusIcon =
    sessionCitrusIcons.get(props.sessionId) ?? citrusIcons[Math.floor(Math.random() * citrusIcons.length)]!
  sessionCitrusIcons.set(props.sessionId, citrusIcon)
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
      decoration={lawIcon}
      citrusDecoration={citrusIcon}
    />
  )
}

export function SessionTabAvatarView(props: {
  project?: LocalProject
  directory: string
  unread: boolean
  loading: boolean
  decoration?: string
  citrusDecoration?: string
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
          decoration={props.decoration}
          citrusDecoration={props.citrusDecoration}
        />
      }
    >
      <SessionProgressIndicatorV2 />
    </Show>
  )
}
