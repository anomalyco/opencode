import { createMemo, createSignal, createEffect, Show, onMount, onCleanup } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useDialogEscape } from "@tui/ui/dialog"

function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

type ToolInfo = {
  name: string
  description: string
  id: string
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [selectedMcp, setSelectedMcp] = createSignal<string | null>(null)
  const [tools, setTools] = createSignal<ToolInfo[]>([])
  const [toolsLoading, setToolsLoading] = createSignal(false)
  const [toolLoading, setToolLoading] = createSignal<string | null>(null)

  const isDrilledDown = createMemo(() => selectedMcp() !== null)

  const mcpOptions = createMemo(() => {
    const mcpData = sync.data.mcp
    const loadingMcp = loading()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: status.status === "failed" ? "failed" : status.status,
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name} />,
        category: undefined,
      })),
    )
  })

  const toolOptions = createMemo(() => {
    const toolList = tools()
    const cfg = sync.data.config
    const currentToolLoading = toolLoading()

    return toolList.map((tool) => {
      const isEnabled = cfg?.tools?.[tool.id] !== false
      return {
        value: tool.id,
        title: tool.name,
        description: tool.description || "",
        footer: <Status enabled={isEnabled} loading={currentToolLoading === tool.id} />,
        category: undefined,
      }
    })
  })

  const currentOptions = createMemo(() => {
    return isDrilledDown() ? toolOptions() : mcpOptions()
  })

  createEffect(() => {
    const mcp = selectedMcp()
    if (!mcp) {
      setTools([])
      setToolsLoading(false)
      return
    }

    const status = sync.data.mcp[mcp]
    if (status?.status !== "connected") {
      setTools([])
      setToolsLoading(false)
      return
    }

    let cancelled = false

    setToolsLoading(true)
    local.mcp
      .getTools(mcp)
      .then((data) => {
        if (!cancelled && selectedMcp() === mcp) {
          setTools(data)
        }
      })
      .catch((error) => {
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
    }
  })

  useDialogEscape(() => {
    if (isDrilledDown()) {
      setSelectedMcp(null)
      setTools([])
      return true
    }
    return false
  })

  const keybinds = createMemo(() => {
    if (isDrilledDown()) {
      return [
        {
          keybind: Keybind.parse("escape")[0],
          title: "back",
          onTrigger: () => {
            setSelectedMcp(null)
            setTools([])
          },
        },
        {
          keybind: Keybind.parse("space")[0],
          title: "toggle tool",
          onTrigger: async (option: DialogSelectOption<string>) => {
            if (toolLoading() !== null) return

            const mcp = selectedMcp()
            if (!mcp) return

            const tool = tools().find((t) => t.id === option.value)
            if (!tool) return

            setToolLoading(option.value)
            try {
              await local.mcp.toggleTool(mcp, tool.name)
              const config = await sdk.client.config.get()
              if (config.data) {
                sync.set("config", config.data)
              }
            } catch (error) {
              console.error("Failed to toggle tool:", error)
            } finally {
              setToolLoading(null)
            }
          },
        },
      ]
    }

    return [
      {
        keybind: Keybind.parse("space")[0],
        title: "toggle",
        onTrigger: async (option: DialogSelectOption<string>) => {
          if (loading() !== null) return

          setLoading(option.value)
          try {
            await local.mcp.toggle(option.value)
            const status = await sdk.client.mcp.status()
            if (status.data) {
              sync.set("mcp", status.data)
            }
          } catch (error) {
            console.error("Failed to toggle MCP:", error)
          } finally {
            setLoading(null)
          }
        },
      },
      {
        keybind: Keybind.parse("return")[0],
        title: "view tools",
        onTrigger: async (option: DialogSelectOption<string>) => {
          const status = sync.data.mcp[option.value]
          if (status?.status === "connected") {
            setSelectedMcp(option.value)
          }
        },
      },
    ]
  })

  return (
    <DialogSelect
      ref={setRef}
      title={isDrilledDown() ? `Tools: ${selectedMcp()}` : "MCPs"}
      options={currentOptions()}
      keybind={keybinds()}
      onSelect={(option) => {
        if (isDrilledDown()) {
          return
        }
        const status = sync.data.mcp[option.value]
        if (status?.status === "connected") {
          setSelectedMcp(option.value)
        }
      }}
    />
  )
}
