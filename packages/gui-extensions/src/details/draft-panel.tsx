import { Icon } from "@opencode/ui/icon"
import { getFilename } from "@opencode/util/path"
import { Show } from "solid-js"
import { useExtension, type Draft } from "../sdk"
import type { Disclosure } from "./panel"
import { ProjectDetailsCard } from "./project-card"
import { SessionServerPanel } from "./server-panel"

export type DraftDetailsPanelProps = {
  draft: Draft
  shown: boolean
  disclosure: Disclosure
}

export default function DraftDetailsPanel(props: DraftDetailsPanelProps) {
  const ctx = useExtension()

  const workspace = () => {
    if (props.draft.workspace === "create") return ctx.t("workspace.new")

    if (props.draft.workspace === "local") return ctx.t("workspace.local")

    return getFilename(props.draft.directory)
  }

  return (
    <div data-component="session-summary-panel">
      <ProjectDetailsCard
        project={props.draft.project ?? { worktree: props.draft.directory }}
        expanded={props.disclosure.project()}
        onExpandedChange={props.disclosure.setProject}
      >
        <div class="session-summary-row">
          <Icon
            name={props.draft.workspace === "local" ? "monitor" : "outline-worktree"}
            class="shrink-0 text-v2-icon-icon-muted"
          />
          <span dir="auto" class="session-summary-label">
            {workspace()}
          </span>
        </div>
        <div class="session-summary-row">
          <Icon name="branch" class="shrink-0 text-v2-icon-icon-muted" />
          <Show when={props.draft.branch} fallback={<span class="truncate">{ctx.t("noBranch")}</span>}>
            {(branch) => (
              <span dir="auto" class="min-w-0 truncate">
                {props.draft.workspace === "create" ? ctx.t("basedOn", { branch: branch() }) : branch()}
              </span>
            )}
          </Show>
        </div>
      </ProjectDetailsCard>
      <SessionServerPanel
        server={props.draft.server}
        directory={props.draft.directory}
        shown={props.shown}
        mcp={props.draft.mcp}
        expanded={props.disclosure.server()}
        onExpandedChange={props.disclosure.setServer}
      />
    </div>
  )
}
