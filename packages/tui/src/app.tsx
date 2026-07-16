import { render, TimeToFirstDraw, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { registerOpencodeSpinner } from "./component/register-spinner"
import { Deferred, Effect } from "effect"
import { Service, type Endpoint } from "@opencode-ai/client/effect/service"
import { OpenCode } from "@opencode-ai/client"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ClipboardProvider, useClipboard } from "./context/clipboard"
import { LogProvider, useLog, type LogSink } from "./context/log"
import { ExitProvider, useExit } from "./context/exit"
import { EpilogueProvider } from "./context/epilogue"
import * as Selection from "./util/selection"
import {
  CliRenderEvents,
  createCliRenderer,
  MouseButton,
  type CliRenderer,
  type CliRendererConfig,
  type ThemeMode,
} from "@opentui/core"
import { RouteProvider, useRoute } from "./context/route"
import {
  Switch,
  Match,
  createEffect,
  createMemo,
  ErrorBoundary,
  createSignal,
  onMount,
  onCleanup,
  batch,
  Show,
} from "solid-js"
import {
  TuiLifecycleProvider,
  TuiPathsProvider,
  TuiStartupProvider,
  TuiTerminalEnvironmentProvider,
  useTuiStartup,
} from "./context/runtime"
import { DialogProvider, useDialog } from "./ui/dialog"
import { DialogIntegration } from "./component/dialog-integration"
import { ErrorComponent } from "./component/error-component"
import { PluginRouteMissing } from "./component/plugin-route-missing"
import { EditorContextProvider } from "./context/editor"
import { useEvent } from "./context/event"
import { ClientProvider, useClient } from "./context/client"
import { StartupLoading } from "./component/startup-loading"
import { DevToolsSidebar } from "./component/devtools-sidebar"
import { DevTools } from "./devtools"
import { Reconnecting } from "./component/reconnecting"
import { DataProvider, useData } from "./context/data"
import { LocationProvider, useLocation } from "./context/location"
import { LocalProvider, useLocal } from "./context/local"
import { PermissionProvider } from "./context/permission"
import { DialogModel } from "./component/dialog-model"
import { useConnected } from "./component/use-connected"
import { DialogMcp } from "./component/dialog-mcp"
import { DialogStatus } from "./component/dialog-status"
import { DialogConfig } from "./component/dialog-config"
import { DialogDebug } from "./component/dialog-debug"
import { DialogPair, type DialogPairCredentials } from "./component/dialog-pair"
import { DialogThemeList } from "./component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { DialogAgent } from "./component/dialog-agent"
import { DialogSessionList } from "./component/dialog-session-list"
import { ThemeProvider, useTheme } from "./context/theme"
import { Home } from "./routes/home"
import { Session } from "./routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { Toast, ToastProvider, useToast } from "./ui/toast"
import { isDefaultTitle } from "./util/session"
import * as Model from "./util/model"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import open from "open"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { Config, ConfigProvider, useConfig } from "./config"
import { createPluginRuntime, PluginRuntimeProvider, usePluginRuntime } from "./plugin/runtime"
import { PluginProvider, PluginRoute, PluginSlot, usePlugin, type PackageResolver } from "./plugin/context"
import { CommandPaletteDialog } from "./component/command-palette"
import { COMMAND_PALETTE_COMMAND, Keymap, type KeymapCommand } from "./context/keymap"

import { DialogVariant } from "./component/dialog-variant"
import { win32DisableProcessedInput, win32FlushInputBuffer } from "./terminal-win32"
import { destroyRenderer } from "./util/renderer"
import { cliErrorMessage, errorFormat } from "./util/error"

const themePerformance = DevTools.register({ id: "theme-performance", title: "Theme performance" })

registerOpencodeSpinner()

const appGlobalBindingCommands = [
  "session.list",
  "session.new",
  "session.quick_switch.1",
  "session.quick_switch.2",
  "session.quick_switch.3",
  "session.quick_switch.4",
  "session.quick_switch.5",
  "session.quick_switch.6",
  "session.quick_switch.7",
  "session.quick_switch.8",
  "session.quick_switch.9",
] as const

