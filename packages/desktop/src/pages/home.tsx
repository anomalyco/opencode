import { useGlobalSync } from "@/context/global-sync"
import { base64Encode } from "@/utils"
import { For } from "solid-js"
import { A } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { getFilename } from "@opencode-ai/util/path"

export default function Home() {
  const sync = useGlobalSync()
  return (
    <div class="flex flex-col gap-3">
      <For each={sync.data.projects}>
        {(project) => (
          <Button as={A} href={base64Encode(project.worktree)}>
            {getFilename(project.worktree)}
          </Button>
        )}
      </For>
    </div>
  )
}
