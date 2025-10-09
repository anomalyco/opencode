import { Icon, Tooltip } from "@/ui"
import { useSync } from "@/context"
import { Show, createSignal } from "solid-js"

export default function StatusBar() {
  const sync = useSync()
  const [notificationCount] = createSignal(0)

  const version = "0.14.6"

  return (
    <div class="h-6 bg-background-panel border-t border-border-subtle/30 flex items-center justify-between px-3 text-[10px] text-text-muted font-scalable select-none">
      <div class="flex items-center gap-4">
        <Tooltip value={sync.data.path.directory} placement="top">
          <div class="flex items-center gap-1.5 hover:text-text transition-colors cursor-default">
            <Icon name="files" size={14} />
            <span class="truncate max-w-xs">{sync.data.path.directory?.split("/").pop() || "No folder open"}</span>
          </div>
        </Tooltip>

        <Show when={sync.data.path.worktree}>
          <Tooltip value="Current git branch" placement="top">
            <div class="flex items-center gap-1.5 hover:text-text transition-colors cursor-default">
              <Icon name="branch" size={14} />
              <span>{sync.data.path.worktree || "main"}</span>
            </div>
          </Tooltip>
        </Show>
      </div>

      <div class="flex items-center gap-4">
        <Tooltip value={`OpenCode v${version}`} placement="top">
          <div class="hover:text-text transition-colors cursor-default">v{version}</div>
        </Tooltip>

        <Tooltip value="Notifications" placement="top">
          <button class="relative hover:text-text transition-colors p-0.5">
            <Icon name="bell-off" size={16} />
            <Show when={notificationCount() > 0}>
              <span class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary text-background text-[8px] flex items-center justify-center font-bold">
                {notificationCount()}
              </span>
            </Show>
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