const appBindingCommands = [
  "command.palette.show",
  "model.list",
  "model.cycle_recent",
  "model.cycle_recent_reverse",
  "model.cycle_favorite",
  "model.cycle_favorite_reverse",
  "agent.list",
  "mcp.list",
  "agent.cycle",
  "agent.cycle.reverse",
  "variant.cycle",
  "variant.list",
  "provider.connect",
  "opencode.status",
  "server.pair",
  "service.restart",
  "opencode.debug",
  "theme.switch",
  "theme.switch_mode",
  "theme.mode.lock",
  "help.show",
  "docs.open",
  "diff.open",
  "app.debug",
  "app.console",
  "terminal.suspend",
  "terminal.title.toggle",
  "app.toggle.animations",
  "app.toggle.file_context",
  "app.toggle.diffwrap",
  "app.toggle.paste_summary",
] as const

export type TuiInput = {
  server: {
    endpoint: Endpoint
    service?: {
      reconnect: (signal: AbortSignal) => Promise<Endpoint>
      restart: () => Promise<void>
    }
  }
  args: Args
  config: Config.Interface
  packages: PackageResolver
  terminalHandoff?: () => Promise<
    | {
        readonly renderer: CliRenderer
        readonly mode: ThemeMode | null
        readonly complete: () => void
      }
    | undefined
  >
  log?: LogSink
}

function errorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message
  }
  return error instanceof Error ? error.message : String(error)
}

