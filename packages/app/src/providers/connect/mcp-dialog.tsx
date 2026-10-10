import { Component, createEffect, createMemo, Show } from "solid-js"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { List } from "@opencode/ui/list"
import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { useMcpToggle, type McpControls } from "@/providers/connect/mcp"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

export const DialogSelectMcp: Component<{ directory?: string; controls?: McpControls }> = (props) => {
  const data = useData()
  const sdk = useWorkspaceLocation()
  const language = useLanguage()
  const directory = () => props.directory ?? sdk().directory
  const servers = () => data.location.mcp.server.list({ directory: directory() }) ?? []

  createEffect(() => {
    void data.location.mcp.server.sync({ directory: directory() }).catch(() => undefined)
  })

  const items = createMemo(() =>
    servers()
      .map((server) => ({ name: server.name, status: server.status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = useMcpToggle(directory)
  const enabled = (name: string) => {
    const connected = servers().find((server) => server.name === name)?.status.status === "connected"

    return props.controls?.preview ? (props.controls.states[name] ?? connected) : connected
  }
  const change = (name: string) => {
    if (props.controls) {
      if (!props.controls.pending) props.controls.change(name, !enabled(name))
      return
    }
    if (!toggle.isPending) toggle.mutate(name)
  }

  const enabledCount = createMemo(() => items().filter((i) => enabled(i.name)).length)
  const totalCount = createMemo(() => items().length)

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("dialog.mcp.title")}
          description={language.t("dialog.mcp.description", { enabled: enabledCount(), total: totalCount() })}
        />
      </DialogHeader>
      <DialogBody>
        <List
          class="px-3"
          search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.mcp.empty")}
          key={(x) => x?.name ?? ""}
          items={items}
          filterKeys={["name", "status"]}
          sortBy={(a, b) => a.name.localeCompare(b.name)}
          onSelect={(x) => {
            if (!x || (!props.controls?.preview && x.status === "pending")) return
            change(x.name)
          }}
        >
          {(i) => {
            const mcpStatus = () => servers().find((server) => server.name === i.name)?.status

            const status = () => mcpStatus()?.status

            const statusLabel = () => {
              // A new worktree has staged preferences, not live connection statuses.
              if (props.controls?.preview) return
              const key = status() ? statusLabels[status() as keyof typeof statusLabels] : undefined

              if (!key) return

              return language.t(key)
            }

            const error = () => {
              const s = mcpStatus()

              if (s?.status === "failed") return s.error
            }

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
                    appearance="standard"
                    checked={enabled(i.name)}
                    disabled={
                      (!props.controls?.preview && status() === "pending") ||
                      (props.controls ? props.controls.pending : toggle.isPending && toggle.variables === i.name)
                    }
                    onChange={() => change(i.name)}
                  />
                </div>
              </div>
            )
          }}
        </List>
      </DialogBody>
    </Dialog>
  )
}
