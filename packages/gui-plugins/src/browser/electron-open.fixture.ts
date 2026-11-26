import { createServer, type ServerResponse } from "node:http"
import electron from "electron"
import { Schema } from "effect"
import { RpcError } from "@opencode/protocol/errors"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"
import type { Browser } from "@opencode/plugin-browser/rpc"
import type { PaneEvent } from "./ipc"
import type { Profile } from "./profile"

// The Electron main process of `electron-open.test.ts`, bundled and run by the pinned Electron. It attaches the real
// pane to a stand-in for the session's server, then opens tabs the three ways a tab is opened with an address: as a
// link in the conversation does (the window's `tabs.open` command), as a plugin does (`createTab`), and as the agent
// does (a command from the server, for a web address and for a workspace file). Each opens a page that shows and is
// still loading when the command's deadline passes; the person and the plugin also open a page that fails to load,
// and the plugin an address that opens no page. The pane is given a deadline of 300 ms in place of its 15 seconds,
// and nothing here depends on a page beating it: a load that outlasts it only settles its command sooner. It prints
// what the pane reported and answered, as one JSON line.

const loaded = `<!doctype html><title>Loaded</title><p>loaded</p>`

// The document arrives and shows. Its image never answers, so the page never finishes loading.
const loading = `<!doctype html><title>Still loading</title><p>shown</p><img src="/never">`

// The pages the tabs open.
function createPages() {
  return createServer((request, response) => {
    if (request.url === "/never" || request.url?.startsWith("/hung")) return

    // The server drops the connection, so Chromium fails the load at once.
    if (request.url?.startsWith("/dropped")) return void request.socket.destroy()

    // No content: the navigation ends without a page, as a link that becomes a download does.
    if (request.url === "/nothing") return void response.writeHead(204).end()

    if (request.url === "/favicon.ico") return void response.writeHead(404).end()
    response.writeHead(200, { "content-type": "text/html" })
    response.end(request.url?.startsWith("/loading") ? loading : loaded)
  })
}

type Control =
  | { type: "attached"; connectionID: string; version: 4 }
  | { type: "command"; connectionID: string; requestID: string }

type Frame =
  | { type: "server.connected"; data: {} }
  | { type: "rpc.experimental.browser.control"; created: number; location: { directory: string }; data: Control }

type Outcome = { type: "success" } | { type: "failure"; code: string; message: string }

const frame = (event: Frame) => `data: ${JSON.stringify({ id: `evt_${Date.now()}`, ...event })}\n\n`

// The body of the 400 a server answers a call with while no plugin of the Location has registered the RPC.
const unavailable = JSON.stringify(Schema.encodeSync(RpcError)(new RpcError({ type: "rpc.unavailable", message: "RPC is unavailable: experimental.browser" })))

