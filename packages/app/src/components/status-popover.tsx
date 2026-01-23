import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { Switch } from "@opencode-ai/ui/switch"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Tag } from "@opencode-ai/ui/tag"
import { serverDisplayName, useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { DialogSelectServer } from "./dialog-select-server"

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

function getPluginName(plugin: string): string {
  if (plugin.startsWith("file://")) {
    const filename = plugin.split("/").pop() ?? plugin
    return filename.replace(/\.(js|ts|mjs|mts)$/, "")
  }
  const lastAtIndex = plugin.lastIndexOf("@")
  if (lastAtIndex > 0) {
    return plugin.substring(0, lastAtIndex)
  }
  return plugin
}

function getShortVersion(version: string): string {
  const match = version.match(/^(\d+\.\d+\.\d+)/)
  return match ? match[1] : version
}

export type StatusPopoverProps = {
  sync?: {
    data: {
      mcp: Record<string, { status: string; error?: string }>
      lsp: Array<{ name: string; status: string }>
      config: { plugin?: string[] }
    }
    set: (key: string, value: unknown) => void
  }
  sdk?: {
    client: {
      mcp: {
        connect: (input: { name: string }) => Promise<unknown>
        disconnect: (input: { name: string }) => Promise<unknown>
        status: () => Promise<{ data?: Record<string, { status: string }> }>
      }
    }
  }
}

type TabValue = "servers" | "mcp" | "lsp" | "plugins"

export function StatusPopover(props: StatusPopoverProps = {}) {
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()

  const [activeTab, setActiveTab] = createSignal<TabValue>("servers")
  const [healthCache, setHealthCache] = createStore<Record<string, ServerStatus>>({})
  const [mcpLoading, setMcpLoading] = createSignal<string | null>(null)
  const [open, setOpen] = createSignal(false)

  const hasSync = createMemo(() => !!props.sync)

  const [defaultServerUrl, { refetch: refetchDefaultUrl }] = createResource(() => platform.getDefaultServerUrl?.())

  const serverItems = createMemo(() => {
    const current = server.url
    const def = defaultServerUrl()
    const list = server.list
    const all = current && !list.includes(current) ? [current, ...list] : list
    return all.slice().sort((a, b) => {
      if (a === def) return -1
      if (b === def) return 1
      if (a === current) return -1
      if (b === current) return 1
      return 0
    })
  })

  const serverCount = createMemo(() => serverItems().length)

  const mcpItems = createMemo(() => {
    if (!props.sync?.data?.mcp) return []
    return Object.entries(props.sync.data.mcp)
      .map(([name, status]) => ({ name, status: status.status }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const mcpCount = createMemo(() => mcpItems().filter((i) => i.status === "connected").length)

  const lspItems = createMemo(() => {
    if (!props.sync?.data?.lsp) return []
    return props.sync.data.lsp
  })

  const lspCount = createMemo(() => lspItems().filter((s) => s.status === "connected").length)

  const pluginItems = createMemo(() => {
    if (!props.sync?.data?.config?.plugin) return []
    return props.sync.data.config.plugin.map((p) => getPluginName(p))
  })

  const pluginCount = createMemo(() => pluginItems().length)

  const hasServerIssue = createMemo(() => {
    const items = serverItems()
    if (items.length === 0) return false
    return items.some((url) => healthCache[url]?.healthy === false)
  })

  const hasMcpIssue = createMemo(() => {
    return mcpItems().some((i) => i.status === "failed")
  })

  const hasLspIssue = createMemo(() => {
    return lspItems().some((s) => s.status === "error")
  })

  const aggregateStatus = createMemo(() => {
    if (hasServerIssue() || hasMcpIssue() || hasLspIssue()) return "error"
    if (serverItems().some((url) => healthCache[url] === undefined)) return "loading"
    const serverHealthy =
      serverItems().length === 0 || serverItems().every((url) => healthCache[url]?.healthy !== false)
    if (serverHealthy) return "healthy"
    return "loading"
  })

  async function refreshHealth() {
    const results: Record<string, ServerStatus> = {}
    await Promise.all(
      serverItems().map(async (url) => {
        results[url] = await checkHealth(url, platform.fetch)
      }),
    )
    setHealthCache(reconcile(results))
  }

  createEffect(() => {
    if (!open()) return
    serverItems()
    refreshHealth()
    refetchDefaultUrl()
    const interval = setInterval(refreshHealth, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  async function toggleMcp(name: string) {
    if (!props.sdk || mcpLoading()) return
    setMcpLoading(name)
    const status = props.sync?.data?.mcp[name]
    if (status?.status === "connected") {
      await props.sdk.client.mcp.disconnect({ name })
    } else {
      await props.sdk.client.mcp.connect({ name })
    }
    const result = await props.sdk.client.mcp.status()
    if (result.data && props.sync) props.sync.set("mcp", result.data)
    setMcpLoading(null)
  }

  function openManageServers() {
    setOpen(false)
    dialog.show(() => <DialogSelectServer />)
  }

  const tabs: { value: TabValue; label: () => string }[] = [
    {
      value: "servers",
      label: () =>
        language.t(serverCount() === 1 ? "status.tab.servers.one" : "status.tab.servers.other", {
          count: serverCount(),
        }),
    },
    {
      value: "mcp",
      label: () => language.t(mcpCount() === 1 ? "status.tab.mcp.one" : "status.tab.mcp.other", { count: mcpCount() }),
    },
    {
      value: "lsp",
      label: () => language.t(lspCount() === 1 ? "status.tab.lsp.one" : "status.tab.lsp.other", { count: lspCount() }),
    },
    {
      value: "plugins",
      label: () =>
        language.t(pluginCount() === 1 ? "status.tab.plugins.one" : "status.tab.plugins.other", {
          count: pluginCount(),
        }),
    },
  ]

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      class="w-fit max-w-none rounded-xl"
      trigger={
        <Tooltip value={language.t("status.button.tooltip")}>
          <Button variant="secondary" class="gap-1.5" style={{ scale: 1 }}>
            <div
              classList={{
                "size-1.5 rounded-full": true,
                "bg-icon-success-base": aggregateStatus() === "healthy",
                "bg-icon-critical-base": aggregateStatus() === "error",
                "bg-border-weak-base": aggregateStatus() === "loading",
              }}
            />
            {language.t("status.button.label")}
          </Button>
        </Tooltip>
      }
    >
      <div class="pt-2 px-0 pb-0">
        <div class="flex gap-6 justify-start mb-0 pl-2">
          <For each={tabs}>
            {(tab) => (
              <button
                type="button"
                onClick={() => setActiveTab(tab.value)}
                class="pb-2 text-14-medium transition-colors border-b-2 -mb-px"
                classList={{
                  "text-text-strong border-text-strong": activeTab() === tab.value,
                  "text-text-weak border-transparent hover:text-text-strong": activeTab() !== tab.value,
                }}
              >
                {tab.label()}
              </button>
            )}
          </For>
        </div>

        <div class="bg-surface-raised-base rounded-sm -mx-1 -mb-1 pt-4 px-5 pb-4">
          <div class="grid [&>*]:col-start-1 [&>*]:row-start-1">
            <div class="flex flex-col gap-1" classList={{ invisible: activeTab() !== "servers" }}>
              <Show
                when={serverItems().length > 0}
                fallback={
                  <div class="w-full h-full flex items-center justify-center text-14-regular text-text-weak py-6 text-center">
                    {language.t("status.servers.empty")}
                  </div>
                }
              >
                <div class="flex flex-col gap-2 max-h-28 overflow-y-auto -mr-5 status-popover-scroll">
                  <For each={serverItems()}>
                    {(url) => {
                      const isDefault = () => defaultServerUrl() === url
                      const isActive = () => server.url === url
                      return (
                        <div class="flex items-center gap-3 py-1 whitespace-nowrap pr-4">
                          <div
                            classList={{
                              "size-1.5 rounded-full shrink-0": true,
                              "bg-icon-success-base": healthCache[url]?.healthy === true,
                              "bg-icon-critical-base": healthCache[url]?.healthy === false,
                              "bg-border-weak-base": healthCache[url] === undefined,
                            }}
                          />
                          <span class="text-14-medium text-text-strong">{serverDisplayName(url)}</span>
                          <Show when={healthCache[url]?.version}>
                            <span class="text-14-medium text-text-weak">
                              v{getShortVersion(healthCache[url]!.version!)}
                            </span>
                          </Show>
                          <Show when={isDefault()}>
                            <Tag>{language.t("common.default")}</Tag>
                          </Show>
                          <div class="flex-1" />
                          <div class="w-5 shrink-0">
                            <Show when={isActive()}>
                              <Icon name="check" class="text-text-strong" />
                            </Show>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
              <Button
                variant="secondary"
                size="small"
                class="mt-3 self-start py-4 px-3 text-14-medium -ml-2"
                onClick={openManageServers}
              >
                {language.t("status.servers.manage")}
              </Button>
            </div>

            <div classList={{ invisible: activeTab() !== "mcp" }}>
              <Show
                when={hasSync()}
                fallback={
                  <div class="w-full h-full flex items-center justify-center text-14-regular text-text-weak py-6 text-center">
                    {language.t("status.noProject")}
                  </div>
                }
              >
                <Show
                  when={mcpItems().length > 0}
                  fallback={
                    <div class="w-full h-full flex items-center justify-center text-14-regular text-text-weak py-6 text-center">
                      {language.t("status.mcp.empty")}
                    </div>
                  }
                >
                  <div class="flex flex-col gap-2 max-h-28 overflow-y-auto -mr-5 status-popover-scroll">
                    <For each={mcpItems()}>
                      {(item) => {
                        const mcpStatus = () => props.sync!.data.mcp[item.name]
                        const status = () => mcpStatus()?.status
                        const enabled = () => status() === "connected"
                        return (
                          <div class="flex items-center gap-3 py-1 pr-4">
                            <div class="flex items-center gap-3 min-w-0 flex-1">
                              <div
                                classList={{
                                  "size-1.5 rounded-full shrink-0": true,
                                  "bg-icon-success-base": status() === "connected",
                                  "bg-icon-critical-base": status() === "failed",
                                  "bg-border-weak-base": status() !== "connected" && status() !== "failed",
                                }}
                              />
                              <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                              <Show when={status() === "failed"}>
                                <span class="text-icon-critical-base text-12-regular">
                                  {language.t("mcp.status.failed")}
                                </span>
                              </Show>
                              <Show when={status() === "needs_auth"}>
                                <span class="text-12-regular text-text-weak">
                                  {language.t("mcp.status.needs_auth")}
                                </span>
                              </Show>
                              <Show when={mcpLoading() === item.name}>
                                <span class="text-12-regular text-text-weak">
                                  {language.t("common.loading.ellipsis")}
                                </span>
                              </Show>
                            </div>
                            <Switch
                              checked={enabled()}
                              disabled={mcpLoading() === item.name}
                              onChange={() => toggleMcp(item.name)}
                            />
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>

            <div classList={{ invisible: activeTab() !== "lsp" }}>
              <Show
                when={hasSync()}
                fallback={
                  <div class="w-full h-full flex items-center justify-center text-14-regular text-text-weak py-6 text-center">
                    {language.t("status.noProject")}
                  </div>
                }
              >
                <Show
                  when={lspItems().length > 0}
                  fallback={
                    <div class="w-full h-full flex items-center justify-center text-14-regular text-text-weak py-6 text-center">
                      {language.t("status.lsp.empty")}
                    </div>
                  }
                >
                  <div class="flex flex-col gap-2 max-h-28 overflow-y-auto -mr-5 status-popover-scroll">
                    <For each={lspItems()}>
                      {(item) => (
                        <div class="flex items-center gap-3 py-1">
                          <div
                            classList={{
                              "size-1.5 rounded-full shrink-0": true,
                              "bg-icon-success-base": item.status === "connected",
                              "bg-icon-critical-base": item.status === "error",
                            }}
                          />
                          <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>

            <div classList={{ invisible: activeTab() !== "plugins" }}>
              <Show
                when={hasSync()}
                fallback={
                  <div class="w-full h-full flex items-center justify-center text-14-regular text-text-weak py-6 text-center">
                    {language.t("status.noProject")}
                  </div>
                }
              >
                <Show
                  when={pluginItems().length > 0}
                  fallback={
                    <div class="w-full h-full flex items-center justify-center text-14-regular text-text-weak py-6 text-center">
                      {language.t("status.plugins.empty")}
                    </div>
                  }
                >
                  <div class="flex flex-col gap-2 max-h-28 overflow-y-auto -mr-5 status-popover-scroll">
                    <For each={pluginItems()}>
                      {(name) => (
                        <div class="flex items-center gap-3 py-1 whitespace-nowrap">
                          <div class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
                          <span class="text-14-medium text-text-strong">{name}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Popover>
  )
}
