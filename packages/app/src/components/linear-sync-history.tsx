import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

/**
 * Per-outcome counts for a single sync operation (per ADR-0002 D9 / Amendment
 * 2026-07-19). Replaces the previous single `count` field with explicit
 * per-outcome tracking so the UI can render "↑N ✓M ·K ✗F" instead of a single
 * opaque number.
 *
 * Semantics:
 * - `moved`: items that crossed the sync boundary — `pulled` for pull (newly
 *   inserted from cloud) or `pushed` for push (items sent to cloud). The
 *   direction is implied by `SyncEntry.type`.
 * - `updated`: items reconciled in place (pull only; cloud `updatedAt` moved
 *   and content fields changed). Always 0 for push.
 * - `skipped`: items left untouched — pull: linked issues whose cloud
 *   `updatedAt` matches the local `last_pulled_at` watermark (or whose
 *   content fields are identical, only the watermark is refreshed); push:
 *   always 0 (push has no "skip" outcome).
 * - `deleted`: items removed locally because the cloud archived them
 *   (pull only). Always 0 for push.
 * - `failed`: items that errored during sync (both directions).
 */
export type SyncOutcomes = {
  moved: number
  updated: number
  skipped: number
  deleted: number
  failed: number
}

export type SyncEntry = {
  id: string
  type: "push" | "pull"
  timestamp: number
  outcomes: SyncOutcomes
  status: "success" | "error"
  error?: string
}

// Module-level singleton state for the sync history (per AGENTS.md: prefer
// createStore over multiple createSignal calls). `idCounter` is wrapped in
// the store to avoid a top-level `let` binding.
const [state, setState] = createStore({
  entries: [] as SyncEntry[],
  isSyncing: false,
  syncType: null as "push" | "pull" | null,
  idCounter: 0,
})

const nextId = () => {
  setState("idCounter", (n) => n + 1)
  return `sync-${state.idCounter}`
}

export function useSyncHistory() {
  function record(entry: Omit<SyncEntry, "id" | "timestamp">) {
    const next: SyncEntry = {
      ...entry,
      id: nextId(),
      timestamp: Date.now(),
    }
    setState("entries", (prev) => [next, ...prev].slice(0, 10))
  }

  return {
    entries: () => state.entries,
    record,
    clear: () => setState("entries", []),
    isSyncing: () => state.isSyncing,
    syncType: () => state.syncType,
    setIsSyncing: (v: boolean) => setState("isSyncing", v),
    setSyncType: (v: "push" | "pull" | null) => setState("syncType", v),
  }
}

/**
 * Render the per-outcome counts as a compact graphical string using arrows
 * and symbols instead of localised text labels. Per ADR-0002 Amendment
 * 2026-07-19, the sidebar's sync history has limited horizontal space, so
 * the display uses graphical indicators:
 *   ↗ / ↙  — operation direction (push / pull)
 *   ↑N     — items moved across the sync boundary (pulled from cloud or pushed to cloud)
 *   ✓N     — items reconciled in place (pull only)
 *   ·N     — items skipped (watermark-only refresh)
 *   ✗N     — items that errored
 * Zero-valued outcomes are omitted to save space.
 */
const OutcomeCounts = (props: { type: "push" | "pull"; outcomes: SyncOutcomes }) => {
  return (
    <span class="flex items-center gap-1.5 text-text-base">
      <Show when={props.outcomes.moved > 0}>
        <span class="text-text-base">{`${props.outcomes.moved}↑`}</span>
      </Show>
      <Show when={props.outcomes.updated > 0}>
        <span class="text-text-base">{`${props.outcomes.updated}✓`}</span>
      </Show>
      <Show when={props.outcomes.skipped > 0}>
        <span class="text-text-weaker">{`${props.outcomes.skipped}·`}</span>
      </Show>
      <Show when={props.outcomes.deleted > 0}>
        <span class="text-text-weaker">{`${props.outcomes.deleted}🗑`}</span>
      </Show>
      <Show when={props.outcomes.failed > 0}>
        <span class="text-text-error">{`${props.outcomes.failed}✗`}</span>
      </Show>
    </span>
  )
}

export function LinearSyncHistory() {
  const language = useLanguage()
  const history = useSyncHistory()

  return (
    <div class="flex flex-col gap-1">
      <Show when={history.isSyncing()}>
        <div class="flex items-center gap-2 py-1.5 text-12-medium text-text-weak">
          <span class="inline-block size-3 rounded-full border-2 border-current border-t-transparent" />
          <span>{language.t("sidebar.linear.syncHistory.syncing")}</span>
        </div>
      </Show>
      <For each={history.entries()}>
        {(entry) => (
          <div class="flex items-center gap-2 py-1.5 text-12-regular text-text-base border-t border-border-base first:border-t-0">
            {/* Operation direction arrow — graphical indicator per ADR-0002
                Amendment 2026-07-19. Replaces the previous "↗ Linear" /
                "↙ Linear" text labels to save horizontal space. The arrow
                alone is sufficient because the entry is always rendered
                inside the Linear sync panel. */}
            <span class="text-text-weak shrink-0 w-4 text-center">
              {entry.type === "push" ? "↗" : "↙"}
            </span>
            <OutcomeCounts type={entry.type} outcomes={entry.outcomes} />
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
      <Show when={history.entries().length === 0 && !history.isSyncing()}>
        <div class="text-12-regular text-text-weaker py-1.5">{language.t("sidebar.linear.syncHistory.empty")}</div>
      </Show>
    </div>
  )
}
