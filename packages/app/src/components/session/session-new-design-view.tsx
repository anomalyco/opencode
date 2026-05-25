import type { JSX } from "solid-js"
import { createMemo } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useServerSync } from "@/context/server-sync"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { WordmarkV2 } from "@opencode-ai/ui/v2/components/wordmark-v2.jsx"

const MAIN_WORKTREE = "main"

export function NewSessionDesignView(props: { worktree: string; children: JSX.Element }) {
  const serverSync = useServerSync()
  const layout = useLayout()
  const navigate = useNavigate()
  const sdk = useSDK()
  const server = useServer()
  const sync = useSync()

  const projectRoot = createMemo(() => sync.project?.worktree ?? sdk.directory)
  const projects = createMemo(() => {
    const roots = serverSync.data.project.map((project) => project.worktree)
    if (roots.includes(projectRoot())) return roots
    return [projectRoot(), ...roots]
  })
  const branch = createMemo(() => sync.data.vcs?.branch ?? MAIN_WORKTREE)

  const openProject = (directory: string | undefined) => {
    if (!directory) return
    if (directory === projectRoot()) return
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}/session`)
  }

  return (
    <div data-component="session-new-design" class="relative size-full overflow-hidden bg-v2-background-bg-deep">
      <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
        <div class="w-full max-w-[720px]">
          <WordmarkV2 class="h-auto w-full text-v2-icon-icon-base" />
          <div class="mt-8">
            {props.children}
            <div class="mt-3 flex h-7 items-center gap-0 pl-2">
              <Select
                size="normal"
                variant="ghost"
                options={projects()}
                current={projectRoot()}
                label={getFilename}
                onSelect={openProject}
                class="max-w-[203px] justify-start text-text-base [&_[data-component=icon]]:text-v2-icon-icon-muted"
                valueClass="truncate text-[length:13px] font-[440] text-v2-text-text-faint"
              />
              <div class="relative">
                <div class="pointer-events-none absolute left-2 top-1/2 z-10 flex size-4 -translate-y-1/2 items-center justify-center">
                  <Icon name="branch" size="small" />
                </div>
                <Select
                  size="normal"
                  variant="ghost"
                  options={[branch()]}
                  current={branch()}
                  class="max-w-[240px] justify-start text-text-base [&_[data-component=icon]]:text-v2-icon-icon-muted"
                  valueClass="truncate pl-5 font-[440] text-v2-text-text-faint"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
