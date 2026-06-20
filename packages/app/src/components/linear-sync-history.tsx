import { createSignal, For, Show, type Accessor } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"

export type SyncEntry = {
  id: string
  type: "push" | "pull"
  timestamp: number
  count: number
  status: "success" | "error"
  error?: string
}

let idCounter = 0
const nextId = () => `sync-${++idCounter}`

const [entries, setEntries] = createSignal<SyncEntry[]>([])
const [isSyncing, setIsSyncing] = createSignal(false)
const [progress, setProgress] = createSignal(0)

export function useSyncHistory() {
  function record(entry: Omit<SyncEntry, "id" | "timestamp">) {
    const next: SyncEntry = {
      ...entry,
      id: nextId(),
      timestamp: Date.now(),
    }
    setEntries((prev) => [next, ...prev].slice(0, 10))

    showToast({
      variant: entry.status === "success" ? "success" : "error",
      title: `Synced ${entry.count} item${entry.count !== 1 ? "s" : ""}`,
    })
  }

  return {
    entries: entries as Accessor<SyncEntry[]>,
    record,
    clear: () => setEntries([]),
    isSyncing: isSyncing as Accessor<boolean>,
    progress: progress as Accessor<number>,
    setIsSyncing,
    setProgress,
  }
}

export function LinearSyncHistory() {
  const { entries: syncEntries, isSyncing: syncing, progress: pct } = useSyncHistory()

  // TODO: wire to Todo.Progressed event in T17
  // Subscribe to global SDK events for automatic sync recording:
  // const globalSDK = useGlobalSDK()
  // createEffect(() => {
  //   const s = globalSDK
  //   // watch for todo changes
  // })

  return (
    <div class="flex flex-col gap-1">
      <Show when={syncing()}>
        <div class="flex items-center gap-2 py-1.5 text-12-medium text-text-weak">
          <span class="inline-block size-3 rounded-full border-2 border-current border-t-transparent" />
          <span>Syncing... {pct()}%</span>
        </div>
      </Show>
      <For each={syncEntries()}>
        {(entry) => (
          <div class="flex items-center gap-2 py-1.5 text-12-regular text-text-base border-t border-border-base first:border-t-0">
            <span class="text-text-weak shrink-0">
              {entry.type === "push" ? "↗" : "↙"} Linear
            </span>
            <span class="truncate">
              {entry.count} item{entry.count !== 1 ? "s" : ""}
            </span>
            <span class="text-text-weaker shrink-0">
              {new Date(entry.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <div class="flex-1" />
            <Show when={entry.status === "error"}>
              <span class="text-text-error" title={entry.error}>
                Error
              </span>
            </Show>
            <Show when={entry.status === "success"}>
              <Icon name="check" size="small" class="text-icon-success-base" />
            </Show>
          </div>
        )}
      </For>
      <Show when={syncEntries().length === 0 && !syncing()}>
        <div class="text-12-regular text-text-weaker py-1.5">No sync history</div>
      </Show>
    </div>
  )
}
