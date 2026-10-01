import { Icon } from "@opencode/ui/icon"
import {
  displayName,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { createUniqueId, Show, type ParentProps } from "solid-js"
import type { Project } from "../sdk"

export function ProjectSummaryCard(
  props: ParentProps<{
    project: Pick<Project, "name" | "worktree" | "icon"> & { id?: string }
    expanded: boolean
    onExpandedChange: (expanded: boolean) => void
  }>,
) {
  const contentID = createUniqueId()
  return (
    <section class="session-summary-card" data-section="project">
      <button
        type="button"
        class="session-summary-row session-summary-heading"
        aria-label={displayName(props.project)}
        aria-expanded={props.expanded}
        aria-controls={contentID}
        onClick={() => props.onExpandedChange(!props.expanded)}
      >
        <ProjectAvatar
          fallback={displayName(props.project)}
          src={getProjectAvatarSource(props.project.id, props.project.icon)}
          variant={getProjectAvatarVariant(props.project.icon?.color)}
        />
        <span dir="auto" class="session-summary-label">
          {displayName(props.project)}
        </span>
        <Icon name="chevron-down" size="small" class="session-summary-disclosure" />
      </button>
      <Show when={props.expanded}>
        <div id={contentID} class="session-summary-rows">
          {props.children}
        </div>
      </Show>
    </section>
  )
}
