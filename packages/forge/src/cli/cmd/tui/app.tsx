import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import { Switch, Match, createEffect, ErrorBoundary, createSignal, onMount, batch, Show } from "solid-js"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogAgents } from "@tui/component/dialog-agents"
import { DialogModels } from "@tui/component/dialog-models"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { KeybindProvider } from "@tui/context/keybind"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { DialogAgentInstall } from "@tui/component/dialog-agent-install"
import { PromptHistoryProvider } from "./component/prompt/history"
import { DialogAlert } from "./ui/dialog-alert"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { Session as SessionApi } from "@/session"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import { matchAgent, getAllAgents } from "@/acp/agents"
import { matchModel } from "@/acp/util"
import { findModeId, type AgentFlag } from "../session-init"
import open from "open"

async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
  // can't set raw mode if not a TTY
  if (!process.stdin.isTTY) return "dark"

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    const handler = (data: Buffer) => {
      const str = data.toString()
      const match = str.match(/\x1b]11;([^\x07\x1b]+)/)
      if (match) {
        cleanup()
        const color = match[1]
        // Parse RGB values from color string
        // Formats: rgb:RR/GG/BB or #RRGGBB or rgb(R,G,B)
        let r = 0,
          g = 0,
          b = 0

        if (color.startsWith("rgb:")) {
          const parts = color.substring(4).split("/")
          r = parseInt(parts[0], 16) >> 8 // Convert 16-bit to 8-bit
          g = parseInt(parts[1], 16) >> 8 // Convert 16-bit to 8-bit
          b = parseInt(parts[2], 16) >> 8 // Convert 16-bit to 8-bit
        } else if (color.startsWith("#")) {
          r = parseInt(color.substring(1, 3), 16)
          g = parseInt(color.substring(3, 5), 16)
          b = parseInt(color.substring(5, 7), 16)
        } else if (color.startsWith("rgb(")) {
          const parts = color.substring(4, color.length - 1).split(",")
          r = parseInt(parts[0])
          g = parseInt(parts[1])
          b = parseInt(parts[2])
        }

        // Calculate luminance using relative luminance formula
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

        // Determine if dark or light based on luminance threshold
        resolve(luminance > 0.5 ? "light" : "dark")
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.on("data", handler)
    process.stdout.write("\x1b]11;?\x07")

    timeout = setTimeout(() => {
      cleanup()
      resolve("dark")
    }, 1000)
  })
}

