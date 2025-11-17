import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute, type Route, type SessionRoute } from "@tui/context/route"
import { Switch, Match, createEffect, untrack, ErrorBoundary, createSignal, For, Show, on } from "solid-js"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel } from "@tui/component/dialog-model"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { ServerStatusProvider } from "./context/server-status"
import { DialogHelp } from "./ui/dialog-help"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogKanban } from "./component/dialog-kanban"
import { DialogAgent } from "@tui/component/dialog-agent"

import { DialogAgentManager } from "@tui/component/dialog-agent-manager"
import { DialogSessionList } from "@tui/component/dialog-session-list"
// import { DialogSkillManager } from "@tui/component/dialog-skill-manager" // DISABLED: migrated to plugin
// import { DialogKbManager } from "@tui/component/dialog-kb-manager" // DISABLED: raid module removed
import { KeybindProvider } from "@tui/context/keybind"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { DialogAlert } from "./ui/dialog-alert"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { Session as SessionApi } from "@/session"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"
import { UIExtensionsProvider, useUIExtensions } from "./context/ui-extensions"
import { PluginComponent } from "./component/plugin-component"
import { ArgsProvider } from "./context/args"
import { TransitionAnimation } from "./component/transition-animation"
import { ContextProvider } from "./context/context"

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

export function tui(input: {
  url: string
  sessionID?: string
  model?: string
  agent?: string
  prompt?: string
  onExit?: () => Promise<void>
}) {
  // promise to prevent immediate exit
  return new Promise<void>(async (resolve) => {
    const mode = await getTerminalBackgroundColor()

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
          <ErrorBoundary fallback={(error, reset) => <ErrorComponent error={error} reset={reset} onExit={onExit} />}>
            <ExitProvider onExit={onExit}>
              <KVProvider>
                <ToastProvider>
                  <RouteProvider data={routeData}>
                    <SDKProvider url={input.url}>
                      <ArgsProvider
                        model={input.model}
                        agent={input.agent}
                        prompt={input.prompt}
                        sessionID={input.sessionID}
                      >
                        <SyncProvider>
                          <UIExtensionsProvider>
                            <ServerStatusProvider>
                              <KeybindProvider>
                                <ThemeProvider mode={mode}>
                                  <LocalProvider
                                    initialModel={input.model}
                                    initialAgent={input.agent}
                                    initialPrompt={input.prompt}
                                  >
                                    <DialogProvider>
                                      <CommandProvider>
                                        <PromptHistoryProvider>
                                          <App />
                                        </PromptHistoryProvider>
                                      </CommandProvider>
                                    </DialogProvider>
                                  </LocalProvider>
                                </ThemeProvider>
                              </KeybindProvider>
                            </ServerStatusProvider>
                          </UIExtensionsProvider>
                        </SyncProvider>
                      </ArgsProvider>
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
  const sync = useSync()
  const local = useLocal()
  const kv = useKV()
  const command = useCommandDialog()
  const { event } = useSDK()
  const toast = useToast()
  const { theme, mode, setMode } = useTheme()
  const exit = useExit()
  const uiExtensions = useUIExtensions()

  // Transition animation state
  const [isTransitioning, setIsTransitioning] = createSignal(false)
  const [previousRoute, setPreviousRoute] = createSignal<string>("home")
  const [pendingSessionRoute, setPendingSessionRoute] = createSignal<string | null>(null)

  // Track route changes for animation
  createEffect(
    on(
      () => route.data.type,
      (currentType, prevType) => {
        // Animate when going from home to session
        if (prevType === "home" && currentType === "session" && !isTransitioning()) {
          const sessionRoute = route.data as SessionRoute
          setPendingSessionRoute(sessionRoute.sessionID)
          setIsTransitioning(true)
          // Route will actually change after animation completes
        }
        setPreviousRoute(currentType)
      },
    ),
  )

  const handleTransitionComplete = () => {
    setIsTransitioning(false)
    setPendingSessionRoute(null)
  }

  createEffect(() => {
    console.log(JSON.stringify(route.data))
  })

  command.register(() => [
    {
      title: "Toggle reasoning visibility",
      value: "ui.toggle_reasoning",
      category: "View",
      onSelect: () => {
        // Web/desktop builds have localStorage; TUI doesn’t, but we also set a global fallback.
        // eslint-disable-next-line no-undef
        const hasLS = typeof localStorage !== "undefined"
        let current = Boolean((globalThis as any).OPENCODE_SHOW_REASONING)
        if (hasLS) {
          // eslint-disable-next-line no-undef
          const stored = localStorage.getItem("opencode:show_reasoning")
          if (typeof stored === "string") {
            current = stored === "1" || stored.toLowerCase() === "true"
          }
        }
        const next = !current
        // eslint-disable-next-line no-undef
        if (hasLS) localStorage.setItem("opencode:show_reasoning", next ? "1" : "0")
        ;(globalThis as any).OPENCODE_SHOW_REASONING = next
        const label = next ? "Showing reasoning" : "Hiding reasoning"
        toast?.show?.({ message: label, variant: "info" })
      },
    },
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
      title: "Open Kanban board",
      value: "ui.kanban",
      category: "Session",
      onSelect: () => {
        dialog.replace(() => <DialogKanban />)
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

    // DISABLED: migrated to plugin
    // {
    //   title: "Skill manager",
    //   value: "skill.manage",
    //   keybind: "skill_manage",
    //   category: "System",
    //   onSelect: () => {
    //     dialog.replace(() => <DialogSkillManager />)
    //   },
    // },
    // DISABLED: raid module removed
    // {
    //   title: "Knowledge Base manager",
    //   value: "kb.manage",
    //   keybind: "kb_manage" as any,
    //   category: "System",
    //   onSelect: () => {
    //     dialog.replace(() => <DialogKbManager />)
    //   },
    // },
    {
      title: "Exit the app",
      value: "app.exit",
      onSelect: exit,
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

  createEffect(() => {
    const currentModel = local.model.current()
    if (!currentModel) return
    const providerID = currentModel.providerID
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
          <Match when={!sync.ready}>
            <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
              <text fg={theme.textMuted}>Loading configuration...</text>
            </box>
          </Match>
          <Match when={route.data.type === "home"}>
            <Home />
          </Match>
          <Match when={route.data.type === "session"}>
            <ContextProvider sessionID={(route.data as SessionRoute).sessionID}>
              <Session />
            </ContextProvider>
          </Match>
        </Switch>
        <TransitionAnimation active={isTransitioning()} onComplete={handleTransitionComplete} />
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
        <box flexDirection="row" flexShrink={0}>
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
              currentAgent && rootAgent && currentAgent !== rootAgent
                ? currentAgent
                : (local.agent.current()?.name ?? "")

            return (
              <>
                <text bg={local.agent.color(agentForColor)}> </text>
                <text
                  bg={local.agent.color(agentForColor)}
                  fg={theme.text}
                  wrapMode={undefined}
                  onMouseUp={() => {
                    if (renderer.getSelection()?.getSelectedText()) return
                    dialog.replace(() => <DialogAgent />)
                  }}
                >
                  <span style={{ bold: true, underline: true }}>
                    {(() => {
                      // If switched (currentAgent differs from rootAgent), show hierarchy
                      if (currentAgent && rootAgent && currentAgent !== rootAgent) {
                        return `${rootAgent.toUpperCase()} > ${currentAgent.toUpperCase()} `
                      }

                      // Otherwise show current agent from local state
                      const agent = local.agent.current()
                      return (agent?.name.toUpperCase() ?? "LOADING") + " "
                    })()}
                  </span>
                </text>
              </>
            )
          })()}
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
