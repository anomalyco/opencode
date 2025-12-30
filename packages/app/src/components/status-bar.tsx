import { createMemo, Show, type ParentProps } from "solid-js"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { DialogSelectServer } from "@/components/dialog-select-server"

export function StatusBar(props: ParentProps) {
  const dialog = useDialog()
  const server = useServer()
  const sync = useSync()
  const globalSync = useGlobalSync()

  const directoryDisplay = createMemo(() => {
    const directory = sync.data.path.directory || ""
    const home = globalSync.data.path.home || ""
    const short = home && directory.startsWith(home) ? directory.replace(home, "~") : directory
    const branch = sync.data.vcs?.branch
    return branch ? `${short}:${branch}` : short
  })

  return (
    <div class="h-8 w-full shrink-0 flex items-center justify-between px-2 border-t border-border-weak-base bg-background-base">
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1">
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              dialog.show(() => <DialogSelectServer />)
            }}
          >
            <div
              classList={{
                "size-1.5 rounded-full": true,
                "bg-icon-success-base": server.healthy() === true,
                "bg-icon-critical-base": server.healthy() === false,
                "bg-border-weak-base": server.healthy() === undefined,
              }}
            />

            <span class="text-12-regular text-text-weak">{server.name}</span>
          </Button>
        </div>
        <Show when={directoryDisplay()}>
          <span class="text-12-regular text-text-weak">{directoryDisplay()}</span>
        </Show>
      </div>
      <div class="flex items-center">{props.children}</div>
    </div>
  )
}
