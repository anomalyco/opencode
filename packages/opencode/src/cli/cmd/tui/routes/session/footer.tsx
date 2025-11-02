import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useRenderer } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createSignal, onMount, onCleanup } from "solid-js"

export function Footer() {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()
  const renderer = useRenderer()
  const [serverStatus, setServerStatus] = createSignal<"connected" | "disconnected">("connected")

  // Extract port from URL (e.g., "http://localhost:63609" -> "63609")
  const port = sdk.url.split(":").pop() || "unknown"

  // Ping server periodically to check status
  let pingInterval: NodeJS.Timeout
  onMount(() => {
    pingInterval = setInterval(async () => {
      try {
        const response = await fetch(`${sdk.url}/health`, {
          method: "GET",
          signal: AbortSignal.timeout(1000),
        })
        setServerStatus(response.ok ? "connected" : "disconnected")
      } catch {
        setServerStatus("disconnected")
      }
    }, 5000) // Check every 5 seconds
  })

  onCleanup(() => {
    if (pingInterval) clearInterval(pingInterval)
  })

  const showServerDialog = () => {
    const options: DialogSelectOption<string>[] = [
      {
        title: "Restart Server",
        value: "restart",
        description: "Restart the OpenCode server",
        onSelect: async (ctx) => {
          ctx.clear()
          try {
            await fetch(`${sdk.url}/server/restart`, { method: "POST" })
          } catch (error) {
            console.error("Failed to restart server:", error)
          }
        },
      },
      {
        title: "Copy Server URL",
        value: "copy",
        description: `Copy ${sdk.url} to clipboard`,
        onSelect: (ctx) => {
          // TODO: Implement clipboard copy
          console.log("Server URL:", sdk.url)
          ctx.clear()
        },
      },
    ]

    dialog.replace(() => <DialogSelect title="Server Management" options={options} />)
  }

  return (
    <box
      position="absolute"
      bottom={0}
      left={0}
      right={0}
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={theme.backgroundPanel}
    >
      <text fg={theme.textMuted}>
        Server:{" "}
        <span
          style={{
            fg: serverStatus() === "connected" ? theme.success : theme.error,
            attributes: TextAttributes.BOLD,
          }}
        >
          {serverStatus() === "connected" ? "●" : "○"}
        </span>{" "}
        Port {port}
      </text>
      <text
        fg={theme.accent}
        onMouseUp={() => {
          if (renderer.getSelection()?.getSelectedText()) return
          showServerDialog()
        }}
      >
        [Manage]
      </text>
    </box>
  )
}
