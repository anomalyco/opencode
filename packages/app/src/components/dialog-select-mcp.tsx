import { Component, createMemo, createSignal, Show, createEffect } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { Button } from "@opencode-ai/ui/button"

type ToolInfo = {
  name: string
  description: string
  id: string
}

export const DialogSelectMcp: Component = () => {
  const sync = useSync()
  const sdk = useSDK()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [selectedMcp, setSelectedMcp] = createSignal<string | null>(null)
  const [tools, setTools] = createSignal<ToolInfo[]>([])
  const [toolsLoading, setToolsLoading] = createSignal(false)
  const [toolLoading, setToolLoading] = createSignal<string | null>(null)

  const isDrilledDown = createMemo(() => selectedMcp() !== null)

  const items = createMemo(() =>
    Object.entries(sync.data.mcp ?? {})
      .map(([name, status]) => ({ name, status: status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toolItems = createMemo(() => {
    const toolList = tools()
    const cfg = sync.data.config

    return toolList.map((tool) => {
      const isEnabled = cfg?.tools?.[tool.id] !== false
      return {
        ...tool,
        enabled: isEnabled,
      }
    })
  })

  createEffect(() => {
    const mcp = selectedMcp()
    if (!mcp) {
      setTools([])
      return
    }

    const status = sync.data.mcp[mcp]
    if (status?.status !== "connected") {
      setTools([])
      return
    }

    let cancelled = false
    const abortController = new AbortController()

    setToolsLoading(true)
    fetch(`${sdk.url}/mcp/${encodeURIComponent(mcp)}/tools`, {
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to get tools: ${response.statusText}`)
        }
        return response.json()
      })
      .then((data) => {
        if (!cancelled && selectedMcp() === mcp) {
          setTools(data)
        }
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          return
        }
        if (!cancelled && selectedMcp() === mcp) {
          console.error("Failed to fetch tools:", error)
          setTools([])
        }
      })
      .finally(() => {
        if (!cancelled && selectedMcp() === mcp) {
          setToolsLoading(false)
        }
      })

    return () => {
      cancelled = true
      abortController.abort()
    }
  })

  const toggle = async (name: string) => {
    if (loading() !== null) return
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

  const toggleTool = async (mcpName: string, toolName: string) => {
    if (toolLoading() !== null) return

    const tool = tools().find((t) => t.name === toolName)
    if (!tool) return

    setToolLoading(tool.id)
    try {
      const response = await fetch(
        `${sdk.url}/mcp/${encodeURIComponent(mcpName)}/tools/${encodeURIComponent(toolName)}/toggle`,
        {
          method: "POST",
        },
      )
      if (!response.ok) {
        throw new Error(`Failed to toggle tool: ${response.statusText}`)
      }
      const config = await sdk.client.config.get()
      if (config.data) {
        sync.set("config", config.data)
      }
    } catch (error) {
      console.error("Failed to toggle tool:", error)
    } finally {
      setToolLoading(null)
    }
  }

  const enabledCount = createMemo(() => items().filter((i) => i.status === "connected").length)
  const totalCount = createMemo(() => items().length)

  return (
    <Dialog
      title={isDrilledDown() ? `Tools: ${selectedMcp()}` : "MCPs"}
      description={
        isDrilledDown()
          ? `${toolItems().filter((t) => t.enabled).length} of ${toolItems().length} tools enabled`
          : `${enabledCount()} of ${totalCount()} enabled`
      }
    >
      <Show
        when={isDrilledDown()}
        fallback={
          <List
            search={{ placeholder: "Search", autofocus: true }}
            emptyMessage="No MCPs configured"
            key={(x) => x?.name ?? ""}
            items={items}
            filterKeys={["name", "status"]}
            sortBy={(a, b) => a.name.localeCompare(b.name)}
            onSelect={(x) => {
              if (x) {
                const status = sync.data.mcp[x.name]
                if (status?.status === "connected") {
                  setSelectedMcp(x.name)
                } else {
                  toggle(x.name)
                }
              }
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
        }
      >
        <div class="flex flex-col gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setSelectedMcp(null)
              setTools([])
            }}
            class="self-start"
          >
            ← Back
          </Button>
          <Show
            when={!toolsLoading()}
            fallback={
              <div class="text-11-regular text-text-weaker py-4 text-center">Loading tools...</div>
            }
          >
            <List
              search={{ placeholder: "Search tools", autofocus: true }}
              emptyMessage="No tools available"
              key={(x) => x?.id ?? ""}
              items={toolItems}
              filterKeys={["name", "description"]}
              sortBy={(a, b) => a.name.localeCompare(b.name)}
              onSelect={(x) => {
                if (x && selectedMcp()) {
                  toggleTool(selectedMcp()!, x.name)
                }
              }}
            >
              {(tool) => {
                const loading = () => toolLoading() === tool.id
                return (
                  <div class="w-full flex items-center justify-between gap-x-3">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate">{tool.name}</span>
                        <Show when={tool.enabled}>
                          <span class="text-11-regular text-text-weaker">enabled</span>
                        </Show>
                        <Show when={!tool.enabled}>
                          <span class="text-11-regular text-text-weaker">disabled</span>
                        </Show>
                        <Show when={loading()}>
                          <span class="text-11-regular text-text-weak">...</span>
                        </Show>
                      </div>
                      <Show when={tool.description}>
                        <span class="text-11-regular text-text-weaker truncate">{tool.description}</span>
                      </Show>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={tool.enabled}
                        disabled={loading()}
                        onChange={() => {
                          if (selectedMcp()) {
                            toggleTool(selectedMcp()!, tool.name)
                          }
                        }}
                      />
                    </div>
                  </div>
                )
              }}
            </List>
          </Show>
        </div>
      </Show>
    </Dialog>
  )
}