export const run = Effect.fn("Tui.run")(function* (input: TuiInput) {
  const log = input.log ?? (() => {})
  const global = yield* Global.Service
  const config = Config.resolve(yield* Effect.tryPromise(() => input.config.get()), {
    terminalSuspend: process.platform !== "win32",
  })
  const options = { baseUrl: input.server.endpoint.url, headers: Service.headers(input.server.endpoint) }
  const api = OpenCode.make(options)
  const directory = yield* Effect.tryPromise(() => api.file.list({ location: { directory: process.cwd() } })).pipe(
    Effect.map((response) => response.location.directory),
    Effect.catch(() => Effect.tryPromise(() => api.location.get()).pipe(Effect.map((response) => response.directory))),
  )
  const handoff = input.terminalHandoff ? yield* Effect.promise(input.terminalHandoff) : undefined
  const managed = input.server.service
  const service = managed
    ? {
        reconnect: async (signal: AbortSignal) => {
          const endpoint = await managed.reconnect(signal)
          const next = { baseUrl: endpoint.url, headers: Service.headers(endpoint) }
          return { api: OpenCode.make(next) }
        },
        restart: managed.restart,
      }
    : undefined
  const exit = { epilogue: undefined as string | undefined, reason: undefined as unknown }
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const options = {
        externalOutputMode: "passthrough",
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
        autoFocus: false,
        openConsoleOnError: false,
        useMouse: !Flag.OPENCODE_DISABLE_MOUSE && config.mouse,
        consoleOptions: {
          keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
        },
      } satisfies CliRendererConfig
      const renderer = yield* Effect.gen(function* () {
        if (handoff) {
          handoff.renderer.useMouse = options.useMouse
          return yield* Effect.acquireRelease(Effect.succeed(handoff.renderer), (renderer) =>
            Effect.sync(() => destroyRenderer(renderer)),
          )
        }
        if (process.env.OPENCODE_DRIVE) {
          const { Drive } = yield* Effect.promise(() => import("@opencode-ai/simulation/frontend"))
          return yield* Drive.create(options)
        }
        return yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => createCliRenderer(options),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }),
          (renderer) => Effect.sync(() => destroyRenderer(renderer)),
        )
      })
      win32DisableProcessedInput()
      const finalizers = new Set<() => Promise<void>>()
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          const results = await Promise.allSettled([...finalizers].reverse().map((finalizer) => finalizer()))
          results
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .forEach((result) => log("error", "Failed to dispose TUI resource", { error: result.reason }))
        }),
      )
      const shutdown = yield* Deferred.make<unknown>()
      const onSighup = () => destroyRenderer(renderer)
      yield* Effect.acquireRelease(
        Effect.sync(() => process.on("SIGHUP", onSighup)),
        () => Effect.sync(() => process.off("SIGHUP", onSighup)),
      )
      renderer.once("destroy", () => Deferred.doneUnsafe(shutdown, Effect.void))
      const pluginRuntime = createPluginRuntime()

      yield* Effect.tryPromise(async () => {
        const appStarted = performance.now()
        // Prewarm palette before ThemeProvider mounts so `system` theme avoids a first-paint fallback flash.
        void renderer.getPalette({ size: 16 }).catch(() => undefined)
        const modeStarted = performance.now()
        const mode = handoff?.mode ?? (await renderer.waitForThemeMode(1000)) ?? "dark"
        themePerformance.set("Detect light/dark mode", `${(performance.now() - modeStarted).toFixed(2)} ms`)
        if (renderer.isDestroyed) return

        await render(() => {
          return (
            <LogProvider log={log}>
              <ExitProvider
                exit={(reason) => {
                  if (renderer.isDestroyed) return
                  exit.reason = reason
                  destroyRenderer(renderer)
                }}
              >
                <EpilogueProvider set={(value) => (exit.epilogue = value)}>
                  <ErrorBoundary
                    fallback={(error, reset) => <ErrorComponent error={error} reset={reset} mode={mode} />}
                  >
                    <TuiPathsProvider
                      value={{
                        cwd: process.cwd(),
                        home: global.home,
                        state: global.state,
                        worktree: global.data + "/worktree",
                      }}
                    >
                      <TuiLifecycleProvider
                        value={{
                          add(finalizer) {
                            finalizers.add(finalizer)
                            return () => finalizers.delete(finalizer)
                          },
                        }}
                      >
                        <TuiTerminalEnvironmentProvider
                          value={{
                            platform: process.platform,
                            multiplexer: process.env.TMUX ? "tmux" : process.env.STY ? "screen" : undefined,
                            displayServer: process.env.WAYLAND_DISPLAY
                              ? "wayland"
                              : process.env.DISPLAY
                                ? "x11"
                                : undefined,
                          }}
                        >
                          <TuiStartupProvider
                            value={{
                              initialRoute: process.env.OPENCODE_SCRAP
                                ? { type: "plugin", id: "scrap", name: "scrap" }
                                : process.env.OPENCODE_ROUTE
                                  ? JSON.parse(process.env.OPENCODE_ROUTE)
                                  : undefined,
                              skipInitialLoading: Boolean(process.env.OPENCODE_FAST_BOOT),
                            }}
                          >
                            <ClipboardProvider>
                              <ArgsProvider {...input.args}>
                                <ConfigProvider
                                  config={config}
                                  service={input.config}
                                  options={{ terminalSuspend: process.platform !== "win32" }}
                                >
                                  <Keymap.Provider>
                                    <ToastProvider>
                                      <RouteProvider
                                        initialRoute={
                                          input.args.continue
                                            ? {
                                                type: "session",
                                                sessionID: "dummy",
                                              }
                                            : undefined
                                        }
                                      >
                                        <PluginRuntimeProvider value={pluginRuntime}>
                                          <ClientProvider api={api} service={service}>
                                            <PermissionProvider>
                                              <DataProvider>
                                                <LocationProvider>
                                                  <ThemeProvider mode={mode}>
                                                    <LocalProvider>
                                                      <PromptStashProvider>
                                                        <DialogProvider>
                                                          <FrecencyProvider>
                                                            <PromptHistoryProvider>
                                                              <PromptRefProvider>
                                                                <EditorContextProvider>
                                                                  <PluginProvider packages={input.packages}>
                                                                    <App
                                                                      started={appStarted}
                                                                      pair={
                                                                        input.server.endpoint.auth
                                                                          ? input.server.endpoint.auth
                                                                          : {
                                                                              username: "opencode",
                                                                              password: "",
                                                                            }
                                                                      }
                                                                    />
                                                                  </PluginProvider>
                                                                </EditorContextProvider>
                                                              </PromptRefProvider>
                                                            </PromptHistoryProvider>
                                                          </FrecencyProvider>
                                                        </DialogProvider>
                                                      </PromptStashProvider>
                                                    </LocalProvider>
                                                  </ThemeProvider>
                                                </LocationProvider>
                                              </DataProvider>
                                            </PermissionProvider>
                                          </ClientProvider>
                                        </PluginRuntimeProvider>
                                      </RouteProvider>
                                    </ToastProvider>
                                  </Keymap.Provider>
                                </ConfigProvider>
                              </ArgsProvider>
                            </ClipboardProvider>
                          </TuiStartupProvider>
                        </TuiTerminalEnvironmentProvider>
                      </TuiLifecycleProvider>
                    </TuiPathsProvider>
                  </ErrorBoundary>
                </EpilogueProvider>
              </ExitProvider>
            </LogProvider>
          )
        }, renderer)
        if (handoff) {
          renderer.once(CliRenderEvents.FRAME, handoff.complete)
          renderer.requestRender()
        }
      })
      yield* Deferred.await(shutdown)
      return { epilogue: exit.epilogue, reason: exit.reason }
    }),
  )
  yield* Effect.sync(() => {
    win32FlushInputBuffer()
    if (result.reason !== undefined)
      process.stderr.write((cliErrorMessage(result.reason) ?? errorFormat(result.reason)) + "\n")
    if (result.epilogue) process.stdout.write(result.epilogue + "\n")
  })
})

