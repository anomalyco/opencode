import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Popover } from "@opencode-ai/ui/popover"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { Icon } from "@opencode-ai/ui/icon"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useServer, serverDisplayName, normalizeServerUrl } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { DialogSelectServer } from "./dialog-select-server"

import "./status-popover.css"

type ServerStatus = { healthy: boolean; version?: string }

async function checkHealth(url: string, fetch?: typeof globalThis.fetch): Promise<ServerStatus> {
  const sdk = createOpencodeClient({
    baseUrl: url,
    fetch,
    signal: AbortSignal.timeout(3000),
  })
  return sdk.global
    .health()
    .then((x) => ({ healthy: x.data?.healthy === true, version: x.data?.version }))
    .catch(() => ({ healthy: false }))
}

export function StatusPopover() {
  const sync = useSync()
  const sdk = useSDK()
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()

  const [loading, setLoading] = createSignal<string | null>(null)
  const [store, setStore] = createStore({
    status: {} as Record<string, ServerStatus | undefined>,
  })

  const servers = createMemo(() => {
    const current = server.url
    const list = server.list
    if (!current) return list
    if (!list.includes(current)) return [current, ...list]
    return [current, ...list.filter((x) => x !== current)]
  })

  const sortedServers = createMemo(() => {
    const list = servers()
    if (!list.length) return list
    const active = server.url
    const order = new Map(list.map((url, index) => [url, index] as const))
    const rank = (value?: ServerStatus) => {
      if (value?.healthy === true) return 0
      if (value?.healthy === false) return 2
      return 1
    }
    return list.slice().sort((a, b) => {
      if (a === active) return -1
      if (b === active) return 1
      const diff = rank(store.status[a]) - rank(store.status[b])
      if (diff !== 0) return diff
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  })

  async function refreshHealth() {
    const results: Record<string, ServerStatus> = {}
    await Promise.all(
      servers().map(async (url) => {
        results[url] = await checkHealth(url, platform.fetch)
      }),
    )
    setStore("status", reconcile(results))
  }

  createEffect(() => {
    servers()
    refreshHealth()
    const interval = setInterval(refreshHealth, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  const mcpItems = createMemo(() =>
    Object.entries(sync.data.mcp ?? {})
      .map(([name, status]) => ({ name, status: status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const mcpConnected = createMemo(() => mcpItems().filter((i) => i.status === "connected").length)

  const toggleMcp = async (name: string) => {
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

  const lspItems = createMemo(() => sync.data.lsp ?? [])
  const lspCount = createMemo(() => lspItems().length)
  const plugins = createMemo(() => sync.data.config.plugin ?? [])
  const pluginCount = createMemo(() => plugins().length)

  const overallHealthy = createMemo(() => {
    const serverHealthy = server.healthy() === true
    const anyMcpIssue = mcpItems().some((m) => m.status !== "connected" && m.status !== "disabled")
    return serverHealthy && !anyMcpIssue
  })

  const serverCount = createMemo(() => sortedServers().length)

  const [defaultServerUrl, setDefaultServerUrl] = createSignal<string | undefined>()

  createEffect(() => {
    const result = platform.getDefaultServerUrl?.()
    if (result instanceof Promise) {
      result.then((url) => setDefaultServerUrl(url ? normalizeServerUrl(url) : undefined))
    } else if (result) {
      setDefaultServerUrl(normalizeServerUrl(result))
    }
  })

  return (
    <Popover
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        size: "small",
        class: "status-trigger",
      }}
      trigger={
        <div class="flex items-center gap-1.5">
          <div
            classList={{
              "size-1.5 rounded-full": true,
              "bg-icon-success-base": overallHealthy(),
              "bg-icon-critical-base": !overallHealthy() && server.healthy() !== undefined,
              "bg-border-weak-base": server.healthy() === undefined,
            }}
          />
          <span class="text-12-regular text-text-strong">Status</span>
        </div>
      }
      class="status-popover"
    >
      <Tabs variant="alt" defaultValue="servers">
        <Tabs.List>
          <Tabs.Trigger value="servers">{serverCount() > 0 ? `${serverCount()} ` : ""}Servers</Tabs.Trigger>
          <Tabs.Trigger value="mcp">{mcpConnected() > 0 ? `${mcpConnected()} ` : ""}MCP</Tabs.Trigger>
          <Tabs.Trigger value="lsp">{lspCount() > 0 ? `${lspCount()} ` : ""}LSP</Tabs.Trigger>
          <Tabs.Trigger value="plugins">{pluginCount() > 0 ? `${pluginCount()} ` : ""}Plugins</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="servers">
          <div class="flex flex-col p-3">
            <For each={sortedServers()}>
              {(url) => {
                const isActive = () => url === server.url
                const isDefault = () => url === defaultServerUrl()
                const status = () => store.status[url]
                return (
                  <button
                    type="button"
                    class="flex items-center gap-2 w-full px-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                    classList={{ "opacity-50": status()?.healthy === false }}
                    onClick={() => {
                      if (status()?.healthy !== false) server.setActive(url)
                    }}
                  >
                    <div
                      classList={{
                        "size-1.5 rounded-full shrink-0": true,
                        "bg-icon-success-base": status()?.healthy === true,
                        "bg-icon-critical-base": status()?.healthy === false,
                        "bg-border-weak-base": status() === undefined,
                      }}
                    />
                    <span class="text-14-regular text-text-base truncate">{serverDisplayName(url)}</span>
                    <Show when={status()?.version}>
                      <span class="text-12-regular text-text-weak">{status()?.version}</span>
                    </Show>
                    <Show when={isDefault()}>
                      <span class="text-11-regular text-text-base bg-surface-base px-1.5 py-0.5 rounded-md">
                        Default
                      </span>
                    </Show>
                    <div class="flex-1" />
                    <Show when={isActive()}>
                      <Icon name="check" size="small" class="text-icon-weak shrink-0" />
                    </Show>
                  </button>
                )
              }}
            </For>
            <Button
              variant="secondary"
              class="mt-2 self-start"
              onClick={() => dialog.show(() => <DialogSelectServer />)}
            >
              Manage servers
            </Button>
          </div>
        </Tabs.Content>

        <Tabs.Content value="mcp">
          <div class="flex flex-col p-3">
            <Show
              when={mcpItems().length > 0}
              fallback={<div class="text-14-regular text-text-weak text-center py-4">No MCP servers configured</div>}
            >
              <For each={mcpItems()}>
                {(item) => {
                  const enabled = () => item.status === "connected"
                  return (
                    <button
                      type="button"
                      class="flex items-center gap-2 w-full px-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                      onClick={() => toggleMcp(item.name)}
                      disabled={loading() === item.name}
                    >
                      <div
                        classList={{
                          "size-1.5 rounded-full shrink-0": true,
                          "bg-icon-success-base": item.status === "connected",
                          "bg-icon-critical-base": item.status === "failed",
                          "bg-border-weak-base": item.status === "disabled",
                          "bg-icon-warning-base":
                            item.status === "needs_auth" || item.status === "needs_client_registration",
                        }}
                      />
                      <span class="text-14-regular text-text-base truncate flex-1">{item.name}</span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={enabled()}
                          disabled={loading() === item.name}
                          onChange={() => toggleMcp(item.name)}
                        />
                      </div>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </Tabs.Content>

        <Tabs.Content value="lsp">
          <div class="flex flex-col p-3">
            <Show
              when={lspItems().length > 0}
              fallback={
                <div class="text-14-regular text-text-weak text-center py-4">LSPs auto-detected from file types</div>
              }
            >
              <For each={lspItems()}>
                {(item) => (
                  <div class="flex items-center gap-2 w-full px-2 py-1">
                    <div
                      classList={{
                        "size-1.5 rounded-full shrink-0": true,
                        "bg-icon-success-base": item.status === "connected",
                        "bg-icon-critical-base": item.status === "error",
                      }}
                    />
                    <span class="text-14-regular text-text-base truncate">{item.name || item.id}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Tabs.Content>

        <Tabs.Content value="plugins">
          <div class="flex flex-col p-3">
            <Show
              when={plugins().length > 0}
              fallback={
                <div class="text-14-regular text-text-weak text-center py-4">
                  Plugins configured in{" "}
                  <code class="bg-surface-raised-base px-1.5 py-0.5 rounded-sm">opencode.json</code>
                </div>
              }
            >
              <For each={plugins()}>
                {(plugin) => (
                  <div class="flex items-center gap-2 w-full px-2 py-1">
                    <div class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
                    <span class="text-14-regular text-text-base truncate">{plugin}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Tabs.Content>
      </Tabs>
    </Popover>
  )
}
