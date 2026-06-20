import { createMemo, createSignal, Show, type Accessor, type JSX } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSync } from "@/context/global-sync"
import { LinearSyncHistory, useSyncHistory } from "@/components/linear-sync-history"

export const SidebarLinear = (props: { directory: Accessor<string> }): JSX.Element => {
  const globalSync = useGlobalSync()
  const [historyShown, setHistoryShown] = createSignal(false)
  const syncHist = useSyncHistory()

  const config = createMemo(() => {
    const [store] = globalSync.child(props.directory(), { bootstrap: false })
    return store.config
  })

  const linear = createMemo(() => config().linear)
  const configured = createMemo(() => !!linear())
  const projectId = createMemo(() => linear()?.projectId)
  const teamId = createMemo(() => linear()?.teamId)
  const syncMode = createMemo(() => linear()?.syncMode ?? "manual")

  // MCP connection status - check if Linear MCP is connected
  const mcpStatus = createMemo(() => {
    const [store] = globalSync.child(props.directory(), { bootstrap: false })
    const mcpList = store.mcp ?? {}
    const linearMcp = mcpList["linear"]
    return linearMcp?.status === "connected"
  })

  const handleSync = () => {
    const { setIsSyncing, setProgress, record } = syncHist
    setIsSyncing(true)
    setProgress(0)
    const start = Date.now()
    const duration = 3000
    const tick = () => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, Math.round((elapsed / duration) * 100))
      setProgress(pct)
      if (pct < 100) {
        requestAnimationFrame(tick)
      } else {
        record({ type: "push", count: 1, status: "success" })
        setIsSyncing(false)
        setProgress(0)
      }
    }
    requestAnimationFrame(tick)
  }

  const handlePull = () => {
    const { setIsSyncing, setProgress, record } = syncHist
    setIsSyncing(true)
    setProgress(0)
    const start = Date.now()
    const duration = 3000
    const tick = () => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, Math.round((elapsed / duration) * 100))
      setProgress(pct)
      if (pct < 100) {
        requestAnimationFrame(tick)
      } else {
        record({ type: "pull", count: 1, status: "success" })
        setIsSyncing(false)
        setProgress(0)
      }
    }
    requestAnimationFrame(tick)
  }

  const handleConfigure = () => {
    showToast({
      variant: "default",
      title: "Configure Linear",
      description: "Pending Linear configuration dialog",
    })
  }

  return (
    <div class="shrink-0 px-3 py-3 border-t border-border-weak-base">
      <div class="flex items-center gap-2 mb-2">
        <Icon name="task" size="small" class="text-icon-base" />
        <span class="text-14-medium text-text-strong">Linear</span>
        <div class="flex-1" />
        <div
          classList={{
            "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-12-medium": true,
            "bg-surface-success-base text-text-success": mcpStatus(),
            "bg-surface-error-base text-text-error": !mcpStatus(),
          }}
        >
          <div
            classList={{
              "size-1.5 rounded-full": true,
              "bg-surface-success-strong": mcpStatus(),
              "bg-surface-error-strong": !mcpStatus(),
            }}
          />
          <span>{mcpStatus() ? "Connected" : "Disconnected"}</span>
        </div>
        <button
          type="button"
          class="flex items-center justify-center size-5 rounded hover:bg-surface-raised-base-hover text-text-weak"
          onClick={() => setHistoryShown((prev) => !prev)}
          aria-label="Toggle sync history"
        >
          {historyShown() ? "▾" : "▸"}
        </button>
      </div>

      <Show
        when={configured()}
        fallback={
          <div class="flex flex-col gap-2">
            <div class="text-12-regular text-text-base">Not configured</div>
            <Button size="small" variant="ghost" onClick={handleConfigure}>
              Configure
            </Button>
          </div>
        }
      >
        <div class="flex flex-col gap-2">
          <div class="flex flex-col gap-1 text-12-regular text-text-base">
            <Show when={projectId()}>
              <div class="flex items-center gap-2">
                <span class="text-text-weak">Project:</span>
                <span class="truncate">{projectId()}</span>
              </div>
            </Show>
            <Show when={teamId()}>
              <div class="flex items-center gap-2">
                <span class="text-text-weak">Team:</span>
                <span class="truncate">{teamId()}</span>
              </div>
            </Show>
            <div class="flex items-center gap-2">
              <span class="text-text-weak">Mode:</span>
              <span class="capitalize">{syncMode()}</span>
            </div>
          </div>

          <div class="flex gap-2 pt-1">
            <Button size="small" onClick={handleSync}>
              Sync to Linear
            </Button>
            <Button size="small" variant="secondary" onClick={handlePull}>
              Pull from Linear
            </Button>
            <Button size="small" variant="ghost" onClick={handleConfigure}>
              Configure
            </Button>
          </div>
          <Show when={historyShown()}>
            <div class="border-t border-border-weak-base pt-2">
              <LinearSyncHistory />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
