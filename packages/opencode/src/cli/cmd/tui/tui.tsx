import { cmd } from "../cmd"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute } from "./context/route"
import { Home } from "./home"
import { Switch, Match, createEffect } from "solid-js"
import { ThemeProvider, useTheme } from "./context/theme"
import { Installation } from "../../../installation"
import { Global } from "../../../global"
import { DialogProvider, useDialog } from "./ui/dialog"
import { SDKProvider } from "./context/sdk"
import { SyncProvider } from "./context/sync"
import { LocalProvider, useLocal } from "./context/local"
import { DialogModel } from "./component/dialog-model"
import { Session } from "./session"
import { CommandProvider, useCommandDialog } from "./component/dialog-command"
import { DialogAgent } from "./component/dialog-agent"
import { DialogSessionList } from "./component/dialog-session-list"
import { KeybindProvider, useKeybind } from "./context/keybind"

export const TuiCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    yargs
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("prompt", {
        alias: ["p"],
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("port", {
        type: "number",
        describe: "port to listen on",
        default: 0,
      })
      .option("hostname", {
        alias: ["h"],
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  handler: async () => {
    await render(
      () => {
        return (
          <RouteProvider>
            <ThemeProvider>
              <SDKProvider>
                <SyncProvider>
                  <LocalProvider>
                    <KeybindProvider>
                      <DialogProvider>
                        <CommandProvider>
                          <App />
                        </CommandProvider>
                      </DialogProvider>
                    </KeybindProvider>
                  </LocalProvider>
                </SyncProvider>
              </SDKProvider>
            </ThemeProvider>
          </RouteProvider>
        )
      },
      {
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: true,
      },
    )
  },
})

function App() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const command = useCommandDialog()
  const keybind = useKeybind()

  useKeyboard(async (evt) => {
    if (keybind.match("agent_cycle", evt)) {
      local.agent.move(1)
      return
    }
    if (keybind.match("agent_cycle_reverse", evt)) {
      local.agent.move(-1)
    }

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
  ])

  const { currentTheme } = useTheme()

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={currentTheme().background}>
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
        backgroundColor={currentTheme().backgroundPanel}
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
      >
        <box flexDirection="row">
          <box flexDirection="row" backgroundColor={currentTheme().backgroundElement} paddingLeft={1} paddingRight={1}>
            <text fg={currentTheme().textMuted}>open</text>
            <text attributes={TextAttributes.BOLD}>code </text>
            <text fg={currentTheme().textMuted}>v{Installation.VERSION}</text>
          </box>
          <box paddingLeft={1} paddingRight={1}>
            <text fg={currentTheme().textMuted}>{process.cwd().replace(Global.Path.home, "~")}</text>
          </box>
        </box>
        <box flexDirection="row" flexShrink={0}>
          <text fg={currentTheme().textMuted} paddingRight={1}>
            tab
          </text>
          <text fg={local.agent.color(local.agent.current().name)}>┃</text>
          <text bg={local.agent.color(local.agent.current().name)} fg={currentTheme().background} wrap={false}>
            {" "}
            <span style={{ bold: true }}>{local.agent.current().name.toUpperCase()}</span>
            <span> AGENT </span>
          </text>
        </box>
      </box>
    </box>
  )
}
