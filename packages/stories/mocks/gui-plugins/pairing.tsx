import { useDialog } from "@opencode/ui/context/dialog"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { JSX } from "solid-js"
import { usePlugin, type IpcClient } from "../../../plugin/src/gui/index"
import { PluginContext } from "../../../plugin/src/gui/internal"
import type { Pairing } from "../../../gui-plugins/src/pairing/contract"
import { REMOTE_READ_RETRIES } from "../../../gui-plugins/src/pairing/machine"
import type { PairingServer } from "../../../gui-plugins/src/pairing/page"
// The pairing page renders inside the app's settings page, which brings these styles.
import "@/settings/settings.css"

export const pairingResponses = [
  "Normal",
  "Remote read fails",
  "Remote change fails",
  "Screen read fails",
  "Screen change fails",
  "Tunnel connects slowly",
  "Code request fails",
  "Copy fails",
] as const

type Response = (typeof pairingResponses)[number]

/** In-memory settings, tunnel discovery, codes and clipboard, scoped to one story instance. */
export function pairingRemote(input: {
  enabled: boolean
  screenActive?: boolean
  response?: Response
  expiresIn?: number
}) {
  const state = {
    enabled: input.enabled,
    screen: input.screenActive ?? false,
    issued: 0,
    tunnelPolls: input.response === "Tunnel connects slowly" ? 3 : 0,
    // Exhaust the automatic read retries. A manual retry (or the next write, request or copy) can then succeed.
    failures:
      input.response === "Remote read fails" || input.response === "Screen read fails" ? REMOTE_READ_RETRIES + 1 : 1,
  }

  const fail = (operation: Response) => {
    if (input.response !== operation || state.failures === 0) return

    state.failures -= 1
    throw new Error(operation)
  }

  const server: PairingServer = {
    client: {
      server: {
        info: async () => {
          const urls = ["http://localhost.invalid"]

          if (state.enabled && state.tunnelPolls === 0) urls.push("https://pairing.invalid")
          if (state.tunnelPolls > 0) state.tunnelPolls -= 1

          return { urls }
        },
        pair: async () => {
          fail("Code request fails")
          state.issued += 1
          // As with server codes, encode 16 bytes. A new fixture replays the same sequence of QR codes.
          const code = btoa(`story:${String(state.issued).padStart(10, "0")}`).replace(/=+$/, "")

          return { code, expires_in: input.expiresIn ?? 300 }
        },
      },
    },
  }

  const client: IpcClient<typeof Pairing.spec> = {
    remote: async () => {
      fail("Remote read fails")

      return state.enabled
    },
    setRemote: async (enabled, options) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      options?.signal?.throwIfAborted()
      fail("Remote change fails")
      state.enabled = enabled
    },
    screenActive: async () => {
      fail("Screen read fails")

      return state.screen
    },
    setScreenActive: async (enabled) => {
      fail("Screen change fails")
      state.screen = enabled
    },
    state: () => undefined,
    on: () => () => undefined,
  }

  return { server, client, copy: async () => fail("Copy fails") }
}

/**
 * Stands in for the HostApis the pairing page reads that plugin stories do not provide: dialogs through the app's
 * dialog stack, and a fixture clipboard.
 */
export function PairingHost(props: { children: JSX.Element; copy?: () => Promise<void> }) {
  const base = usePlugin()

  const dialog = useDialog()

  const client = new QueryClient()

  // Dialogs render in the app's dialog stack, outside this subtree, so they get the context again as the host does.
  const scoped = (render: () => JSX.Element) => (
    <QueryClientProvider client={client}>
      <PluginContext.Provider value={context}>{render()}</PluginContext.Provider>
    </QueryClientProvider>
  )
  const context: typeof base = Object.create(base, {
    dialogs: {
      value: {
        open: (render: () => JSX.Element) => {
          void dialog.show(() => scoped(render))
          return { close: () => dialog.close() }
        },
      },
    },
    system: { value: { copy: props.copy ?? (async () => undefined) } },
  })

  return scoped(() => (
    <div class="settings-screen" style={{ "max-width": "820px", padding: "32px", margin: "0 auto" }}>
      {props.children}
    </div>
  ))
}
