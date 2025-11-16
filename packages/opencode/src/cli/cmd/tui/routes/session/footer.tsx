import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useRenderer } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useServerStatus } from "../../context/server-status"

export function Footer() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const renderer = useRenderer()
  const serverStatus = useServerStatus()

  const showServerDialog = () => {
    const options: DialogSelectOption<string>[] = [
      {
        title: "Restart Server",
        value: "restart",
        description: "Restart the OpenCode server",
        onSelect: async (ctx) => {
          ctx.clear()
          try {
            await fetch(`${serverStatus.url()}/server/restart`, { method: "POST" })
          } catch (error) {
            console.error("Failed to restart server:", error)
          }
        },
      },
      {
        title: "Copy Server URL",
        value: "copy",
        description: `Copy ${serverStatus.url()} to clipboard`,
        onSelect: (ctx) => {
          Promise.resolve(serverStatus.copyUrl()).finally(() => ctx.clear())
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
            fg: serverStatus.status() === "connected" ? theme.success : theme.error,
            attributes: TextAttributes.BOLD,
          }}
        >
          {serverStatus.status() === "connected" ? "●" : "○"}
        </span>{" "}
        Port {serverStatus.port()}
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
