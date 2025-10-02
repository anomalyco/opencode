import { cmd } from "@/cli/cmd/cmd"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import { Switch, Match, createEffect, untrack } from "solid-js"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { SDKProvider } from "@tui/context/sdk"
import { SyncProvider } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel } from "@tui/component/dialog-model"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogAgent } from "@tui/component/dialog-agent"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Theme } from "@tui/context/theme"

import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { DialogAlert } from "./ui/dialog-alert"

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
    await Instance.provide({
      directory: process.cwd(),
      fn: () => Config.get(),
    })

    const worker = new Worker("./src/cli/cmd/tui/worker.ts")
    worker.onerror = console.log
    worker.onmessageerror = console.log
    const url = await new Promise<string>((resolve) => {
      worker.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.type === "ready") {
          resolve(data.url)
        }
      }
    })
    await render(
      () => {
        return (
          <RouteProvider>
            <SDKProvider url={url}>
              <SyncProvider>
                <LocalProvider>
                  <KeybindProvider>
                    <DialogProvider>
                      <CommandProvider>
                        <PromptHistoryProvider>
                          <App
                            onExit={() => {
                              worker.terminate()
                            }}
                          />
                        </PromptHistoryProvider>
                      </CommandProvider>
                    </DialogProvider>
                  </KeybindProvider>
                </LocalProvider>
              </SyncProvider>
            </SDKProvider>
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

function App(props: { onExit: () => void }) {
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
    if (keybind.match("app_exit", evt)) {
      await Instance.disposeAll()
      renderer.destroy()
      props.onExit()
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

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={Theme.background}>
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
          <text fg={local.agent.color(local.agent.current().name)}>┃</text>
          <text bg={local.agent.color(local.agent.current().name)} fg={Theme.background} wrap={false}>
            {" "}
            <span style={{ bold: true }}>{local.agent.current().name.toUpperCase()}</span>
            <span> AGENT </span>
          </text>
        </box>
      </box>
    </box>
  )
}
