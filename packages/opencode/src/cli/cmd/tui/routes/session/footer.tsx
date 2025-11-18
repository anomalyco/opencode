import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useRenderer } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useServerStatus } from "../../context/server-status"
import { useLocal } from "../../context/local"
import { createSignal, createEffect, onCleanup } from "solid-js"
import { BackgroundWorkers } from "@/worker/background-workers"
import { Bus } from "@/bus"
import z from "zod"

export function Footer() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const renderer = useRenderer()
  const serverStatus = useServerStatus()
  const local = useLocal()
  const [validationStatus, setValidationStatus] = createSignal("idle")
  const [prefetchStatus, setPrefetchStatus] = createSignal("idle")

  // Subscribe to worker state updates
  const validationUnsub = Bus.subscribe(Bus.event("validation.state.updated", z.any()), (event) => {
    const state = event.properties
    if (state.running) setValidationStatus("running")
    else if (state.queue?.length > 0) setValidationStatus("queued")
    else setValidationStatus("idle")
  })

  const prefetchUnsub = Bus.subscribe(Bus.event("prefetch.state.updated", z.any()), (event) => {
    const state = event.properties
    if (state.running) setPrefetchStatus("loading")
    else if (state.queue?.length > 0) setPrefetchStatus("queued")
    else setPrefetchStatus("idle")
  })

  onCleanup(() => {
    validationUnsub()
    prefetchUnsub()
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
      <box flexDirection="row" gap={2} alignItems="center">
        <text
          fg={theme.accent}
          onMouseUp={() => {
            if (renderer.getSelection()?.getSelectedText()) return
            showServerDialog()
          }}
        >
          [Manage]
        </text>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted}>Val:</text>
          <text
            fg={
              validationStatus() === "running"
                ? theme.success
                : validationStatus() === "queued"
                  ? theme.accent
                  : theme.textMuted
            }
          >
            {validationStatus() === "running" ? "●" : validationStatus() === "queued" ? "○" : "·"}
          </text>
          <text fg={theme.textMuted}>Pre:</text>
          <text
            fg={
              prefetchStatus() === "loading"
                ? theme.accent
                : prefetchStatus() === "queued"
                  ? theme.warning
                  : theme.textMuted
            }
          >
            {prefetchStatus() === "loading" ? "●" : prefetchStatus() === "queued" ? "○" : "·"}
          </text>
          <text fg={theme.textMuted} marginLeft={2}>
            tab
          </text>
          <text fg={theme.accent} attributes={TextAttributes.BOLD} marginLeft={1}>
            BUILD {local.agent.current()?.name?.toUpperCase() ?? "AGENT"} ◀
          </text>
        </box>
      </box>
    </box>
  )
}
