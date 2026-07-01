import { createMemo, createSignal, For, Show } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { showToast } from "@/utils/toast"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { sessionTitle } from "@/utils/session-title"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

/**
 * Empty grid cell — click to open a session in the slot. Lists the
 * directory's existing sessions (excluding the ones already shown) and adds
 * the chosen one via `layout.grid.addCell`. The "New session" entry uses the
 * standard SDK client to create a fresh session in the same directory.
 *
 * Scope: same-directory only. Cross-project session listing and per-cell
 * workspace selection require a future `experimental.session.list` /
 * `experimental.workspace.list` server endpoint plus a workspace-client pool;
 * those are intentionally omitted here.
 */
export function CellSessionPicker(props: { dir: string; primaryId?: string }) {
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const [store] = globalSync.child(props.dir, { bootstrap: false })
  const [open, setOpen] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  const taken = createMemo(() => {
    const set = new Set(layout.grid.cellsByID(props.dir)())
    if (props.primaryId) set.add(props.primaryId)
    return set
  })

  const sessions = createMemo(() => {
    return sortedRootSessions(store, Date.now()).filter((s) => !taken().has(s.id))
  })

  const createSession = async () => {
    setBusy(true)
    try {
      const result = await sdk.client.session.create().catch(() => undefined)
      const sessionID = result?.data?.id
      const directory = result?.data?.directory
      if (!sessionID) {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: "Failed to create session",
        })
        return
      }
      layout.grid.addCell(props.dir, sessionID, {
        directory,
        label: "New Session",
      })
      // Make sure the new session's events flow into the sync store.
      void sync.session.sync(sessionID).catch(() => undefined)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="flex size-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-weak-base bg-background-stronger p-3">
      <DropdownMenu gutter={4} placement="bottom" open={open()} onOpenChange={setOpen}>
        <DropdownMenu.Trigger class="flex flex-col items-center justify-center gap-1 rounded-md px-4 py-3 text-text-weak transition-colors hover:bg-background-base hover:text-text-base">
          <span class="text-16-regular">+</span>
          <span class="text-12-regular">Open session</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="max-h-80 overflow-y-auto">
            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel>New</DropdownMenu.GroupLabel>
              <DropdownMenu.Item disabled={busy()} onSelect={() => void createSession()}>
                <DropdownMenu.ItemLabel>{busy() ? "Creating…" : "New session"}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Group>
            <Show when={sessions().length > 0}>
              <DropdownMenu.Group>
                <DropdownMenu.GroupLabel>Existing sessions</DropdownMenu.GroupLabel>
                <For each={sessions()}>
                  {(s) => (
                    <DropdownMenu.Item
                      onSelect={() => {
                        layout.grid.addCell(props.dir, s.id, { directory: props.dir })
                        setOpen(false)
                      }}
                    >
                      <DropdownMenu.ItemLabel>{sessionTitle(s.title)}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  )}
                </For>
              </DropdownMenu.Group>
            </Show>
            <Show when={sessions().length === 0}>
              <DropdownMenu.Group>
                <DropdownMenu.Item disabled>
                  <DropdownMenu.ItemLabel>No other sessions</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Group>
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
