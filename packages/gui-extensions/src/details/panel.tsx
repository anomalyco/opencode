import { DiffChanges } from "@opencode/ui/diff-changes"
import { Icon } from "@opencode/ui/icon"
import { containsDirectory, getFilename } from "@opencode/util/path"
import { createMemo, Show } from "solid-js"
import { useExtension, type Project, type MountedSession } from "../sdk"
import { BackgroundWork } from "./background"
import { workspaceDirectories } from "./paths"
import { ProjectDetailsCard } from "./project-card"
import { SessionServerPanel } from "./server-panel"
import { SessionWorkspaceMenu } from "./workspace-menu"

export type Disclosure = {
  project(): boolean
  server(): boolean
  setProject(expanded: boolean): void
  setServer(expanded: boolean): void
}

export type DetailsPanelProps = {
  session: MountedSession
  project: Project
  shown?: boolean
  mobile?: boolean
  diffs?: readonly { additions: number; deletions: number }[]
  moveDismissed: boolean
  onMoveDismiss: () => void
  /** Absent while the review extension is disabled, which also leaves `diffs` undefined. */
  onReview?: () => void
  disclosure: Disclosure
}

export default function SessionDetailsPanel(props: DetailsPanelProps) {
  const ctx = useExtension()
  const locale = ctx.locale
  const data = props.session.server.data

  const placement = createMemo(() =>
    props.mobile ? "top-end" : locale.direction() === "rtl" ? "right-start" : "left-start",
  )

  const location = () => {
    if (props.session.local) return ctx.t("workspace.local")

    const workspace = workspaceDirectories(props.project).find((item) =>
      containsDirectory(item, props.session.directory),
    )

    return getFilename(workspace ?? props.session.directory)
  }

  const branch = () => data.location.vcs.info({ directory: props.session.directory })?.branch.current
  const baseBranch = () => data.location.vcs.info({ directory: props.project.worktree })?.branch.current

  return (
    <div data-component="session-summary-panel" data-mobile={props.mobile || undefined}>
      <div>
        <ProjectDetailsCard
          project={props.project}
          expanded={props.disclosure.project()}
          onExpandedChange={props.disclosure.setProject}
        >
          <SessionWorkspaceMenu
            session={props.session}
            project={props.project}
            directory={props.session.directory}
            placement={placement()}
            class="session-summary-row"
          >
            <Icon
              name={props.session.local ? "monitor" : "outline-worktree"}
              class="shrink-0 text-v2-icon-icon-muted"
            />
            <span dir="auto" class="session-summary-label">
              {location()}
            </span>
            <Icon name="fill-triangle-down" class="session-summary-menu-indicator shrink-0 text-v2-icon-icon-muted" />
          </SessionWorkspaceMenu>
          <div class="session-summary-row">
            <Icon name="branch" class="shrink-0 text-v2-icon-icon-muted" />
            <Show
              when={branch()}
              fallback={
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="shrink-0 whitespace-nowrap">{ctx.t("noBranch")}</span>
                  <Show when={baseBranch()}>
                    {(base) => (
                      <>
                        <span class="text-v2-text-text-muted">·</span>
                        <span class="truncate text-v2-text-text-faint">{ctx.t("basedOn", { branch: base() })}</span>
                      </>
                    )}
                  </Show>
                </span>
              }
            >
              <span dir="auto" class="min-w-0 truncate">
                {branch()}
              </span>
            </Show>
          </div>
          <Show when={props.onReview}>
            <button type="button" class="session-summary-row" onClick={() => props.onReview?.()}>
              <Icon name="review" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="session-summary-label flex items-center gap-2">
                <Show
                  when={props.diffs}
                  fallback={<span class="truncate text-v2-text-text-muted">{ctx.t("loadingChanges")}</span>}
                >
                  {(diffs) => (
                    <Show
                      when={diffs().length > 0}
                      fallback={<span class="truncate text-v2-text-text-muted">{ctx.t("noChanges")}</span>}
                    >
                      <span class="min-w-0 truncate">{ctx.plural("ui.sessionTurn.diffs.changed", diffs().length)}</span>
                      <span class="shrink-0 text-v2-text-text-muted">·</span>
                      <DiffChanges appearance="standard" changes={[...diffs()]} />
                    </Show>
                  )}
                </Show>
              </span>
            </button>
          </Show>
          <BackgroundWork tasks={props.session.background} mobile={props.mobile} />
        </ProjectDetailsCard>
        <Show when={props.disclosure.project() && props.session.local && props.diffs?.length && !props.moveDismissed}>
          <div class="session-summary-move">
            <SessionWorkspaceMenu
              session={props.session}
              project={props.project}
              directory={props.session.directory}
              placement={placement()}
              class="session-summary-row"
            >
              <Icon name="outline-worktree" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="min-w-0 truncate">{ctx.t("move.title")}</span>
            </SessionWorkspaceMenu>
            <button
              type="button"
              class="session-summary-dismiss"
              aria-label={ctx.t("common.dismiss")}
              onClick={props.onMoveDismiss}
            >
              <Icon name="xmark-small" />
            </button>
          </div>
        </Show>
      </div>
      <SessionServerPanel
        session={props.session}
        directory={props.session.directory}
        shown={props.shown !== false}
        mobile={props.mobile}
        expanded={props.disclosure.server()}
        onExpandedChange={props.disclosure.setServer}
      />
    </div>
  )
}
