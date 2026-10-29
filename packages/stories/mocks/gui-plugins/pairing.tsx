import { useDialog } from "@opencode/ui/context/dialog"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { JSX } from "solid-js"
import { usePlugin, type IpcClient } from "../../../plugin/src/gui/index"
import { PluginContext } from "../../../plugin/src/gui/internal"
import type { Pairing } from "../../../gui-plugins/src/pairing/contract"
import type { PairingServer } from "../../../gui-plugins/src/pairing/page"
// The pairing page renders inside the app's settings page, which brings these styles.
import "@/settings/settings.css"

/**
 * A local server and pairing main entry. Remote access starts on or off; turning it on takes a moment, after which
 * the server advertises its tunnel, as the background service does once OpenTunnel attaches. `fails` makes turning
 * it on fail, as when the tunnel cannot be created.
 */
export function pairingRemote(input: { enabled: boolean; fails?: boolean }) {
  const state = { enabled: input.enabled }
  const server: PairingServer = {
    client: {
      server: {
        info: async () => ({
          urls: [
            "http://127.0.0.1:49374",
            ...(state.enabled ? ["https://cbf8424f2044b16d.vcybm3xt4hhu.opentunnel.xyz"] : []),
          ],
        }),
        pair: async () => ({ code: pairingCode(), expires_in: 300 }),
      },
    },
  }
  const client: IpcClient<typeof Pairing.spec> = {
    remote: async () => state.enabled,
    setRemote: async (enabled) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))

      if (input.fails) throw new Error("Timed out creating the remote access tunnel")
      state.enabled = enabled
    },
    screenActive: async () => false,
    setScreenActive: async () => undefined,
    state: () => undefined,
    on: () => () => undefined,
  }

  return { server, client }
}

/**
 * Stands in for the HostApis the pairing page reads that plugin stories do not provide: dialogs through the app's
 * dialog stack, and a clipboard that accepts every copy.
 */
export function PairingHost(props: { children: JSX.Element }) {
  const base = usePlugin()
  const dialog = useDialog()
  const client = new QueryClient()
  // Dialogs render in the app's dialog stack, outside this subtree, so they get the context again as the host does.
  const scoped = (render: () => JSX.Element) => (
    <QueryClientProvider client={client}>
      <PluginContext.Provider value={context}>{render()}</PluginContext.Provider>
    </QueryClientProvider>
  )
  const context = Object.create(base, {
    dialogs: {
      value: {
        open: (render: () => JSX.Element) => {
          void dialog.show(() => scoped(render))
          return { close: () => dialog.close() }
        },
      },
    },
    system: { value: { copy: async () => undefined } },
  })

  return scoped(() => (
    <div class="settings-screen" style={{ "max-width": "820px", padding: "32px", margin: "0 auto" }}>
      {props.children}
    </div>
  ))
}

// The server's codes are 16 random bytes in base64url.
function pairingCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}
