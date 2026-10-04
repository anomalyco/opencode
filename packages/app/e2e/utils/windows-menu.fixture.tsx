import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import type { Bridge } from "@opencode/gui-extensions/sdk/bridge"
import { AppBaseProviders, AppInterface } from "../../src/app"
import { PlatformProvider, type Platform } from "../../src/runtime/platform/platform"
import { ServerConnection } from "../../src/runtime/server/registry"

// The app on a Windows desktop platform, so the titlebar shows the app menu. Menu actions are listed in an output.
export function mount(input: { server: string }) {
  const root = document.getElementById("root")

  if (!root) throw new Error("Missing fixture root")
  const history = createMemoryHistory()
  render(() => {
    const [store, setStore] = createStore<{ actions: string[] }>({ actions: [] })

    const unused = async () => {
      throw new Error("Unexpected fixture action")
    }

    // No main-process extensions run in this fixture.
    const bridge: Bridge = {
      packaged: false,
      call: unused,
      subscribe: async () => ({ available: false }),
      on: () => () => undefined,
      embed: () => undefined,
      capture: async () => undefined,
      runMenubarItem: () => undefined,
      configure: () => undefined,
      manager: {
        list: async () => [],
        enable: async () => undefined,
        disable: async () => undefined,
        reload: async () => undefined,
        install: async () => undefined,
        remove: async () => undefined,
        source: async () => "",
        asset: () => "",
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
      extensions: bridge,
      runDesktopMenuAction: (action) => setStore("actions", (actions) => [...actions, action]),
    }

    return (
      <PlatformProvider value={platform}>
        <AppBaseProviders locale="en">
          <output aria-label="Desktop menu actions">{store.actions.join(",")}</output>
          <AppInterface
            servers={[{ type: "sidecar", variant: "base", displayName: "Local Server", http: { url: input.server } }]}
            defaultServer={ServerConnection.Key.make("sidecar")}
            router={(props) => <MemoryRouter {...props} history={history} />}
          />
        </AppBaseProviders>
      </PlatformProvider>
    )
  }, root)
}
