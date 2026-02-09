import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Show } from "solid-js"
import { getFilename } from "@opencode-ai/util/path"
import type { Project } from "@opencode-ai/sdk/v2"

interface RecentProjectsListProps {
  projects: Project[]
  onSelect: (worktree: string) => void
  showHeader?: boolean
}

export function RecentProjectsList(props: RecentProjectsListProps) {
  return (
    <Show when={props.projects.length > 0}>
      <div class="px-3 py-2 mb-2">
        <Show when={props.showHeader !== false}>
          <div class="text-12-regular text-text-weak mb-2">Recent Projects</div>
        </Show>
        <div class="space-y-1">
          {props.projects.map((project) => (
            <button
              onClick={() => props.onSelect(project.worktree)}
              class="w-full text-left px-2 py-2 rounded hover:bg-background-hover transition-colors flex items-center gap-x-3"
            >
              <FileIcon node={{ path: project.worktree, type: "directory" }} class="shrink-0 size-4" />
              <div class="flex items-center text-14-regular min-w-0 grow">
                <span class="text-text-strong truncate">{project.name || getFilename(project.worktree)}</span>
                <span class="text-text-weak ml-2 truncate text-12-regular">{project.worktree}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Show>
  )
}
