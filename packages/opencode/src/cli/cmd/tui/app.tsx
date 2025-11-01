import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute, type Route } from "@tui/context/route"
import { Switch, Match, createEffect, untrack, ErrorBoundary, createSignal } from "solid-js"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel } from "@tui/component/dialog-model"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogAgent } from "@tui/component/dialog-agent"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { KeybindProvider } from "@tui/context/keybind"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { DialogAlert } from "./ui/dialog-alert"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import type { SessionRoute } from "./context/route"
import { Session as SessionApi } from "@/session"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"

export function tui(input: {
  url: string
  sessionID?: string
  model?: string
  agent?: string
  prompt?: string
  onExit?: () => Promise<void>
}) {
  // promise to prevent immediate exit
  return new Promise<void>((resolve) => {
    const routeData: Route | undefined = input.sessionID
      ? {
          type: "session",
          sessionID: input.sessionID,
        }
      : undefined

    const onExit = async () => {
      await input.onExit?.()
      resolve()
    }

    render(
      () => {
        return (
          <ErrorBoundary
            fallback={(error, reset) => (
              <ErrorComponent error={error} reset={reset} onExit={onExit} />
            )}
          >
            <ExitProvider onExit={onExit}>
              <KVProvider>
                <ToastProvider>
                  <RouteProvider data={routeData}>
                    <SDKProvider url={input.url}>
                      <SyncProvider>
                        <ThemeProvider>
                          <LocalProvider initialModel={input.model} initialAgent={input.agent} initialPrompt={input.prompt}>
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
                        </ThemeProvider>
                      </SyncProvider>
                    </SDKProvider>
                  </RouteProvider>
                </ToastProvider>
              </KVProvider>
            </ExitProvider>
          </ErrorBoundary>
        )
      },
      {
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
      },
    )
  })
}

function App() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  renderer.disableStdoutInterception()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const command = useCommandDialog()
  const { event } = useSDK()
  const sync = useSync()
  const toast = useToast()
  const [sessionExists, setSessionExists] = createSignal(false)
  const { theme } = useTheme()
  const exit = useExit()

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

  // Make sure session is valid, otherwise redirect to home
  createEffect(async () => {
    if (route.data.type === "session") {
      const data = route.data as SessionRoute
      await sync.session.sync(data.sessionID).catch(() => {
        toast.show({
          message: `Session not found: ${data.sessionID}`,
          variant: "error",
        })
        return route.navigate({ type: "home" })
      })
      setSessionExists(true)
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
      title: "Model cycle",
      value: "model.cycle_recent",
      keybind: "model_cycle_recent",
      category: "Agent",
      onSelect: () => {
        local.model.cycle(1)
      },
    },
    {
      title: "Model cycle reverse",
      value: "model.cycle_recent_reverse",
      keybind: "model_cycle_recent_reverse",
      category: "Agent",
      onSelect: () => {
        local.model.cycle(-1)
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
    {
      title: "Switch theme",
      value: "theme.switch",
      onSelect: () => {
        dialog.replace(() => <DialogThemeList />)
      },
      category: "System",
    },
    {
      title: "Help",
      value: "help.show",
      onSelect: () => {
        dialog.replace(() => <DialogHelp />)
      },
      category: "System",
    },
    {
      title: "Exit the app",
      value: "app.exit",
      onSelect: exit,
      category: "System",
    }
  ])

  createEffect(() => {
    const providerID = local.model.current().providerID
    if (providerID === "openrouter" && !kv.get("openrouter_warning", false)) {
      untrack(() => {
        DialogAlert.show(
          dialog,
          "Warning",
          "While openrouter is a convenient way to access LLMs your request will often be routed to subpar providers that do not work well in our testing.\n\nFor reliable access to models check out OpenCode Zen\nhttps://opencode.ai/zen",
        ).then(() => kv.set("openrouter_warning", true))
      })
    }
  })

  event.on(TuiEvent.CommandExecute.type, (evt) => {
    command.trigger(evt.properties.command)
  })

  event.on(TuiEvent.ToastShow.type, (evt) => {
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  event.on(SessionApi.Event.Deleted.type, (evt) => {
    if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      onMouseUp={async () => {
        const text = renderer.getSelection()?.getSelectedText()
        if (text && text.length > 0) {
          const base64 = Buffer.from(text).toString("base64")
          const osc52 = `\x1b]52;c;${base64}\x07`
          const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
          /* @ts-expect-error */
          renderer.writeOut(finalOsc52)
          await Clipboard.copy(text)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
          renderer.clearSelection()
        }
      }}
    >
      <box flexDirection="column" flexGrow={1}>
        <Switch>
          <Match when={route.data.type === "home"}>
            <Home />
          </Match>
          <Match when={route.data.type === "session" && sessionExists()}>
            <Session />
          </Match>
        </Switch>
      </box>
      <box
        height={1}
        backgroundColor={theme.backgroundPanel}
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
      >
        <box flexDirection="row">
          <box
            flexDirection="row"
            backgroundColor={theme.backgroundElement}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.textMuted}>open</text>
            <text attributes={TextAttributes.BOLD}>code </text>
            <text fg={theme.textMuted}>v{Installation.VERSION}</text>
          </box>
          <box paddingLeft={1} paddingRight={1}>
            <text fg={theme.textMuted}>{process.cwd().replace(Global.Path.home, "~")}</text>
          </box>
        </box>
        <box flexDirection="row" flexShrink={0}>
          <text fg={theme.textMuted} paddingRight={1}>
            tab
          </text>
          <text fg={local.agent.color(local.agent.current().name)}>{""}</text>
          <text
            bg={local.agent.color(local.agent.current().name)}
            fg={theme.background}
            wrapMode={undefined}
          >
            <span style={{ bold: true }}> {local.agent.current().name.toUpperCase()}</span>
            <span> AGENT </span>
          </text>
        </box>
      </box>
    </box>
  )
}

function ErrorComponent(props: { error: Error; reset: () => void; onExit: () => Promise<void> }) {
  const term = useTerminalDimensions()
  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      props.onExit()
    }
  })
  const [copied, setCopied] = createSignal(false)

  const issueURL = new URL("https://github.com/sst/opencode/issues/new?template=bug-report.yml")

  if (props.error.message) {
    issueURL.searchParams.set("title", `opentui: fatal: ${props.error.message}`)
  }

  if (props.error.stack) {
    issueURL.searchParams.set(
      "description",
      "```\n" + props.error.stack.substring(0, 6000 - issueURL.toString().length) + "...\n```",
    )
  }

  const copyIssueURL = () => {
    Clipboard.copy(issueURL.toString()).then(() => {
      setCopied(true)
    })
  }

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text attributes={TextAttributes.BOLD}>Please report an issue.</text>
        <box onMouseUp={copyIssueURL} backgroundColor="#565f89" padding={1}>
          <text attributes={TextAttributes.BOLD}>Copy issue URL (exception info pre-filled)</text>
        </box>
        {copied() && <text>Successfully copied</text>}
      </box>
      <box flexDirection="row" gap={2} alignItems="center">
        <text>A fatal error occurred!</text>
        <box onMouseUp={props.reset} backgroundColor="#565f89" padding={1}>
          <text>Reset TUI</text>
        </box>
        <box onMouseUp={props.onExit} backgroundColor="#565f89" padding={1}>
          <text>Exit</text>
        </box>
      </box>
      <scrollbox height={Math.floor(term().height * 0.7)}>
        <text>{props.error.stack}</text>
      </scrollbox>
      <text>{props.error.message}</text>
    </box>
  )
}
