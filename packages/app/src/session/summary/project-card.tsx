import { Icon } from "@opencode/ui/icon"
import { ProjectAvatar } from "@opencode/ui/project-avatar"
import { createUniqueId, Show, type ParentProps, type JSX } from "solid-js"
import type { Project } from "@/runtime/server/types"
import { useSettings } from "@/settings/model"
import { displayName, getProjectAvatarSource } from "@/shell/layout/helpers"
import { getProjectAvatarVariant } from "@/shell/state/layout"
import "./summary.css"

export function ProjectSummaryCard(
  props: ParentProps<{
    project: Pick<Project, "name" | "worktree" | "icon"> & { id?: string }
    avatarProject?: Pick<Project, "name" | "worktree" | "icon"> & { id?: string }
    avatar?: JSX.Element
  }>,
) {
  const settings = useSettings()
  const contentID = createUniqueId()
  const expanded = settings.sessionSummary.projectExpanded
  const avatarProject = () => props.avatarProject ?? props.project
  return (
    <section class="session-summary-card" data-section="project">
      <button
        type="button"
        class="session-summary-row session-summary-heading"
        aria-label={displayName(props.project)}
        aria-expanded={expanded()}
        aria-controls={contentID}
        onClick={() => settings.sessionSummary.setProjectExpanded(!expanded())}
      >
        {props.avatar ?? (
          <ProjectAvatar
            fallback={displayName(avatarProject())}
            src={getProjectAvatarSource(avatarProject().id, avatarProject().icon)}
            variant={getProjectAvatarVariant(avatarProject().icon?.color)}
          />
        )}
        <span dir="auto" class="session-summary-label">
          {displayName(props.project)}
        </span>
        <Icon name="chevron-down" size="small" class="session-summary-disclosure" />
      </button>
      <Show when={expanded()}>
        <div id={contentID} class="session-summary-rows">
          {props.children}
        </div>
      </Show>
    </section>
  )
}
