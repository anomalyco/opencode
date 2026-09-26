import { Icon } from "@opencode/ui/icon"
import { createUniqueId, Show, type ParentProps } from "solid-js"
import type { Project } from "@/runtime/server/types"
import { useSettings } from "@/settings/model"
import { displayName } from "@/shell/layout/helpers"
import { ProjectIcon } from "@/shell/layout/project-icon"
import "./summary.css"

export function ProjectSummaryCard(
  props: ParentProps<{
    project: Pick<Project, "name" | "worktree" | "icon"> & { id?: string }
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
        <ProjectIcon project={props.project} />
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
