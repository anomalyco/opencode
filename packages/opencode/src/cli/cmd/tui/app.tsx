import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import { Switch, Match, createEffect, untrack } from "solid-js"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel } from "@tui/component/dialog-model"
import { DialogStatus } from "@tui/component/dialog-status"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogAgent } from "@tui/component/dialog-agent"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { Theme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { DialogAlert } from "./ui/dialog-alert"
import { ExitProvider } from "./context/exit"

export async function tui(input: { url: string; onExit?: () => Promise<void> }) {
  await render(
    () => {
      return (
        <ExitProvider onExit={input.onExit}>
          <RouteProvider>
            <SDKProvider url={input.url}>
              <SyncProvider>
                <LocalProvider>
                  <KeybindProvider>
                    <DialogProvider>
                      <CommandProvider>
                        <PromptHistoryProvider>
                          <App />
                        </PromptHistoryProvider>
                      </CommandProvider>
                    </DialogProvider>
                  </KeybindProvider>
                </LocalProvider>
              </SyncProvider>
            </SDKProvider>
          </RouteProvider>
        </ExitProvider>
      )
    },
    {
      targetFps: 60,
      gatherStats: false,
      exitOnCtrlC: false,
      useKittyKeyboard: true,
    },
  )
}

function App() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  renderer.disableStdoutInterception()
  const dialog = useDialog()
  const local = useLocal()
  const command = useCommandDialog()
  const { event } = useSDK()

  useKeyboard(async (evt) => {
    if (evt.meta && evt.name === "t") {
      renderer.toggleDebugOverlay()
      return
    }

    if (evt.meta && evt.name === "d") {
      renderer.console.toggle()
      return
    }
  })

  createEffect(() => {
    console.log(JSON.stringify(route.data))
  })

  command.register(() => [
    {
      title: "Switch session",
      value: "session.list",
      keybind: "session_list",
      category: "Session",
      onSelect: () => {
        dialog.replace(() => <DialogSessionList />)
      },
    },
    {
      title: "New session",
      value: "session.new",
      keybind: "session_new",
      category: "Session",
      onSelect: () => {
        route.navigate({
          type: "home",
        })
        dialog.clear()
      },
    },
    {
      title: "Switch model",
      value: "model.list",
      keybind: "model_list",
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogModel />)
      },
    },
    {
      title: "Switch agent",
      value: "agent.list",
      keybind: "agent_list",
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogAgent />)
      },
    },
    {
      title: "Agent cycle",
      value: "agent.cycle",
      keybind: "agent_cycle",
      category: "Agent",
      disabled: true,
      onSelect: () => {
        local.agent.move(1)
      },
    },
    {
      title: "Agent cycle reverse",
      value: "agent.cycle.reverse",
      keybind: "agent_cycle_reverse",
      category: "Agent",
      disabled: true,
      onSelect: () => {
        local.agent.move(-1)
      },
    },
    {
      title: "View status",
      keybind: "status_view",
      value: "opencode.status",
      onSelect: () => {
        dialog.replace(() => <DialogStatus />)
      },
      category: "System",
    },
  ])

  createEffect(() => {
    const providerID = local.model.current().providerID
    if (providerID === "openrouter" && !local.kv.data.openrouter_warning) {
      untrack(() => {
        DialogAlert.show(
          dialog,
          "Warning",
          "While openrouter is a convenient way to access LLMs your request will often be routed to subpar providers that do not work well in our testing.\n\nFor reliable access to models check out OpenCode Zen\nhttps://opencode.ai/zen",
        ).then(() => local.kv.set("openrouter_warning", true))
      })
    }
  })

  event.on("tui.command.execute", (evt) => {
    command.trigger(evt.properties.command)
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={Theme.background}
      onMouseUp={async () => {
        const text = renderer.getSelection()?.getSelectedText()
        if (text && text.length > 0) {
          const base64 = Buffer.from(text).toString("base64")
          const osc52 = `\x1b]52;c;${base64}\x07`
          const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
          /* @ts-expect-error */
          renderer.writeOut(finalOsc52)
          await Clipboard.copy(text)
          renderer.clearSelection()
        }
      }}
    >
      <box flexDirection="column" flexGrow={1}>
        <Switch>
          <Match when={route.data.type === "home"}>
            <Home />
          </Match>
          <Match when={route.data.type === "session"}>
            <Session />
          </Match>
        </Switch>
      </box>
      <box
        height={1}
        backgroundColor={Theme.backgroundPanel}
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
      >
        <box flexDirection="row">
          <box flexDirection="row" backgroundColor={Theme.backgroundElement} paddingLeft={1} paddingRight={1}>
            <text fg={Theme.textMuted}>open</text>
            <text attributes={TextAttributes.BOLD}>code </text>
            <text fg={Theme.textMuted}>v{Installation.VERSION}</text>
          </box>
          <box paddingLeft={1} paddingRight={1}>
            <text fg={Theme.textMuted}>{process.cwd().replace(Global.Path.home, "~")}</text>
          </box>
        </box>
        <box flexDirection="row" flexShrink={0}>
          <text fg={Theme.textMuted} paddingRight={1}>
            tab
          </text>
          <text fg={local.agent.color(local.agent.current().name)}>{""}</text>
          <text bg={local.agent.color(local.agent.current().name)} fg={Theme.background} wrap={false}>
            <span style={{ bold: true }}> {local.agent.current().name.toUpperCase()}</span>
            <span> AGENT </span>
          </text>
        </box>
      </box>
    </box>
  )
}
