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
    avatar?: JSX.Element
  }>,
) {
  const settings = useSettings()
  const contentID = createUniqueId()
  const expanded = settings.sessionSummary.projectExpanded
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
            fallback={displayName(props.project)}
            src={getProjectAvatarSource(props.project.id, props.project.icon)}
            variant={getProjectAvatarVariant(props.project.icon?.color)}
          />
        )}
        <span class="session-summary-heading-label">
          <span dir="auto" class="min-w-0 truncate">
            {displayName(props.project)}
          </span>
          <Icon name="fill-triangle-down" class="session-summary-disclosure" />
        </span>
      </button>
      <Show when={expanded()}>
        <div id={contentID} class="session-summary-rows">
          {props.children}
        </div>
      </Show>
    </section>
  )
}
