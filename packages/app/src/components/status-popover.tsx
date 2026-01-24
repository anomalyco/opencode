import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Popover } from "@opencode-ai/ui/popover"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { Icon } from "@opencode-ai/ui/icon"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { normalizeServerUrl, serverDisplayName, useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { DialogSelectServer } from "./dialog-select-server"

type ServerStatus = { healthy: boolean; version?: string }

async function checkHealth(url: string, platform: ReturnType<typeof usePlatform>): Promise<ServerStatus> {
  const sdk = createOpencodeClient({
    baseUrl: url,
    fetch: platform.fetch,
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
  const language = useLanguage()
  const navigate = useNavigate()

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
        results[url] = await checkHealth(url, platform)
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
      return
    }
    if (result) setDefaultServerUrl(normalizeServerUrl(result))
  })

  return (
    <Popover
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class:
          "rounded-sm w-[75px] h-[24px] py-1.5 pr-3 pl-2 gap-2 border-none shadow-none data-[expanded]:bg-surface-raised-base-active",
        style: { scale: 1 },
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
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={6}
      placement="bottom-end"
      shift={-136}
    >
      <div
        class="flex items-center gap-1 w-[360px] rounded-xl"
        style={{ "box-shadow": "var(--shadow-lg-border-base)" }}
      >
        <Tabs
          aria-label="Server Configurations"
          class="tabs"
          data-component="tabs"
          data-active="servers"
          defaultValue="servers"
          variant="alt"
          style={{
            "background-color": "var(--background-strong)",
            "border-radius": "12px",
            overflow: "hidden",
          }}
        >
          <Tabs.List
            data-slot="tablist"
            style={{
              "background-color": "transparent",
              "border-bottom": "none",
              padding: "8px 16px 0",
              gap: "16px",
              height: "40px",
            }}
          >
            <Tabs.Trigger value="servers" data-slot="tab" class="text-12-regular">
              {serverCount() > 0 ? `${serverCount()} ` : ""}Servers
            </Tabs.Trigger>
            <Tabs.Trigger value="mcp" data-slot="tab" class="text-12-regular">
              {mcpConnected() > 0 ? `${mcpConnected()} ` : ""}MCP
            </Tabs.Trigger>
            <Tabs.Trigger value="lsp" data-slot="tab" class="text-12-regular">
              {lspCount() > 0 ? `${lspCount()} ` : ""}LSP
            </Tabs.Trigger>
            <Tabs.Trigger value="plugins" data-slot="tab" class="text-12-regular">
              {pluginCount() > 0 ? `${pluginCount()} ` : ""}Plugins
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="servers">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <For each={sortedServers()}>
                  {(url) => {
                    const isActive = () => url === server.url
                    const isDefault = () => url === defaultServerUrl()
                    const status = () => store.status[url]
                    const isBlocked = () => status()?.healthy === false
                    return (
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full h-8 pl-3 pr-1.5 py-1.5 rounded-md transition-colors text-left"
                        classList={{
                          "opacity-50": isBlocked(),
                          "hover:bg-surface-raised-base-hover": !isBlocked(),
                          "cursor-not-allowed": isBlocked(),
                        }}
                        aria-disabled={isBlocked()}
                        onClick={() => {
                          if (isBlocked()) return
                          server.setActive(url)
                          navigate("/")
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
                          <span class="text-12-regular text-text-weak truncate">{status()?.version}</span>
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
                  class="mt-3 self-start h-8 px-3 py-1.5"
                  onClick={() => dialog.show(() => <DialogSelectServer />)}
                >
                  Manage servers
                </Button>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="mcp">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <Show
                  when={mcpItems().length > 0}
                  fallback={<div class="text-14-regular text-text-weak text-center">No MCP servers configured</div>}
                >
                  <For each={mcpItems()}>
                    {(item) => {
                      const enabled = () => item.status === "connected"
                      return (
                        <button
                          type="button"
                          class="flex items-center gap-2 w-full h-8 px-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
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
                          <div onClick={(event) => event.stopPropagation()}>
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
            </div>
          </Tabs.Content>

          <Tabs.Content value="lsp">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <Show
                  when={lspItems().length > 0}
                  fallback={
                    <div class="text-14-regular text-text-weak text-center">LSPs auto-detected from file types</div>
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
            </div>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <Show
                  when={plugins().length > 0}
                  fallback={
                    <div class="text-14-regular text-text-weak text-center">
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
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </Popover>
  )
}
