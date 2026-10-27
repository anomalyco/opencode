import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import type { Bridge } from "@opencode/plugin/gui/host"
import { AppBaseProviders, AppInterface } from "../../src/app"
import { PlatformProvider, type Platform } from "../../src/runtime/platform/platform"

// The app on a Windows desktop platform, so the titlebar shows the app menu. Menu actions are listed in an output.
// `path` opens a route other than Home.
export function mount(input: { server: string; path?: string }) {
  const root = document.getElementById("root")

  if (!root) throw new Error("Missing fixture root")
  const history = createMemoryHistory()

  if (input.path) history.set({ value: input.path, replace: true })
  render(() => {
    const [store, setStore] = createStore<{ actions: string[] }>({ actions: [] })

    const unused = async () => {
      throw new Error("Unexpected fixture action")
    }

    // No main-process plugins run in this fixture.
    const bridge: Bridge = {
      packaged: false,
      call: unused,
      subscribe: async () => ({ available: false }),
      on: () => () => undefined,
      embed: () => undefined,
      capture: async () => undefined,
      runMenubarItem: () => undefined,
      configure: () => undefined,
      pluginGuis: async () => ({ plugins: [], reserved: [] }),
      manager: {
        list: async () => [],
        enable: async () => undefined,
        disable: async () => undefined,
        reload: async () => undefined,
      },
    }

    const platform: Platform = {
      platform: "desktop",
      os: "windows",
      windowID: "windows-menu-test",
      openExternal: () => undefined,
      openDirectoryPickerDialog: async () => null,
      notify: async () => undefined,
      restart: unused,
      plugins: bridge,
      runDesktopMenuAction: (action) => setStore("actions", (actions) => [...actions, action]),
    }

    return (
      <PlatformProvider value={platform}>
        <AppBaseProviders locale="en">
          <output aria-label="Desktop menu actions">{store.actions.join(",")}</output>
          <AppInterface
            servers={[{ type: "sidecar", variant: "base", displayName: "Local Server", http: { url: input.server } }]}
            router={(props) => <MemoryRouter {...props} history={history} />}
          />
        </AppBaseProviders>
      </PlatformProvider>
    )
  }, root)
}
