import { Component, createMemo, Show } from "solid-js"
import { useData } from "@/context/server"
import { useWorkspaceLocation } from "@/context/location"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/context/language"
import { useMcpToggle } from "@/context/mcp"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

export const DialogSelectMcp: Component = () => {
  const data = useData()
  const sdk = useWorkspaceLocation()
  const language = useLanguage()

  const items = createMemo(() =>
    (data.location.mcp.server.list({ directory: sdk().directory }) ?? [])
      .map((server) => ({ name: server.name, status: server.status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = useMcpToggle()

  const enabledCount = createMemo(() => items().filter((i) => i.status === "connected").length)
  const totalCount = createMemo(() => items().length)

  return (
    <Dialog
      title={language.t("dialog.mcp.title")}
      description={language.t("dialog.mcp.description", { enabled: enabledCount(), total: totalCount() })}
    >
      <List
        class="px-3"
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.mcp.empty")}
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name", "status"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={(x) => {
          if (!x || x.status === "pending" || toggle.isPending) return
          toggle.mutate(x.name)
        }}
      >
        {(i) => {
          const mcpStatus = () =>
            data.location.mcp.server.list({ directory: sdk().directory })?.find((server) => server.name === i.name)?.status
          const status = () => mcpStatus()?.status
          const statusLabel = () => {
            const key = status() ? statusLabels[status() as keyof typeof statusLabels] : undefined
            if (!key) return
            return language.t(key)
          }
          const error = () => {
            const s = mcpStatus()
            if (s?.status === "failed") return s.error
          }
          const enabled = () => status() === "connected"
          return (
            <div class="w-full flex items-center justify-between gap-x-3">
              <div class="flex flex-col gap-0.5 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate">{i.name}</span>
                  <Show when={statusLabel()}>
                    <span class="text-11-regular text-text-weaker">{statusLabel()}</span>
                  </Show>
                </div>
                <Show when={error()}>
                  <span class="text-11-regular text-text-weaker truncate">{error()}</span>
                </Show>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Switch
                  checked={enabled()}
                  disabled={status() === "pending" || (toggle.isPending && toggle.variables === i.name)}
                  onChange={() => {
                    if (toggle.isPending) return
                    toggle.mutate(i.name)
                  }}
                />
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
