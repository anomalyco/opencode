import { createMemo, createSignal } from "solid-js"
import { reconcile } from "solid-js/store"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"

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

const [pendingAdd, setPendingAdd] = createSignal<string | null>(null)

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  async function refreshStatus() {
    const status = await sdk.client.mcp.status()
    if (status.data) {
      sync.set("mcp", status.data)
    }
  }

  async function promptConfig(type: "remote" | "local") {
    if (type === "remote") {
      const url = await DialogPrompt.show(dialog, "MCP URL", {
        placeholder: "e.g., https://example.com/mcp",
      })
      if (!url) return undefined
      return { type: "remote" as const, url }
    }
    const command = await DialogPrompt.show(dialog, "MCP Command", {
      placeholder: "e.g., opencode x @modelcontextprotocol/server-filesystem",
    })
    if (!command) return undefined
    return { type: "local" as const, command: command.split(" ") }
  }

  async function addMcp() {
    const typeOptions = [
      { value: "remote", title: "Remote (URL)" },
      { value: "local", title: "Local (Command)" },
    ]
    dialog.replace(
      () => (
        <DialogSelect
          title="MCP Type"
          options={typeOptions}
          onSelect={async (option) => {
            const type = option.value as "remote" | "local"

            const name = await DialogPrompt.show(dialog, "MCP Name", {
              placeholder: "e.g. my-server",
            })
            if (!name) {
              dialog.replace(() => <DialogMcp />)
              return
            }

            const config = await promptConfig(type)
            if (!config) {
              dialog.replace(() => <DialogMcp />)
              return
            }

            setPendingAdd(name)
            sync.set("mcp", { ...sync.data.mcp, [name]: { status: "disabled" } })
            dialog.replace(() => <DialogMcp />)
            sdk.client.mcp.add({ name, config }).then(() => {
              refreshStatus()
              toast.show({ variant: "success", message: `MCP "${name}" added` })
            }).catch((error) => {
              console.error("Failed to add MCP:", error)
              toast.show({ variant: "error", message: `Failed to add MCP "${name}"` })
            }).finally(() => {
              setPendingAdd(null)
            })
          }}
        />
      ),
    )
  }

  async function removeMcp(option: DialogSelectOption<string>) {
    if (loading() !== null) return
    setLoading(option.value)
    try {
      await sdk.client.mcp.remove({ name: option.value })
      const { [option.value]: _, ...rest } = sync.data.mcp
      sync.set("mcp", reconcile(rest))
      toast.show({ variant: "success", message: `MCP "${option.value}" removed` })
    } catch (error) {
      console.error("Failed to remove MCP:", error)
      toast.show({ variant: "error", message: `Failed to remove MCP "${option.value}"` })
    } finally {
      setLoading(null)
    }
  }

  const options = createMemo(() => {
    const mcpData = sync.data.mcp
    const loadingMcp = loading()
    const adding = pendingAdd()

    return pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: status.status === "failed" ? "failed" : status.status,
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name || adding === name} />,
        category: undefined,
      })),
    )
  })

  const actions = createMemo(() => [
    {
      command: "dialog.mcp.toggle",
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return
        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          await refreshStatus()
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      command: "dialog.mcp.add",
      title: "add",
      onTrigger: () => {
        addMcp()
      },
    },
    {
      command: "dialog.mcp.remove",
      title: "remove",
      onTrigger: (option: DialogSelectOption<string>) => {
        removeMcp(option)
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="MCPs"
      options={options()}
      actions={actions()}
      onSelect={(_option) => {
        // Don't close on select, only on escape
      }}
    />
  )
}
