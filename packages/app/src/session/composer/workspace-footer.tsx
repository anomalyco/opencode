import { Icon } from "@opencode/ui/icon"
import { getFilename } from "@opencode/util/path"
import { Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { Project } from "@/runtime/server/types"
import { containsDirectory, workspaceDirectories } from "@/workspaces/paths"
import { SessionWorkspaceMenu } from "../timeline/session-workspace-menu"

export function SessionWorkspaceFooter(props: {
  directory: string
  local: boolean
  branch?: string
  move?: { project: Project; sessionID: string; eligible: boolean }
}) {
  const language = useLanguage()
  const label = () => (
    <>
      <Icon
        name={props.local ? "monitor" : "outline-worktree"}
        size="small"
        class={props.local ? "shrink-0 text-v2-icon-icon-muted" : "shrink-0 text-v2-icon-icon-accent"}
      />
      <span dir="auto" class="min-w-0 truncate">
        {props.local
          ? language.t("session.new.workspace.triggerLocal")
          : getFilename(
              (props.move &&
                workspaceDirectories(props.move.project).find((directory) => containsDirectory(directory, props.directory))) ??
                props.directory,
            )}
      </span>
    </>
  )

  return (
    <div data-component="session-workspace-footer" class="w-full shrink-0 rounded-b-xl bg-v2-background-bg-deep">
      <div
        class="flex h-9 w-full min-w-0 items-center gap-2 px-2.5 text-[12px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-faint"
      >
        <div class="min-w-0 max-w-[203px]" title={props.directory}>
          <Show when={props.move} fallback={<div class="flex h-6 min-w-0 items-center gap-1 px-1.5">{label()}</div>}>
            {(move) => (
              <SessionWorkspaceMenu
                project={move().project}
                sessionID={move().sessionID}
                eligible={move().eligible}
                directory={props.directory}
                placement="top-start"
                class="flex h-6 min-w-0 max-w-full items-center gap-1 rounded-sm px-1.5 hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed disabled:opacity-50"
              >
                {label()}
                <Icon name="chevron-down" size="small" class="size-3 shrink-0 text-v2-icon-icon-muted" />
              </SessionWorkspaceMenu>
            )}
          </Show>
        </div>
        <Show when={props.branch}>
          {(branch) => (
            <div
              class="flex h-5 min-w-0 max-w-[220px] items-center gap-1 rounded-full bg-v2-background-bg-layer-02 px-2"
              title={branch()}
            >
              <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              <span dir="auto" class="min-w-0 truncate">
                {branch()}
              </span>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
