import { useDialog } from "@opencode/ui/context/dialog"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { ExtensionContext, useExtension, type IpcClient } from "../../../../gui-extensions/src/sdk"
import type { Pairing } from "../../../../gui-extensions/src/pairing/contract"
import type { PairingServer } from "../../../../gui-extensions/src/pairing/page"
// The pairing page renders inside the app's settings page, which brings these styles.
import "@/settings/settings.css"

type Links = { custom: string; selected: string }

/** A local server that advertises fixed addresses and issues a fresh code each time. */
export function pairingServer(urls: readonly string[]): PairingServer {
  return {
    client: {
      server: {
        info: async () => ({ urls }),
        pair: async () => ({ code: pairingCode(), expires_in: 300 }),
      },
    },
  }
}

/** A pairing main entry whose display sleep blocker is off. */
export function pairingClient(): IpcClient<typeof Pairing.spec> {
  return {
    screenActive: async () => false,
    setScreenActive: async () => undefined,
    state: () => undefined,
    on: () => () => undefined,
  }
}

/**
 * Stands in for the HostApis the pairing page reads that extension stories do not provide: its window store, dialogs
 * through the app's dialog stack, and a clipboard that accepts every copy.
 */
export function PairingHost(props: { links?: Partial<Links>; children: JSX.Element }) {
  const base = useExtension()
  const dialog = useDialog()
  const [links, setLinks] = createStore<Links>({ custom: "", selected: "", ...props.links })
  const client = new QueryClient()
  // Dialogs render in the app's dialog stack, outside this subtree, so they get the context again as the host does.
  const scoped = (render: () => JSX.Element) => (
    <QueryClientProvider client={client}>
      <ExtensionContext.Provider value={context}>{render()}</ExtensionContext.Provider>
    </QueryClientProvider>
  )
  const context = Object.create(base, {
    stores: {
      value: {
        links: {
          get value() {
            return links
          },
          ready: () => true,
          update: (mutate: (draft: Links) => undefined) => setLinks(produce(mutate)),
          set: (next: Links) => setLinks(next),
        },
      },
    },
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