// The session's server, as far as a pane's attachment asks: the session, the event stream, the plugin list and the
// browser RPC. It answers `attach` with the `attached` handshake on the stream and then holds the call open, and it
// hands the pane the agent's commands as the server does: a control event names a request, the pane fetches it and
// posts its result. It has only just started the session's project, as after the app updates or the project sat
// idle: until its third answer to the plugin list it lists no plugin and has no browser RPC to call.
function createApi(directory: string) {
  const streams = new Set<ServerResponse>()
  const commands = new Map<string, Browser.Action>()
  const results = new Map<string, (outcome: Outcome) => void>()
  const attached = { connectionID: "" }
  // How often it refused `attach` for having no browser RPC yet, and how often it answered the plugin list.
  const startup = { refused: 0, listed: 0 }
  const loading = () => startup.listed < 3

  const session = {
    id: "ses_fixture",
    projectID: "prj_fixture",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory },
  }

  const control = (data: Control) =>
    streams.forEach((stream) =>
      stream.write(frame({ type: "rpc.experimental.browser.control", created: 0, location: session.location, data })),
    )

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

    if (path === "/api/plugin") {
      startup.listed += 1
      response.writeHead(200, { "content-type": "application/json" })
      const data = loading() ? [] : [{ id: "opencode.browser", source: { type: "builtin" }, features: { server: true }, state: { status: "active" } }]

      return void response.end(JSON.stringify({ location: session.location, data }))
    }

    if (!path.startsWith("/api/rpc/experimental.browser/")) return void response.writeHead(404).end()
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      const input: { connectionID: string; requestID?: string; outcome?: Outcome } = JSON.parse(Buffer.concat(chunks).toString()).input

      if (path.endsWith("/attach")) {
        if (loading()) {
          startup.refused += 1
          response.writeHead(400, { "content-type": "application/json" })

          return void response.end(unavailable)
        }

        attached.connectionID = input.connectionID

        return control({ type: "attached", connectionID: input.connectionID, version: 4 })
      }

      response.writeHead(200, { "content-type": "application/json" })

      if (path.endsWith("/command")) return void response.end(JSON.stringify({ output: { action: commands.get(input.requestID ?? ""), files: [] } }))

      if (path.endsWith("/result") && input.outcome) results.get(input.requestID ?? "")?.(input.outcome)
      response.end("{}")
    })
  })

  return {
    server,
    startup,
    /** Runs a command of the agent's on the attached pane, and resolves with what the pane answered. */
    agent(action: Browser.Action) {
      const requestID = `request-${commands.size}`
      const answered = Promise.withResolvers<Outcome>()
      commands.set(requestID, action)
      results.set(requestID, answered.resolve)
      control({ type: "command", connectionID: attached.connectionID, requestID })

      return answered.promise
    },
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
  const { createPreviews } = await import("./profile/previews")
  const { RefsStore } = await import("./refs")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")
  const pages = createPages()
  // Dedicated loopback origin for the uncommitted /hung stall so it never shares Chromium's per-origin socket pool with /loading tabs.
  const hungPages = createServer((_request, _response) => undefined)
  // The session's workspace, which holds `report.html`: a page that shows and takes over a second to finish loading.
  const api = createApi(process.env.ELECTRON_OPEN_ROOT ?? "")
  const origin = await listen(pages)
  const hungOrigin = await listen(hungPages)
  const server = await listen(api.server)
  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const values = new Map<string, unknown>()
  const lifetime = new AbortController()
  const verifier = createHandlePath()
  const profileSession = electron.session.fromPartition("open-fixture")

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
    session: profileSession,
    previews: createPreviews(profileSession, lifetime.signal, verifier),
    extensionIDs: () => [],
    extensionMenu: () => [],
    extensionTabs: { register: () => () => undefined, activated: () => undefined, hidden: () => undefined },
    downloads: new Map(),
    permissions: new Map(),
  } as unknown as Profile

  // Every inventory the pane reported to the window, in order.
  const reported: Browser.Tab[][] = []
  // What the pane asked the window to show of the agent's tabs: each tab, and whether it takes the pane.
  const shown: { tabID: string; reveal: string }[] = []
  // What the pane wrote to the desktop log.
  const logged: string[] = []

  const pane = createBrowserPane({
    toolbar: false,
    navigationDeadlineMs: 300,
    windows: { get: (id) => (id === win.id ? win : undefined), list: () => [win], focused: () => win, on: () => () => undefined },
    t: (key) => key,
    serverEndpoints: { get: () => ({ id: "sidecar", url: server, headers: {}, sameMachine: true }) },
    storage,
    refs: storage.store("refs", RefsStore),
    embeds,
    profile,
    sites: createSitePermissions(storage, () => undefined),
    system: createSystemMedia(),
    verifier,
    log: { write: (_level, message) => void logged.push(message) },
    emit: (_window, value: { readonly event: PaneEvent }) => {
      const event = value.event

      if (event.type === "state" && event.state) reported.push([...event.state.tabs])

      if (event.type === "activity") shown.push({ tabID: event.tabID, reveal: event.reveal })
    },
  })

  await pane.register(win.id, "binding", { server: "sidecar", session: "ses_fixture" })
  // What the first attachment asked of the server, before the registration at the end asks again.
  const startup = { ...api.startup }
  const last = () => reported.at(-1) ?? []
  const view = (tab: Browser.Tab) => ({ url: tab.url, loading: tab.loading, failed: tab.loadError !== undefined })
  const tab = (address: string) => last().find((item) => item.url.endsWith(address))
  const settle = <A>(work: Promise<A>) => work.then((value) => ({ value }), (error: Error) => ({ error: error.message }))

  // Until `check` holds, for at most `ms`: a report that never comes fails the test's comparison, not the fixture.
  const until = async (check: () => boolean, ms: number) => {
    const deadline = Date.now() + ms

    while (!check() && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }

  // The person: a link in the conversation.
  const open = (url: string) => settle(pane.command(win.id, "binding", { type: "tabs.open", url })).then((outcome) => ("error" in outcome ? outcome.error : "settled"))
  const first = await open(`${origin}/first`)
  const second = await open(`${origin}/second`)
  // The person's two tabs have loaded, however long the first pages of a new process took.
  await until(() => last().length === 2 && last().every((item) => item.url.startsWith(origin) && !item.loading), 10_000)
  const before = last().map((item) => item.url)
  // What the window has heard so far, which it registers again with at the end.
  const heard = last()
  // The still-loading page's command settles when the deadline passes; the page goes on loading.
  const [still, failed] = await Promise.all([open(`${origin}/loading`), open(`${origin}/dropped`)])
  // Every report that follows the commands: the page that shows, and the one that says why it could not load.
  await until(() => last().length === 4 && !!tab("/loading") && !!tab("/dropped")?.loadError, 3_000)
  const person = { commands: { first, second, still, failed }, before, after: last().map(view) }

  // A plugin: the handle it gets is its only way to close the tab again.
  const handed = async (address: string, stands: (item: Browser.Tab) => boolean) => {
    const opened = await settle(pane.createTab(win.id, "binding", "plugin", `${origin}${address}`))
    // Its tab says how the load stands: still under way, or failed.
    await until(() => "error" in opened || last().some((item) => item.url.endsWith(address) && stands(item)), 3_000)
    const listed = tab(address)
    const closed = "value" in opened ? await pane.closeTab(win.id, "binding", "plugin", opened.value) : undefined
    await until(() => !tab(address), 3_000)

    return { opened: "value" in opened ? "handle" : opened.error, listed: listed && view(listed), closed, left: !!tab(address) }
  }

  const plugin = {
    loading: await handed("/loading?plugin", (item) => item.loading),
    dropped: await handed("/dropped?plugin", (item) => item.loadError !== undefined),
    nothing: await handed("/nothing", () => true),
  }

  // The agent: its command, what the pane answered, and what the pane asked the window to show meanwhile.
  const asked = async (action: Browser.Action, address: string, commits = true) => {
    const from = shown.length
    const beforeIDs = new Set(last().map((item) => item.id))
    const outcome = await api.agent(action)
    // A committed page reaches its address; an uncommitted stall stays on its initial tab.
    await until(
      () =>
        commits
          ? !!tab(address) && (action.type === "preview" || !!tab(address)?.loading)
          : last().some((item) => !beforeIDs.has(item.id)),
      3_000,
    )
    const listed = commits ? tab(address) : last().find((item) => !beforeIDs.has(item.id))

    return {
      answer: outcome.type === "failure" ? outcome.message : outcome.type,
      tabID: listed?.id,
      listed: listed && view(listed),
      shown: shown.slice(from).flatMap((item) => (item.tabID === listed?.id ? [item.reveal] : [])),
    }
  }

  const agent = {
    front: await asked({ type: "tabs.open", url: `${origin}/loading?agent` }, "/loading?agent"),
    behind: await asked({ type: "tabs.open", url: `${origin}/loading?behind`, focus: false }, "/loading?behind"),
    preview: await asked({ type: "preview", path: "report.html" }, "/report.html"),
    hung: await asked({ type: "tabs.open", url: `${hungOrigin}/hung?agent` }, "/hung?agent", false),
  }

  // The window registers again with the inventory it last took in, as when its session moves or its server signs in
  // again, while the reports of the tabs opened since are still on their way to it.
  const held = last().map((item) => item.url)
  await pane.register(win.id, "binding-again", { server: "sidecar", session: "ses_fixture", restore: { tabs: heard, focusedTabID: heard[0]?.id ?? null } })
  const registered = { held, again: last().map((item) => item.url) }

  process.stdout.write(
    `${JSON.stringify({
      origin,
      startup,
      person,
      registered,
      // The still-loading page committed and showed: an inventory listed its tab at its address.
      committed: reported.some((tabs) => tabs.some((item) => item.url === `${origin}/loading`)),
      plugin,
      agent,
      logged,
    })}\n`,
  )
  await pane.dispose()
  lifetime.abort()
  api.close()
  hungPages.closeAllConnections()
  hungPages.close()
  pages.closeAllConnections()
  pages.close()
  electron.app.quit()
})
