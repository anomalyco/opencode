import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createSignal, createMemo, createResource, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { showToast } from "@opencode-ai/ui/toast"
import { DialogSessionRename } from "./dialog-session-rename"
import { DateTime } from "luxon"
import type { Session } from "@opencode-ai/sdk/v2/client"

interface DialogSessionListProps {
  currentSessionId?: string
  onSelect: (session: Session) => void
}

export function DialogSessionList(props: DialogSessionListProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const [search, setSearch] = createSignal("")
  const [deleting, setDeleting] = createSignal<string>()

  const [searchResults] = createResource(
    () => search().trim(),
    async (query) => {
      if (!query) return undefined
      const result = await sdk.client.session.list({ search: query, limit: 30 })
      return result.data ?? []
    },
  )

  const sessions = createMemo(() => {
    const results = searchResults()
    const localSessions = sync.data.session ?? []
    const source = results ?? localSessions
    return source.filter((s) => !s.parentID).toSorted((a, b) => b.time.updated - a.time.updated)
  })

  const groupedSessions = createMemo(() => {
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 86400000).toDateString()
    const groups: Record<string, Session[]> = {}

    for (const session of sessions()) {
      const date = new Date(session.time.updated)
      let category = date.toDateString()
      if (category === today) category = "Today"
      else if (category === yesterday) category = "Yesterday"

      if (!groups[category]) groups[category] = []
      groups[category].push(session)
    }

    return Object.entries(groups)
  })

  async function handleDelete(session: Session) {
    if (deleting() === session.id) {
      setDeleting(undefined)
      try {
        await sdk.client.session.delete({ sessionID: session.id })
        showToast({ title: "Session deleted" })
      } catch (err) {
        showToast({ title: "Failed to delete session", description: String(err) })
      }
      return
    }
    setDeleting(session.id)
  }

  function handleRename(session: Session) {
    dialog.show(() => <DialogSessionRename session={session} />)
  }

  function handleSelect(session: Session) {
    props.onSelect(session)
    dialog.close()
  }

  return (
    <Dialog title="Sessions" class="w-[500px] max-w-[90vw]">
      <div class="flex flex-col gap-4 px-2.5 pb-3">
        <TextField
          autofocus
          type="text"
          placeholder="Search sessions..."
          value={search()}
          onChange={setSearch}
          class="w-full"
        />
        <div class="max-h-[400px] overflow-y-auto -mx-2.5 px-2.5">
          <Show
            when={sessions().length > 0}
            fallback={
              <div class="py-8 text-center text-14-regular text-text-weak">
                {search() ? "No sessions found" : "No sessions yet"}
              </div>
            }
          >
            <div class="flex flex-col gap-4">
              <For each={groupedSessions()}>
                {([category, items]) => (
                  <div class="flex flex-col gap-1">
                    <div class="text-12-medium text-text-weak px-2 py-1">{category}</div>
                    <For each={items}>
                      {(session) => (
                        <div
                          class="group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors"
                          classList={{
                            "bg-surface-info-base": props.currentSessionId === session.id,
                            "hover:bg-surface-raised-base-hover": props.currentSessionId !== session.id,
                            "bg-surface-critical-base/20": deleting() === session.id,
                          }}
                          onClick={() => handleSelect(session)}
                        >
                          <div class="flex-1 min-w-0">
                            <div class="text-14-regular text-text-strong truncate">
                              {deleting() === session.id ? "Click delete again to confirm" : session.title}
                            </div>
                            <div class="text-12-regular text-text-weak">
                              {DateTime.fromMillis(session.time.updated).toRelative()}
                            </div>
                          </div>
                          <div
                            class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Tooltip value="Rename">
                              <IconButton icon="edit-small-2" variant="ghost" onClick={() => handleRename(session)} />
                            </Tooltip>
                            <Tooltip value={deleting() === session.id ? "Click to confirm" : "Delete"}>
                              <IconButton
                                icon="close"
                                variant="ghost"
                                class={deleting() === session.id ? "text-text-critical" : ""}
                                onClick={() => handleDelete(session)}
                              />
                            </Tooltip>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
