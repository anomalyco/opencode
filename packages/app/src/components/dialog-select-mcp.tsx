import { Component, createMemo, createSignal, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"

export const DialogSelectMcp: Component = () => {
  const sync = useSync()
  const sdk = useSDK()
  const [loading, setLoading] = createSignal<string | null>(null)

  const items = createMemo(() =>
    Object.entries(sync.data.mcp ?? {})
      .map(([name, status]) => ({ name, status: status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    const status = sync.data.mcp[name]
    if (status?.status === "connected") {
      await sdk.client.mcp.disconnect({ name })
    } else {
      await sdk.client.mcp.connect({ name })
    }
    const result = await sdk.client.mcp.status()
    if (result.data) sync.set("mcp", result.data)
    setLoading(null)
  }

  const enabledCount = createMemo(() => items().filter((i) => i.status === "connected").length)
  const totalCount = createMemo(() => items().length)

  return (
    <Dialog title="MCPs" description={`${enabledCount()} of ${totalCount()} enabled`}>
      <List
        search={{ placeholder: "Search", autofocus: true }}
        emptyMessage="No MCPs configured"
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name", "status"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={(x) => {
          if (x) toggle(x.name)
        }}
      >
        {(i) => {
          const mcpStatus = () => sync.data.mcp[i.name]
          const status = () => mcpStatus()?.status
          const error = () => {
            const s = mcpStatus()
            return s?.status === "failed" ? s.error : undefined
          }
          const enabled = () => status() === "connected"
          return (
            <div class="w-full flex items-center justify-between gap-x-3">
              <div class="flex flex-col gap-0.5 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate">{i.name}</span>
                  <Show when={status() === "connected"}>
                    <span class="text-11-regular text-text-weaker">connected</span>
                  </Show>
                  <Show when={status() === "failed"}>
                    <span class="text-11-regular text-text-weaker">failed</span>
                  </Show>
                  <Show when={status() === "needs_auth"}>
                    <span class="text-11-regular text-text-weaker">needs auth</span>
                  </Show>
                  <Show when={status() === "disabled"}>
                    <span class="text-11-regular text-text-weaker">disabled</span>
                  </Show>
                  <Show when={loading() === i.name}>
                    <span class="text-11-regular text-text-weak">...</span>
                  </Show>
                </div>
                <Show when={error()}>
                  <span class="text-11-regular text-text-weaker truncate">{error()}</span>
                </Show>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Switch checked={enabled()} disabled={loading() === i.name} onChange={() => toggle(i.name)} />
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
