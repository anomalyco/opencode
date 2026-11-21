import { createServer, type ServerResponse } from "node:http"
import electron from "electron"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"
import type { PaneEvent } from "./ipc"
import type { Profile } from "./profile"

// The Electron main process of `electron-open.test.ts`, bundled and run by the pinned Electron. It attaches the real
// pane to a stand-in for the session's server, then opens tabs as a link in the conversation does (the window's
// `tabs.open` command with an address): to a page that loads, to a page that shows and is still loading when the
// command's deadline passes, and to an address nothing answers. It prints the tabs the pane reported, as one JSON line.

const loaded = `<!doctype html><title>Loaded</title><p>loaded</p>`

// The document arrives and shows. Its image never answers, so the page never finishes loading.
const loading = `<!doctype html><title>Still loading</title><p>shown</p><img src="/never">`

// The pages the tabs open.
function createPages() {
  return createServer((request, response) => {
    if (request.url === "/never") return

    if (request.url === "/favicon.ico") return void response.writeHead(404).end()
    response.writeHead(200, { "content-type": "text/html" })
    response.end(request.url === "/loading" ? loading : loaded)
  })
}

const session = {
  id: "ses_fixture",
  projectID: "prj_fixture",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  location: { directory: process.cwd() },
}

type Frame =
  | { type: "server.connected"; data: {} }
  | {
      type: "rpc.experimental.browser.control"
      created: number
      location: { directory: string }
      data: { type: "attached"; connectionID: string; version: 4 }
    }

const frame = (event: Frame) => `data: ${JSON.stringify({ id: `evt_${Date.now()}`, ...event })}\n\n`

// The session's server, as far as a pane's attachment asks: the session, the event stream, and the browser RPC, whose
// `attach` call it answers with the `attached` handshake on the stream and then holds open.
function createApi() {
  const streams = new Set<ServerResponse>()

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture").pathname

    if (path === "/api/event") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      response.write(frame({ type: "server.connected", data: {} }))
      streams.add(response)

      return
    }

    if (path === "/api/session/ses_fixture") {
      response.writeHead(200, { "content-type": "application/json" })

      return void response.end(JSON.stringify({ data: session }))
    }

    if (!path.startsWith("/api/rpc/experimental.browser/")) return void response.writeHead(404).end()
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      if (!path.endsWith("/attach")) {
        response.writeHead(200, { "content-type": "application/json" })

        return void response.end("{}")
      }

      const connectionID: string = JSON.parse(Buffer.concat(chunks).toString()).input.connectionID
      streams.forEach((stream) =>
        stream.write(
          frame({
            type: "rpc.experimental.browser.control",
            created: 0,
            location: session.location,
            data: { type: "attached", connectionID, version: 4 },
          }),
        ),
      )
    })
  })

  return {
    server,
    close() {
      streams.forEach((stream) => stream.destroy())
      server.closeAllConnections()
      server.close()
    },
  }
}

const listen = (server: ReturnType<typeof createServer>) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()

      resolve(`http://127.0.0.1:${address instanceof Object ? address.port : 0}`)
    }),
  )

void electron.app.whenReady().then(async () => {
  const { createBrowserPane } = await import("./pane")
  const { createHandlePath } = await import("./disk")
  const { RefsStore } = await import("./refs")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")
  const pages = createPages()
  const api = createApi()
  const origin = await listen(pages)
  const server = await listen(api.server)
  // An address nothing answers: the port of a server that closed.
  const closed = createServer()
  const refused = await listen(closed)
  await new Promise<void>((resolve) => closed.close(() => resolve()))
  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const values = new Map<string, unknown>()

  // SAFETY: the site permissions, the saved tabs and the reserved refs read only `store` and its `value` and `set`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const storage = {
    store: (key: string, options: { initial: unknown }) => ({
      get value() {
        return values.has(key) ? values.get(key) : options.initial
      },
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
      set: (next: unknown) => values.set(key, next),
    }),
  } as unknown as BuiltinMainStorage

  const embeds: Embeds = {
    create(view, window) {
      window.contentView.addChildView(view)
      view.setBounds({ x: 0, y: 0, width: 800, height: 600 })

      return {
        id: "embed",
        show: (visible) => view.setVisible(visible),
        on: () => () => undefined,
        capture: async () => undefined,
        dispose: () => window.contentView.removeChildView(view),
      }
    },
  }

  // SAFETY: a pane of the app's own server with no extension reads only these members of the profile.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const profile = {
    partition: "open-fixture",
    session: electron.session.fromPartition("open-fixture"),
    previews: { failure: () => undefined },
    extensionIDs: () => [],
    extensionMenu: () => [],
    extensionTabs: { register: () => () => undefined, activated: () => undefined, hidden: () => undefined },
    downloads: new Map(),
    permissions: new Map(),
  } as unknown as Profile

  // Every inventory the pane reported to the window, in order: each tab's address, and whether it loads or failed.
  const reported: { url: string; loading: boolean; failed: boolean }[][] = []
  // What the pane wrote to the desktop log.
  const logged: string[] = []

  const pane = createBrowserPane({
    toolbar: false,
    windows: { get: (id) => (id === win.id ? win : undefined), list: () => [win], focused: () => win, on: () => () => undefined },
    t: (key) => key,
    serverEndpoints: { get: () => ({ id: "sidecar", url: server, headers: {}, sameMachine: true }) },
    storage,
    refs: storage.store("refs", RefsStore),
    embeds,
    profile,
    sites: createSitePermissions(storage, () => undefined),
    system: createSystemMedia(),
    verifier: createHandlePath(),
    log: { write: (_level, message) => void logged.push(message) },
    emit: (_window, value: { readonly event: PaneEvent }) => {
      if (value.event.type === "state" && value.event.state)
        reported.push(value.event.state.tabs.map((tab) => ({ url: tab.url, loading: tab.loading, failed: tab.loadError !== undefined })))
    },
  })

  await pane.register(win.id, "binding", { server: "sidecar", session: "ses_fixture" })
  const open = (url: string) => pane.command(win.id, "binding", { type: "tabs.open", url }).then(() => "settled", (error: Error) => error.message)
  const addresses = () => (reported.at(-1) ?? []).map((tab) => tab.url)
  const first = await open(`${origin}/first`)
  const second = await open(`${origin}/second`)
  const before = addresses()
  // Both at once: the still-loading page's command settles when its 15 s deadline passes.
  const [still, failed] = await Promise.all([open(`${origin}/loading`), open(`${refused}/`)])
  // Any report that follows the commands has arrived by now.
  await new Promise<void>((resolve) => setTimeout(resolve, 500))
  process.stdout.write(
    `${JSON.stringify({
      origin,
      refused,
      commands: { first, second, still, failed },
      before,
      // The still-loading page committed and showed: an inventory listed its tab at its address.
      shown: reported.some((tabs) => tabs.some((tab) => tab.url === `${origin}/loading`)),
      after: reported.at(-1),
      logged,
    })}\n`,
  )
  await pane.dispose()
  api.close()
  pages.closeAllConnections()
  pages.close()
  electron.app.quit()
})
