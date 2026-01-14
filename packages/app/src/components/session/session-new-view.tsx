import { createMemo } from "solid-js"
import { useSync } from "@/context/sync"
import { Icon } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

export function NewSessionView() {
  const sync = useSync()

  const projectRoot = createMemo(() => sync.project?.worktree ?? sync.data.path.directory)

  return (
    <div
      class="size-full flex flex-col pb-45 justify-end items-start gap-4 flex-[1_0_0] self-stretch max-w-200 mx-auto px-6"
      style={{ "padding-bottom": "calc(var(--prompt-height, 11.25rem) + 64px)" }}
    >
      <div class="text-20-medium text-text-weaker">New session</div>
      <div class="flex justify-center items-center gap-3">
        <Icon name="folder" size="small" />
        <div class="text-12-medium text-text-weak">
          {getDirectory(projectRoot())}
          <span class="text-text-strong">{getFilename(projectRoot())}</span>
        </div>
      </div>
    </div>
  )
}
