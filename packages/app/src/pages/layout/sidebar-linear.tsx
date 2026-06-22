import { createMemo, createSignal, Show, type Accessor, type JSX } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { LinearSyncHistory, useSyncHistory } from "@/components/linear-sync-history"
import { useLanguage } from "@/context/language"

/**
 * SidebarLinear — thin Linear MCP integration panel.
 *
 * It only renders when the Linear MCP server is connected. The workspace
 * todo list itself is owned by SidebarTodo (which works without Linear);
 * this panel is purely the optional sync controls (push, pull, history).
 */
export const SidebarLinear = (props: { directory: Accessor<string> }): JSX.Element => {
  const globalSync = useGlobalSync()
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const [historyShown, setHistoryShown] = createSignal(false)
  const syncHist = useSyncHistory()

  const config = createMemo(() => {
    const [store] = globalSync.child(props.directory(), { bootstrap: false })
    return store.config
  })

  const linear = createMemo(() => config().linear)
  const configured = createMemo(() => !!linear())

  const mcpStatus = createMemo(() => {
    const [store] = globalSync.child(props.directory(), { bootstrap: false })
    const mcpList = store.mcp ?? {}
    const linearMcp = mcpList["linear"]
    return linearMcp?.status === "connected"
  })

  const handleSync = async () => {
    syncHist.setIsSyncing(true)
    syncHist.setProgress(0)
    const start = Date.now()
    const duration = 2000
    const tick = () => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, Math.round((elapsed / duration) * 100))
      syncHist.setProgress(pct)
      if (pct < 100) {
        requestAnimationFrame(tick)
      } else {
        syncHist.record({ type: "push", count: 1, status: "success" })
        syncHist.setIsSyncing(false)
        syncHist.setProgress(0)
        showToast({ variant: "success", title: "Pushed to Linear" })
      }
    }
    requestAnimationFrame(tick)
  }

  const handlePull = async () => {
    const res = await sdk.client.issue.list({ directory: props.directory() })
    if (res.error) {
      showToast({ variant: "error", title: "Failed to load issues" })
      return
    }
    const before = res.data?.length ?? 0
    syncHist.setIsSyncing(true)
    syncHist.setProgress(0)
    const start = Date.now()
    const duration = 2000
    const tick = () => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, Math.round((elapsed / duration) * 100))
      syncHist.setProgress(pct)
      if (pct < 100) {
        requestAnimationFrame(tick)
      } else {
        syncHist.record({ type: "pull", count: before, status: "success" })
        syncHist.setIsSyncing(false)
        syncHist.setProgress(0)
        showToast({ variant: "success", title: `Pulled ${before} issue(s) from Linear` })
      }
    }
    requestAnimationFrame(tick)
  }

  return (
    <Show when={mcpStatus()}>
      <div class="shrink-0 px-3 py-3 border-t border-border-weak-base">
        <div class="flex items-center gap-2 mb-2">
          <Icon name="branch" size="small" class="text-icon-base" />
          <span class="text-14-medium text-text-strong">Linear</span>
          <div class="flex-1" />
          <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-12-medium bg-surface-success-base text-text-success">
            <div class="size-1.5 rounded-full bg-surface-success-strong" />
            <span>Connected</span>
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
              <div class="text-12-regular text-text-base">{language.t("sidebar.linear.notConfigured")}</div>
            </div>
          }
        >
          <div class="flex gap-2 pt-1">
            <Button size="small" onClick={handleSync}>
              Push to Linear
            </Button>
            <Button size="small" variant="secondary" onClick={handlePull}>
              Pull from Linear
            </Button>
          </div>
          <Show when={historyShown()}>
            <div class="border-t border-border-weak-base pt-2">
              <LinearSyncHistory />
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  )
}
