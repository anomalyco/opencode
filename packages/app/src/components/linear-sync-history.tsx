import { createSignal, For, Show, type Accessor } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

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
const [syncType, setSyncType] = createSignal<"push" | "pull" | null>(null)

export function useSyncHistory() {
  function record(entry: Omit<SyncEntry, "id" | "timestamp">) {
    const next: SyncEntry = {
      ...entry,
      id: nextId(),
      timestamp: Date.now(),
    }
    setEntries((prev) => [next, ...prev].slice(0, 10))
  }

  return {
    entries: entries as Accessor<SyncEntry[]>,
    record,
    clear: () => setEntries([]),
    isSyncing: isSyncing as Accessor<boolean>,
    syncType: syncType as Accessor<"push" | "pull" | null>,
    setIsSyncing,
    setSyncType,
  }
}

export function LinearSyncHistory() {
  const language = useLanguage()
  const { entries: syncEntries, isSyncing: syncing } = useSyncHistory()

  return (
    <div class="flex flex-col gap-1">
      <Show when={syncing()}>
        <div class="flex items-center gap-2 py-1.5 text-12-medium text-text-weak">
          <span class="inline-block size-3 rounded-full border-2 border-current border-t-transparent" />
          <span>{language.t("sidebar.linear.syncHistory.syncing")}</span>
        </div>
      </Show>
      <For each={syncEntries()}>
        {(entry) => (
          <div class="flex items-center gap-2 py-1.5 text-12-regular text-text-base border-t border-border-base first:border-t-0">
            <span class="text-text-weak shrink-0">
              {language.t(entry.type === "push" ? "sidebar.linear.syncHistory.push" : "sidebar.linear.syncHistory.pull")}
            </span>
            <span class="truncate">
              {language.t(entry.count === 1 ? "sidebar.linear.syncHistory.itemCount.one" : "sidebar.linear.syncHistory.itemCount.other", {
                count: entry.count,
              })}
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
                {language.t("sidebar.linear.syncHistory.error")}
              </span>
            </Show>
            <Show when={entry.status === "success"}>
              <Icon name="check" size="small" class="text-icon-success-base" />
            </Show>
          </div>
        )}
      </For>
      <Show when={syncEntries().length === 0 && !syncing()}>
        <div class="text-12-regular text-text-weaker py-1.5">{language.t("sidebar.linear.syncHistory.empty")}</div>
      </Show>
    </div>
  )
}
