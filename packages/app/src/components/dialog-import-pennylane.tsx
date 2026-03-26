import { createEffect, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"

type PennylaneClient = {
  source_id: string
  name: string
  email?: string
  phone?: string
  reg_no?: string
  vat_number?: string
  address?: string
  city?: string
  postal_code?: string
  country?: string
}

function PennylaneLogo(props: { class?: string }) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" class={props.class}>
      <circle cx="100" cy="100" r="88" stroke="#3C5068" stroke-width="24" fill="none" />
      <circle cx="82" cy="100" r="36" fill="#2CED71" />
      <circle cx="118" cy="100" r="36" fill="#0A7B5A" />
      <path d="M100 70.72C107.55 77.02 112.36 86.42 112.36 97C112.36 107.58 107.55 116.98 100 123.28C92.45 116.98 87.64 107.58 87.64 97C87.64 86.42 92.45 77.02 100 70.72Z" fill="#0A7B5A" opacity="0.6" />
    </svg>
  )
}

export function DialogImportPennylane(props: {
  onImport: (clients: PennylaneClient[]) => void
}) {
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  const [loading, setLoading] = createSignal(true)
  const [importing, setImporting] = createSignal(false)
  const [clients, setClients] = createSignal<PennylaneClient[]>([])
  const [selected, setSelected] = createStore<Record<string, boolean>>({})
  const [search, setSearch] = createSignal("")

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetcher(`${globalSDK.url}/plugin/pennylane/customers`)
      const data = (await res.json()) as { customers: PennylaneClient[] }
      setClients(data.customers ?? [])
    } catch {
      showToast({ variant: "error", title: "Failed to load clients from Pennylane" })
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    void fetchData()
  })

  const filteredList = () => {
    const q = search().toLowerCase()
    if (!q) return clients()
    return clients().filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.email ?? "").toLowerCase().includes(q) ||
        (e.reg_no ?? "").toLowerCase().includes(q) ||
        (e.city ?? "").toLowerCase().includes(q),
    )
  }

  const selectedCount = () => Object.values(selected).filter(Boolean).length

  const toggleItem = (id: string) => {
    setSelected(id, !selected[id])
  }

  const toggleAll = () => {
    const list = filteredList()
    const allSelected = list.length > 0 && list.every((e) => selected[e.source_id])
    for (const e of list) {
      setSelected(e.source_id, !allSelected)
    }
  }

  const handleImport = () => {
    const items = clients().filter((e) => selected[e.source_id])
    if (items.length === 0) return
    setImporting(true)
    props.onImport(items)
  }

  return (
    <Dialog title="" class="w-full max-w-[520px] mx-auto">
      <div class="flex flex-col gap-0 max-h-[70vh]">
        {/* Header */}
        <div class="flex items-center gap-3 px-6 pb-4">
          <PennylaneLogo class="size-6 shrink-0" />
          <div>
            <h2 class="text-16-medium text-text-strong">Import from Pennylane</h2>
            <p class="text-12-regular text-text-weak">Select clients to add as projects</p>
          </div>
        </div>

        {/* Search */}
        <div class="px-6 pb-3">
          <div class="flex items-center gap-2 bg-surface-base rounded-lg px-3 py-2 border border-border-base">
            <Icon name="magnifying-glass" size="small" class="text-icon-weak shrink-0" />
            <input
              type="text"
              placeholder="Search clients..."
              class="flex-1 bg-transparent text-13-regular text-text-strong outline-none placeholder:text-text-dimmed"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
        </div>

        {/* List */}
        <div class="flex-1 min-h-0 overflow-y-auto px-6">
          <Show when={!loading()} fallback={
            <div class="flex items-center justify-center py-12 text-13-regular text-text-weak">
              Loading clients...
            </div>
          }>
            <Show when={filteredList().length > 0} fallback={
              <div class="flex flex-col items-center justify-center py-12 gap-2">
                <span class="text-13-regular text-text-weak">
                  {clients().length === 0
                    ? "No clients found in Pennylane"
                    : "No results match your search"}
                </span>
              </div>
            }>
              {/* Select all */}
              <button
                type="button"
                class="flex items-center gap-3 w-full px-3 py-2 mb-1 rounded-md hover:bg-surface-base-hover transition-colors text-left cursor-pointer"
                onClick={toggleAll}
              >
                <div
                  class="size-4 rounded border flex items-center justify-center shrink-0 transition-colors"
                  classList={{
                    "bg-interactive-base border-interactive-base": filteredList().length > 0 && filteredList().every((e) => selected[e.source_id]),
                    "border-border-strong": !(filteredList().length > 0 && filteredList().every((e) => selected[e.source_id])),
                  }}
                >
                  <Show when={filteredList().length > 0 && filteredList().every((e) => selected[e.source_id])}>
                    <Icon name="check-small" size="small" class="text-white" />
                  </Show>
                </div>
                <span class="text-12-medium text-text-dimmed">Select all ({filteredList().length})</span>
              </button>

              <For each={filteredList()}>
                {(client) => (
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-colors text-left cursor-pointer"
                    classList={{
                      "bg-interactive-base/5 hover:bg-interactive-base/8": !!selected[client.source_id],
                      "hover:bg-surface-base-hover": !selected[client.source_id],
                    }}
                    onClick={() => toggleItem(client.source_id)}
                  >
                    <div
                      class="size-4 rounded border flex items-center justify-center shrink-0 transition-colors"
                      classList={{
                        "bg-interactive-base border-interactive-base": !!selected[client.source_id],
                        "border-border-strong": !selected[client.source_id],
                      }}
                    >
                      <Show when={selected[client.source_id]}>
                        <Icon name="check-small" size="small" class="text-white" />
                      </Show>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="text-13-medium text-text-strong truncate">{client.name}</div>
                      <div class="flex items-center gap-2 mt-0.5">
                        <Show when={client.reg_no}>
                          <span class="text-11-regular text-text-dimmed">{client.reg_no}</span>
                        </Show>
                        <Show when={client.city}>
                          <span class="text-11-regular text-text-dimmed">{client.city}</span>
                        </Show>
                        <Show when={client.email}>
                          <span class="text-11-regular text-text-dimmed truncate">{client.email}</span>
                        </Show>
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>

        {/* Footer */}
        <div class="shrink-0 flex items-center justify-between px-6 py-4 border-t border-border-weak-base">
          <span class="text-12-regular text-text-dimmed">
            {selectedCount() > 0 ? `${selectedCount()} selected` : "None selected"}
          </span>
          <Button
            variant="primary"
            size="small"
            disabled={selectedCount() === 0 || importing()}
            onClick={handleImport}
          >
            {importing() ? "Importing..." : `Import ${selectedCount() > 0 ? selectedCount() : ""} ${selectedCount() === 1 ? "client" : "clients"}`}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
