import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useRenderer } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useLocal } from "../../context/local"
import { Show, For, createSignal, onCleanup } from "solid-js"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { DialogAgent } from "@tui/component/dialog-agent"
import { useRoute, type SessionRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useUIExtensions } from "../../context/ui-extensions"
import { PluginComponent } from "../../component/plugin-component"
import { useServerStatus } from "../../context/server-status"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Bus } from "@/bus"
import z from "zod"
import { BackgroundWorkers } from "@/worker/background-workers"

export function Footer() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const renderer = useRenderer()
  const local = useLocal()
  const route = useRoute()
  const sync = useSync()
  const uiExtensions = useUIExtensions()
  const serverStatus = useServerStatus()
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

  const showWorkerDialog = () => {
    const workerConfig = BackgroundWorkers.getConfig()
    const options: DialogSelectOption<string>[] = [
      {
        title: workerConfig?.validation.enabled ? "Disable Validation" : "Enable Validation",
        value: "toggle-validation",
        description: "Toggle background lint/typecheck/codereview",
        onSelect: (ctx) => {
          BackgroundWorkers.updateConfig({
            validation: { enabled: !(workerConfig?.validation.enabled ?? false) },
          })
          ctx.clear()
        },
      },
      {
        title: workerConfig?.prefetch.enabled ? "Disable Prefetch" : "Enable Prefetch",
        value: "toggle-prefetch",
        description: "Toggle file prefetch caching",
        onSelect: (ctx) => {
          BackgroundWorkers.updateConfig({
            prefetch: { enabled: !(workerConfig?.prefetch.enabled ?? false) },
          })
          ctx.clear()
        },
      },
    ]

    dialog.replace(() => <DialogSelect title="Worker Services" options={options} />)
  }

  return (
    <box
      height={1}
      backgroundColor={theme.backgroundPanel}
      flexDirection="row"
      justifyContent="space-between"
      flexShrink={0}
    >
      <box flexDirection="row">
        <box flexDirection="row" backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>code</text>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            surf{" "}
          </text>
          <text fg={theme.textMuted}>v{Installation.VERSION}</text>
        </box>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>{process.cwd().replace(Global.Path.home, "~")}</text>
        </box>
        <Show when={uiExtensions.extensions()?.statusItems}>
          <For each={uiExtensions.extensions()?.statusItems ?? []}>
            {(statusItem) => (
              <box paddingLeft={1} paddingRight={1}>
                <PluginComponent componentId={statusItem.id} context={{}} />
              </box>
            )}
          </For>
        </Show>
      </box>
      <box flexDirection="row" flexShrink={0} gap={2} alignItems="center">
        {/* <text fg={theme.textMuted}>
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
        </text> */}
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
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              showWorkerDialog()
            }}
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
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              showWorkerDialog()
            }}
          >
            {prefetchStatus() === "loading" ? "●" : prefetchStatus() === "queued" ? "○" : "·"}
          </text>
        </box>
        <text fg={theme.textMuted} paddingRight={1}>
          tab
        </text>
        {(() => {
          const currentRoute = route.data
          const session =
            currentRoute?.type === "session"
              ? sync.data.session.find((s: any) => s.id === (currentRoute as SessionRoute).sessionID)
              : undefined
          const rootAgent = (session as any)?.orchestration?.rootAgent
          const currentAgent = (session as any)?.orchestration?.currentAgent

          // Determine which agent to use for color
          const agentForColor =
            currentAgent && rootAgent && currentAgent !== rootAgent ? currentAgent : (local.agent.current()?.name ?? "")

          return (
            <>
              <text bg={local.agent.color(agentForColor)}> </text>
              <text
                bg={local.agent.color(agentForColor)}
                fg={theme.text}
                wrapMode={undefined}
                attributes={TextAttributes.BOLD | TextAttributes.UNDERLINE}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  dialog.replace(() => <DialogAgent />)
                }}
              >
                {(() => {
                  // If switched (currentAgent differs from rootAgent), show hierarchy
                  if (currentAgent && rootAgent && currentAgent !== rootAgent) {
                    return `${rootAgent.toUpperCase()} > ${currentAgent.toUpperCase()} `
                  }

                  // Otherwise show current agent from local state
                  const agent = local.agent.current()
                  return (agent?.name.toUpperCase() ?? "LOADING") + " "
                })()}
              </text>
            </>
          )
        })()}
      </box>
    </box>
  )
}