export function tui(input: { url: string; args: Args; onExit?: () => Promise<void> }) {
  // promise to prevent immediate exit
  return new Promise<void>(async (resolve) => {
    const mode = await getTerminalBackgroundColor()
    const onExit = async () => {
      await input.onExit?.()
      resolve()
    }

    render(
      () => {
        return (
          <ErrorBoundary fallback={(error, reset) => <ErrorComponent error={error} reset={reset} onExit={onExit} />}>
            <ArgsProvider {...input.args}>
              <ExitProvider onExit={onExit}>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider>
                      <SDKProvider url={input.url}>
                        <SyncProvider>
                          <ThemeProvider mode={mode}>
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
                          </ThemeProvider>
                        </SyncProvider>
                      </SDKProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ExitProvider>
            </ArgsProvider>
          </ErrorBoundary>
        )
      },
      {
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: true,
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
  const toast = useToast()
  const { theme, mode, setMode } = useTheme()
  const sync = useSync()
  const exit = useExit()

  createEffect(() => {
    console.log(JSON.stringify(route.data))
  })

  const args = useArgs()
  const initialAgent = () => (args.agents && args.agents.length > 0 ? (args.agents[0] as AgentFlag) : undefined)
  onMount(async () => {
    // Handle agent selection - only set if explicitly provided via args or already stored
    const targetAgent = initialAgent()?.name
    const targetModel = initialAgent()?.model
    const targetMode = initialAgent()?.mode

    let agentToUse: string | null = null

    if (targetAgent) {
      const agentResult = matchAgent(targetAgent)
      if (!agentResult.success) {
        if (agentResult.error === "ambiguous") {
          const matchNames = agentResult.matches.map((a) => a.name).join(", ")
          toast.show({
            variant: "warning",
            message: `Ambiguous agent '${targetAgent}'. Matches: ${matchNames}. Please select manually.`,
            duration: 5000,
          })
        } else {
          const available = getAllAgents()
            .map((a) => a.name)
            .join(", ")
          toast.show({
            variant: "warning",
            message: `Agent '${targetAgent}' not found. Available: ${available}. Please select manually.`,
            duration: 5000,
          })
        }
      } else {
        agentToUse = agentResult.match.name
      }
    } else {
      // Use stored agent from KV if it exists
      const storedAgent = local.agent.current()
      if (storedAgent) {
        agentToUse = storedAgent.name
      }
    }

    // Only set agent if we have one to set
    if (agentToUse) {
      await local.agent.set(agentToUse)
    }

    // Handle model selection with matching and fallback (only if agent is connected)
    if (targetModel) {
      const availableModels = local.model.list()
      if (availableModels.length === 0) {
        toast.show({
          variant: "warning",
          message: `Agent does not support model selection. Using agent default.`,
          duration: 4000,
        })
      } else {
        const modelResult = matchModel(targetModel, availableModels)
        if (!modelResult.success) {
          if (modelResult.error === "ambiguous") {
            const matchNames = modelResult.matches.map((m) => m.modelId).join(", ")
            toast.show({
              variant: "warning",
              message: `Ambiguous model '${targetModel}'. Matches: ${matchNames}. Using agent default.`,
              duration: 5000,
            })
          } else {
            const available = modelResult.available.map((m) => m.modelId).join(", ")
            toast.show({
              variant: "warning",
              message: `Model '${targetModel}' not available. Available: ${available}. Using agent default.`,
              duration: 6000,
            })
          }
        } else {
          // keep the loading shimmer while we sync the model to avoid auto-submit racing
          local.session.setSwitching(true, agentToUse)
          await local.model
            .set(modelResult.match.modelId)
            .catch((error) => {
              // surface toast already handled in model.set; just log
              console.error(error)
            })
            .finally(() => {
              local.session.setSwitching(false, null)
            })
        }
      }
    }

    if (targetMode) {
      const availableModes = local.mode.list()
      const resolvedMode = findModeId(
        targetMode,
        availableModes.length ? ({ availableModes, currentModeId: local.mode.current() ?? undefined } as any) : null,
      )
      if (!resolvedMode) {
        const available = availableModes.map((m) => m.id).join(", ")
        toast.show({
          variant: "warning",
          message: `Mode '${targetMode}' not available. Available: ${available || "none"}. Using agent default.`,
          duration: 5000,
        })
      } else if (local.mode.current() !== resolvedMode) {
        local.session.setSwitching(true, agentToUse)
        await local.mode
          .set(resolvedMode)
          .catch((error) => console.error(error))
          .finally(() => local.session.setSwitching(false, null))
      }
    }

    if (args.sessionID) {
      route.navigate({
        type: "session",
        sessionID: args.sessionID,
      })
    }

    if (args.installAgent) {
      const agentResult = matchAgent(args.installAgent)
      if (!agentResult.success) {
        const available = getAllAgents()
          .map((a) => a.name)
          .join(", ")
        toast.show({
          variant: "warning",
          message: `Agent '${args.installAgent}' not found. Available: ${available}.`,
          duration: 6000,
        })
        dialog.replace(() => <DialogAgents />)
        return
      }

      dialog.replace(() => <DialogAgentInstall agentName={agentResult.match.name} />)
    }
  })

  createEffect(() => {
    if (sync.status !== "complete") return
    if (args.continue) {
      const match = sync.data.session.at(0)?.id
      if (match) {
        route.navigate({
          type: "session",
          sessionID: match,
        })
      }
    }
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
      title: "Select agent",
      value: "agent.list",
      keybind: "agent_list",
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogAgents />)
      },
    },
    {
      title: "Select model",
      value: "model.list",
      keybind: "model_list",
      category: "Model",
      onSelect: () => {
        dialog.replace(() => <DialogModels />)
      },
    },
    {
      title: "Model cycle",
      value: "model.cycle_recent",
      keybind: "model_cycle_recent",
      category: "Model",
      onSelect: () => {
        local.model.cycle(1)
      },
    },
    {
      title: "Model cycle reverse",
      value: "model.cycle_recent_reverse",
      keybind: "model_cycle_recent_reverse",
      category: "Model",
      onSelect: () => {
        local.model.cycle(-1)
      },
    },
    {
      title: "Agent cycle",
      value: "agent.cycle",
      // TODO: Add agent_cycle keybind to KeybindsConfig
      // keybind: "agent_cycle",
      category: "Agent",
      disabled: true,
      onSelect: () => {
        local.agent.move(1)
      },
    },
    {
      title: "Agent cycle reverse",
      value: "agent.cycle.reverse",
      // TODO: Add agent_cycle_reverse keybind to KeybindsConfig
      // keybind: "agent_cycle_reverse",
      category: "Agent",
      disabled: true,
      onSelect: () => {
        local.agent.move(-1)
      },
    },
    {
      title: "Cycle mode",
      value: "mode.cycle",
      keybind: "mode_cycle",
      category: "Session",
      onSelect: () => {
        local.mode.cycle()
        dialog.clear()
      },
    },
    {
      title: "Cycle mode reverse",
      value: "mode.cycle_reverse",
      keybind: "mode_cycle_reverse",
      category: "Session",
      onSelect: () => {
        local.mode.cycle(-1)
        dialog.clear()
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
      title: `Switch to ${mode() === "dark" ? "light" : "dark"} mode`,
      value: "theme.switch_mode",
      onSelect: () => {
        setMode(mode() === "dark" ? "light" : "dark")
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
      title: "Share feedback",
      value: "feedback.github",
      onSelect: async () => {
        const issueUrl = "https://github.com/forge-agents/forge/issues/new"
        await open(issueUrl).catch((error) => {
          toast.show({
            variant: "error",
            message: `Failed to open browser: ${error.message}`,
            duration: 3000,
          })
        })
        toast.show({
          variant: "info",
          message: "Opening GitHub to create an issue...",
          duration: 2000,
        })
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Exit the app",
      value: "app.exit",
      onSelect: () => exit(),
      category: "System",
    },
    {
      title: "Toggle debug panel",
      category: "System",
      value: "app.debug",
      onSelect: (dialog) => {
        renderer.toggleDebugOverlay()
        dialog.clear()
      },
    },
    {
      title: "Toggle console",
      category: "System",
      value: "app.fps",
      onSelect: (dialog) => {
        renderer.console.toggle()
        dialog.clear()
      },
    },
  ])

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
      dialog.clear()
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  event.on(SessionApi.Event.Error.type, (evt) => {
    const error = evt.properties.error
    const message = (() => {
      if (!error) return "An error occured"

      if (typeof error === "object") {
        const data = error.data
        if ("message" in data && typeof data.message === "string") {
          return data.message
        }
      }
      return String(error)
    })()

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  event.on(Installation.Event.Updated.type, (evt) => {
    toast.show({
      variant: "success",
      title: "Update Complete",
      message: `OpenCode updated to v${evt.properties.version}`,
      duration: 5000,
    })
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
          <Match when={route.data.type === "session"}>
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
          <box flexDirection="row" backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              forge{" "}
            </text>
            <text fg={theme.textMuted}>v{Installation.VERSION}</text>
          </box>
          <box paddingLeft={1} paddingRight={1}>
            <text fg={theme.textMuted}>{process.cwd().replace(Global.Path.home, "~")}</text>
          </box>
        </box>
        <Show when={false}>
          <box flexDirection="row" flexShrink={0}>
            <text fg={theme.textMuted} paddingRight={1}>
              tab
            </text>
            <text fg={local.agent.color(local.agent.current()!.name)}>{""}</text>
            <text bg={local.agent.color(local.agent.current()!.name)} fg={theme.background} wrapMode={undefined}>
              <span style={{ bold: true }}> {local.agent.current()!.name.toUpperCase()}</span>
              <span> AGENT </span>
            </text>
          </box>
        </Show>
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

  issueURL.searchParams.set("opencode-version", Installation.VERSION)

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