function App(props: { pair?: DialogPairCredentials; started: number }) {
  const log = useLog({ component: "app" })
  const startup = useTuiStartup()
  const config = useConfig()
  const devtools = createMemo(() => config.data.debug?.devtools ?? false)
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const keymap = Keymap.use()
  const event = useEvent()
  const client = useClient()
  const toast = useToast()
  const themeState = useTheme()
  const { theme, mode, setMode, locked, lock, unlock } = themeState
  const data = useData()
  const location = useLocation()
  const exit = useExit()
  const promptRef = usePromptRef()
  const pluginRuntime = usePluginRuntime()
  const plugins = usePlugin()
  const clipboard = useClipboard()

  createEffect(() => {
    if (!themeState.ready) return
    themePerformance.set("Total", `${(performance.now() - props.started).toFixed(2)} ms`)
  })

  // Toast once when an MCP server enters a failed or needs-auth state so the user knows to act,
  // without having to open the status panel. Tracking the last alerted status avoids re-toasting
  // the same problem on every refresh while still re-alerting if the state changes.
  const mcpAlerted: Record<string, string> = {}
  createEffect(() => {
    for (const server of data.location.mcp.server.list() ?? []) {
      const status = server.status
      if (status.status !== "failed" && status.status !== "needs_auth") {
        delete mcpAlerted[server.name]
        continue
      }
      if (mcpAlerted[server.name] === status.status) continue
      mcpAlerted[server.name] = status.status
      if (status.status === "needs_auth")
        toast.show({
          variant: "warning",
          title: "MCP server needs authentication",
          message: `Connect "${server.name}" to use its tools.`,
        })
      else
        toast.show({
          variant: "error",
          title: `MCP server failed: ${server.name}`,
          message: "Open MCP servers to view details.",
        })
    }
  })

  // Let selection copy/dismiss win ahead of normal bindings when explicit copy is required.
  const offSelectionKeys = keymap.intercept(
    "key",
    ({ event }) => {
      if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
      Selection.handleSelectionKey(renderer, toast, event, clipboard)
    },
    { priority: 1 },
  )
  onCleanup(() => {
    offSelectionKeys()
  })

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await clipboard
      .write?.(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
  }
  const terminalTitleEnabled = () => config.data.terminal?.title ?? true
  const pasteSummaryEnabled = () => config.data.prompt?.paste !== "full"

  createEffect(() => {
    renderer.useMouse = !Flag.OPENCODE_DISABLE_MOUSE && config.data.mouse
  })

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (!terminalTitleEnabled() || Flag.OPENCODE_DISABLE_TERMINAL_TITLE) return

    if (route.data.type === "home") {
      renderer.setTerminalTitle("OpenCode")
      return
    }

    if (route.data.type === "session") {
      const session = data.session.get(route.data.sessionID)
      if (!session || isDefaultTitle(session.title)) {
        renderer.setTerminalTitle("OpenCode")
        return
      }

      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`OC | ${title}`)
      return
    }

    if (route.data.type === "plugin") {
      renderer.setTerminalTitle(`OC | ${route.data.name}`)
    }
  })

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Model.parse(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      if (args.sessionID && !args.fork) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    if (continued || !args.continue) return
    continued = true
    const location = data.location.default()
    void client.api.session
      .list({
        limit: 1,
        order: "desc",
        parentID: null,
        directory: location.directory,
        workspace: location.workspaceID,
      })
      .then((response) => {
        const match = response.data[0]?.id
        if (!match) return
        if (!args.fork) {
          route.navigate({ type: "session", sessionID: match })
          return
        }
        void client.api.session
          .fork({ sessionID: match })
          .then((result) => route.navigate({ type: "session", sessionID: result.id }))
          .catch(toast.error)
      })
      .catch(toast.error)
  })

  // Handle --session with --fork once.
  let forked = false
  createEffect(() => {
    if (forked || !args.sessionID || !args.fork) return
    forked = true
    void client.api.session
      .fork({ sessionID: args.sessionID })
      .then((result) => route.navigate({ type: "session", sessionID: result.id }))
      .catch(toast.error)
  })

  const connected = useConnected()
  const appCommands = createMemo(() =>
    [
      {
        name: COMMAND_PALETTE_COMMAND,
        title: "Show command palette",
        category: "System",
        palette: undefined,
        run: () => {
          dialog.replace(() => <CommandPaletteDialog />)
        },
      },
      {
        name: "session.list",
        title: "Switch session",
        category: "Session",
        suggested: data.session.list().length > 0,
        slash: { name: "sessions", aliases: ["resume", "continue"] },
        run: () => {
          dialog.replace(() => <DialogSessionList />)
        },
      },
      {
        name: "session.new",
        title: "New session",
        suggested: route.data.type === "session",
        category: "Session",
        slash: { name: "new", aliases: ["clear"] },
        run: () => {
          route.navigate({
            type: "home",
          })
          dialog.clear()
        },
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        name: `session.quick_switch.${i + 1}`,
        title: `Switch to session in quick slot ${i + 1}`,
        category: "Session",
        palette: undefined,
        run: () => {
          local.session.quickSwitch(i + 1)
        },
      })),
      {
        name: "model.list",
        title: "Switch model",
        suggested: true,
        category: "Agent",
        // Bias /mo toward /models over /move without changing global fuzzy scoring.
        slash: { name: "models", aliases: ["mo"] },
        run: () => {
          dialog.replace(() => <DialogModel />)
        },
      },
      {
        name: "model.cycle_recent",
        title: "Model cycle",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycle(1)
        },
      },
      {
        name: "model.cycle_recent_reverse",
        title: "Model cycle reverse",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycle(-1)
        },
      },
      {
        name: "model.cycle_favorite",
        title: "Favorite cycle",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycleFavorite(1)
        },
      },
      {
        name: "model.cycle_favorite_reverse",
        title: "Favorite cycle reverse",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycleFavorite(-1)
        },
      },
      {
        name: "agent.list",
        title: "Switch agent",
        category: "Agent",
        slash: { name: "agents" },
        run: () => {
          dialog.replace(() => <DialogAgent />)
        },
      },
      {
        name: "mcp.list",
        title: "MCP servers",
        category: "Agent",
        slash: { name: "mcps" },
        run: () => {
          dialog.replace(() => <DialogMcp />)
        },
      },
      {
        name: "agent.cycle",
        title: "Agent cycle",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.agent.move(1)
        },
      },
      {
        name: "variant.cycle",
        title: "Variant cycle",
        category: "Agent",
        run: () => {
          local.model.variant.cycle()
        },
      },
      {
        name: "variant.list",
        title: "Switch model variant",
        category: "Agent",
        palette: local.model.variant.list().length === 0 ? undefined : (true as const),
        slash: { name: "variants" },
        run: () => {
          if (local.model.variant.list().length === 0) {
            return toast.show({
              title: "No variants available",
              message: "The current model does not support any variants.",
              variant: "info",
            })
          }
          dialog.replace(() => <DialogVariant />)
        },
      },
      {
        name: "agent.cycle.reverse",
        title: "Agent cycle reverse",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.agent.move(-1)
        },
      },
      {
        name: "provider.connect",
        title: "Connect integration",
        suggested: !connected(),
        slash: { name: "connect" },
        run: () => {
          dialog.replace(() => (
            <DialogIntegration
              onConnected={(providerID) => dialog.replace(() => <DialogModel providerID={providerID} />)}
            />
          ))
        },
        category: "Integration",
      },
      {
        name: "opencode.settings",
        title: "Open settings",
        suggested: true,
        slash: { name: "settings" },
        run: () => {
          dialog.replace(() => <DialogConfig />)
        },
        category: "System",
      },
      {
        name: "opencode.status",
        title: "View status",
        slash: { name: "status" },
        run: () => {
          dialog.replace(() => <DialogStatus />)
        },
        category: "System",
      },
      {
        name: "server.pair",
        title: "Pair device",
        slash: { name: "pair" },
        run: () => {
          dialog.replace(() => <DialogPair credentials={props.pair} />)
        },
        category: "System",
      },
      ...(client.restart
        ? [
            {
              name: "service.restart",
              title: "Restart service",
              slash: { name: "restart" },
              run: async () => {
                const restart = client.restart
                if (!restart) return
                dialog.clear()
                toast.show({ variant: "info", message: "Restarting service...", duration: 30000 })
                // restart resolves once the replacement service is healthy; the
                // event stream reattaches through the reconnect loop.
                await restart()
                  .then(() => toast.show({ variant: "success", message: "Service restarted" }))
                  .catch(toast.error)
              },
              category: "System",
            },
          ]
        : []),
      {
        name: "opencode.debug",
        title: "View debug info",
        slash: { name: "debug" },
        run: () => {
          dialog.replace(() => <DialogDebug />)
        },
        category: "System",
      },
      {
        name: "theme.switch",
        title: "Switch theme",
        slash: { name: "themes" },
        run: () => {
          dialog.replace(() => <DialogThemeList />)
        },
        category: "System",
      },
      {
        name: "theme.switch_mode",
        title: mode() === "dark" ? "Switch to light mode" : "Switch to dark mode",
        palette: undefined,
        run: () => {
          setMode(mode() === "dark" ? "light" : "dark")
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "theme.mode.lock",
        title: locked() ? "Unlock theme mode" : "Lock theme mode",
        palette: undefined,
        run: () => {
          if (locked()) unlock()
          else lock()
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "help.show",
        title: "Help",
        slash: { name: "help" },
        run: () => {
          dialog.replace(() => <DialogHelp />)
        },
        category: "System",
      },
      {
        name: "docs.open",
        title: "Open docs",
        run: () => {
          open("https://opencode.ai/docs").catch(() => {})
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "app.exit",
        title: "Exit the app",
        slash: { name: "exit", aliases: ["quit", "q"] },
        run: () => exit(),
        category: "System",
      },
      {
        name: "app.debug",
        title: "Toggle debug panel",
        category: "System",
        run: () => {
          renderer.toggleDebugOverlay()
          dialog.clear()
        },
      },
      {
        name: "app.console",
        title: "Toggle console",
        category: "System",
        run: () => {
          renderer.console.toggle()
          dialog.clear()
        },
      },
      {
        name: "terminal.suspend",
        title: "Suspend terminal",
        category: "System",
        palette: undefined,
        enabled: process.platform !== "win32",
        run: () => {
          renderer.suspend()
          process.once("SIGCONT", () => renderer.resume())
          process.kill(0, "SIGTSTP")
        },
      },
      {
        name: "terminal.title.toggle",
        title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
        category: "System",
        palette: undefined,
        run: () => {
          const next = !terminalTitleEnabled()
          if (!next) renderer.setTerminalTitle("")
          void config
            .update((draft) => {
              draft.terminal = { ...draft.terminal, title: next }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.animations",
        title: (config.data.animations ?? true) ? "Disable animations" : "Enable animations",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.animations = !(config.data.animations ?? true)
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.file_context",
        title: (config.data.prompt?.editor ?? true) ? "Disable file context" : "Enable file context",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.prompt = { ...draft.prompt, editor: !(config.data.prompt?.editor ?? true) }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.diffwrap",
        title: (config.data.diffs?.wrap ?? "word") === "word" ? "Disable diff wrapping" : "Enable diff wrapping",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.diffs = {
                ...draft.diffs,
                wrap: (config.data.diffs?.wrap ?? "word") === "word" ? "none" : "word",
              }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.paste_summary",
        title: pasteSummaryEnabled() ? "Disable paste summary" : "Enable paste summary",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.prompt = { ...draft.prompt, paste: pasteSummaryEnabled() ? "full" : "compact" }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "permission.mode",
        title:
          local.permission.mode === "auto" ? "Disable auto-approve permissions" : "Enable auto-approve permissions",
        category: "System",
        run: () => {
          local.permission.toggle()
          dialog.clear()
        },
      },
    ].map(
      ({ name, category, ...command }) =>
        ({
          id: name,
          group: category,
          bind: false,
          palette: true as const,
          ...command,
        }) satisfies KeymapCommand,
    ),
  )

  Keymap.createLayer(() => ({
    mode: "global",
    commands: appCommands(),
  }))

  Keymap.createLayer(() => ({
    bindings: appBindingCommands,
  }))

  Keymap.createLayer(() => ({
    mode: "global",
    bindings: appGlobalBindingCommands,
  }))

  Keymap.createLayer(() => ({
    enabled: () => {
      const current = promptRef.current
      if (!current?.focused) return true
      return current.current.text === ""
    },
    bindings: ["app.exit"],
  }))

  event.on("tui.command.execute", (evt, { workspace }) => {
    if (workspace !== (location.current?.workspaceID ?? data.location.default().workspaceID)) return
    keymap.dispatch(evt.data.command)
  })

  event.on("tui.toast.show", (evt, { workspace }) => {
    if (workspace !== (location.current?.workspaceID ?? data.location.default().workspaceID)) return
    toast.show({
      title: evt.data.title,
      message: evt.data.message,
      variant: evt.data.variant,
      duration: evt.data.duration,
    })
  })

  event.on("tui.session.select", (evt, { workspace }) => {
    if (workspace !== (location.current?.workspaceID ?? data.location.default().workspaceID)) return
    route.navigate({
      type: "session",
      sessionID: evt.data.sessionID,
    })
  })

  event.on("session.deleted", (evt) => {
    if (route.data.type === "session" && route.data.sessionID === evt.data.sessionID) {
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  event.on("session.error", (evt, { workspace }) => {
    if (workspace !== (location.current?.workspaceID ?? data.location.default().workspaceID)) return
    const error = evt.data.error
    if (error && typeof error === "object" && error.name === "MessageAbortedError") return
    const message = errorMessage(error)

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  // Suppress the full-screen overlay for transient startup and event-stream retry states.
  // Initial connection gets a longer grace period; retries surface more quickly.
  const [showReconnecting, setShowReconnecting] = createSignal(false)
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    const status = client.connection.status()
    if (status === "connected") {
      setShowReconnecting(false)
      return
    }
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = undefined
        setShowReconnecting(true)
      },
      status === "reconnecting" ? 1000 : 5000,
    ).unref()
  })
  onCleanup(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background}
      onMouseDown={(evt) => {
        if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
        if (evt.button !== MouseButton.RIGHT) return

        if (!Selection.copy(renderer, toast, clipboard)) return
        evt.preventDefault()
        evt.stopPropagation()
      }}
      onMouseUp={
        !Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
          ? () => Selection.copy(renderer, toast, clipboard)
          : undefined
      }
    >
      <Show when={Flag.OPENCODE_SHOW_TTFD}>
        <TimeToFirstDraw />
      </Show>
      <box flexGrow={1} minHeight={0} flexDirection="row">
        <box flexGrow={1} minWidth={0} flexDirection="column">
          <Show when={plugins.ready()}>
            <box flexGrow={1} minHeight={0} flexDirection="column">
              <Switch>
                <Match when={route.data.type === "home"}>
                  <Home />
                </Match>
                <Match when={route.data.type === "session"}>
                  <Show when={route.data.type === "session" ? route.data.sessionID : undefined} keyed>
                    {(_) => <Session />}
                  </Show>
                </Match>
                <Match when={route.data.type === "plugin"}>
                  <PluginRoute
                    fallback={(id, name) => (
                      <PluginRouteMissing id={id} name={name} onHome={() => route.navigate({ type: "home" })} />
                    )}
                  />
                </Match>
              </Switch>
            </box>
            <box flexShrink={0}>
              <PluginSlot name="app.bottom" />
            </box>
            <PluginSlot name="app" />
          </Show>
        </box>
        <Show when={devtools()}>
          <DevToolsSidebar />
        </Show>
      </box>
      <Show when={!startup.skipInitialLoading}>
        <StartupLoading ready={plugins.ready} />
      </Show>
      <Show when={showReconnecting()}>
        <Reconnecting />
      </Show>
      <Toast />
    </box>
  )
}
