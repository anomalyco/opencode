import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { createSignal, Show } from "solid-js"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface, preloadRoute } from "../../src/app"
import { useLanguage, type Direction } from "../../src/runtime/i18n/language"
import { PlatformProvider } from "../../src/runtime/platform/platform"
import { createWebPlatform } from "../../src/runtime/platform/web"
import { ServerConnection } from "../../src/runtime/server/registry"
import { Command } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "../../src/runtime/extension/host"
import { useCommand } from "../../src/shell/commands/command"

/**
 * Mounts the app at a route. With `held`, the window's providers and extensions start at once and the app interface
 * mounts only when "Start app" is pressed, over its preloaded route, as the desktop shell mounts it once its server is up.
 * One extension's load also waits for "Finish startup", so the attachment can mount before the routes render.
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
    const host = useExtensionHost()
    const command = useCommand()

    // ExtensionCommands publishes before ready, proving the attachment mounted even while the routes wait.
    const registered = () =>
      host
        .items(Command)
        .some((item) => command.options.some((option) => option.id === `${item.extension}.${item.value.id}`))

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
        defaultServer={ServerConnection.key(server)}
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
    const host = useExtensionHost()
    const definition = host.definitions().find((item) => item.renderer)
    const load = definition?.renderer

    // Hold a real extension through the public reload API before the startup gate first settles.
    if (input.held && definition && load)
      host.reload(definition.id, {
        ...definition,
        renderer: async () => {
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
