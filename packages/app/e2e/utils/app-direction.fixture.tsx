import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { createSignal, Show } from "solid-js"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface, preloadRoute } from "../../src/app"
import { useLanguage, type Direction } from "../../src/runtime/i18n/language"
import { PlatformProvider } from "../../src/runtime/platform/platform"
import { createWebPlatform } from "../../src/runtime/platform/web"
import { ServerConnection } from "../../src/runtime/server/registry"
import { Command } from "@opencode/plugin/gui"
import { usePluginHost } from "../../src/runtime/plugin/host"
import { useCommand } from "../../src/shell/commands/command"

/**
 * Mounts the app at a route. With `held`, the window's providers and plugins start at once and the app interface
 * mounts only when "Start app" is pressed, over its preloaded route, as the desktop shell mounts it once its server is up.
 * One plugin's load also waits for "Finish startup", so the attachment can mount before the routes render.
 */
export function mount(input: { server: string; route: string; direction: Direction; held?: boolean }) {
  const root = document.getElementById("root")

  if (!root) throw new Error("Missing fixture root")
  const history = createMemoryHistory()
  history.set({ value: input.route, replace: true, scroll: false })
  const server: ServerConnection.Http = { type: "http", http: { url: input.server } }
  const [started, setStarted] = createSignal(!input.held)
  const [finished, setFinished] = createSignal(false)
  const held = Promise.withResolvers<void>()

  function StartupGate() {
    const host = usePluginHost()
    const command = useCommand()

    // PluginCommands publishes before ready, proving the attachment mounted even while the routes wait.
    const registered = () =>
      host
        .items(Command)
        .some((item) => command.options.some((option) => option.id === `${item.plugin}.${item.value.id}`))

    return (
      <button
        disabled={!registered()}
        onClick={() => {
          held.resolve()
          setFinished(true)
        }}
      >
        Finish startup
      </button>
    )
  }

  function DirectedApp() {
    const language = useLanguage()
    language.setDirection(input.direction)

    return (
      <AppInterface
        servers={[server]}
        canonicalLocalServer={ServerConnection.key(server)}
        router={(props) => <MemoryRouter {...props} history={history} />}
      >
        <Show when={input.held && !finished()}>
          <StartupGate />
        </Show>
      </AppInterface>
    )
  }

  function Startup() {
    const host = usePluginHost()
    const definition = host.definitions().find((item) => item.windowEntry)
    const load = definition?.windowEntry

    // Hold a real plugin through the public reload API before the startup gate first settles.
    if (input.held && definition && load)
      host.reload(definition.id, {
        ...definition,
        windowEntry: async () => {
          await held.promise

          return load()
        },
      })

    return (
      <Show
        when={started()}
        fallback={<button onClick={() => void preloadRoute(input.route).then(() => setStarted(true))}>Start app</button>}
      >
        <DirectedApp />
      </Show>
    )
  }

  render(
    () => (
      <PlatformProvider value={createWebPlatform("test").platform}>
        <AppBaseProviders locale="en">
          <Startup />
        </AppBaseProviders>
      </PlatformProvider>
    ),
    root,
  )
}
