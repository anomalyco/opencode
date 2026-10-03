import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { createSignal, Show } from "solid-js"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface, preloadRoute } from "../../src/app"
import { useLanguage, type Direction } from "../../src/runtime/i18n/language"
import { PlatformProvider } from "../../src/runtime/platform/platform"
import { createWebPlatform } from "../../src/runtime/platform/web"
import { ServerConnection } from "../../src/runtime/server/registry"

/**
 * Mounts the app at a route. With `held`, the window's providers and extensions start at once and the app interface
 * mounts only when "Start app" is pressed, over its preloaded route, as the desktop shell mounts it once its server is up.
 */
export function mount(input: { server: string; route: string; direction: Direction; held?: boolean }) {
  const root = document.getElementById("root")

  if (!root) throw new Error("Missing fixture root")
  const history = createMemoryHistory()
  history.set({ value: input.route, replace: true, scroll: false })
  const server: ServerConnection.Http = { type: "http", http: { url: input.server } }
  const [started, setStarted] = createSignal(!input.held)

  function DirectedApp() {
    const language = useLanguage()
    language.setDirection(input.direction)

    return (
      <AppInterface
        servers={[server]}
        defaultServer={ServerConnection.key(server)}
        canonicalLocalServer={ServerConnection.key(server)}
        router={(props) => <MemoryRouter {...props} history={history} />}
      />
    )
  }

  render(
    () => (
      <PlatformProvider value={createWebPlatform("test").platform}>
        <AppBaseProviders locale="en">
          <Show
            when={started()}
            fallback={
              <button onClick={() => void preloadRoute(input.route).then(() => setStarted(true))}>Start app</button>
            }
          >
            <DirectedApp />
          </Show>
        </AppBaseProviders>
      </PlatformProvider>
    ),
    root,
  )
}
