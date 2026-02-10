import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Show } from "solid-js"
import { getFilename } from "@opencode-ai/util/path"
import { DateTime } from "luxon"
import type { Project } from "@opencode-ai/sdk/v2"

interface RecentProjectsListProps {
  projects: Project[]
  onSelect: (worktree: string) => void
  homedir?: string
  showIcon?: boolean
}

export function RecentProjectsList(props: RecentProjectsListProps) {
  return (
    <Show when={props.projects.length > 0}>
      <div class="space-y-1 px-3 py-2 mb-2">
        {props.projects.map((project) => (
          <button
            onClick={() => props.onSelect(project.worktree)}
            class="w-full text-left px-2 py-2 rounded hover:bg-background-hover transition-colors flex items-center justify-between gap-x-3"
          >
            <div class="flex items-center gap-x-3 min-w-0">
              <Show when={props.showIcon}>
                <FileIcon node={{ path: project.worktree, type: "directory" }} class="shrink-0 size-4" />
              </Show>
              <span class="text-text-strong truncate text-14-regular">
                {props.homedir ? project.worktree.replace(props.homedir, "~") : project.worktree}
              </span>
            </div>
            <div class="text-14-regular text-text-weak whitespace-nowrap">
              {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
            </div>
          </button>
        ))}
      </div>
    </Show>
  )
}
