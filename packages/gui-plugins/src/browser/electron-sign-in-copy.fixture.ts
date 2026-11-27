import { createServer, type ServerResponse } from "node:http"
import { connect, type Socket } from "node:net"
import electron, { type Session } from "electron"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"
import type { Browser } from "@opencode/plugin-browser/rpc"
import type { PaneEvent } from "./ipc"
import type { Profile } from "./profile"
import type { MirroredSession } from "./profile/link"

// The Electron main process of `electron-sign-in-copy.test.ts`, bundled and run by the pinned Electron. It attaches
// the real pane to a stand-in for a remote server while the user shares sign-ins with remote servers, with the real
// links between the profile and the server's partition (`createSignInLinks`). The profile's cookie store is the real
// one, except that a read of its whole list waits until the fixture lets it go: a copy that takes as long as the
// fixture wants. It prints what was attached, loaded, copied and logged, in order, as one JSON line.

type Control = { type: "attached"; connectionID: string; version: 4 }

type Frame =
  | { type: "server.connected"; data: {} }
  | { type: "rpc.experimental.browser.control"; created: number; location: { directory: string }; data: Control }

type Call = { connectionID: string; tunnelID?: string; target?: { host: string; port: number }; data?: string; end?: boolean }

/** What a tunnel call answers with: the new tunnel's id, a chunk it read, or nothing. */
type Answer = string | { data: string; eof: boolean } | undefined

/** While `list` is set, a read of the profile's whole cookie list waits for it. */
type Hold = { list?: Promise<void> }

/** One connection the server makes for a page, and what it has received and not yet handed over. */
type Tunnel = { socket: Socket; chunks: Buffer[]; ended: boolean; wake: () => void }

const frame = (event: Frame) => `data: ${JSON.stringify({ id: `evt_${Date.now()}`, ...event })}\n\n`

// The remote server, as far as a pane's attachment asks: the session, the event stream, and the browser RPC. It
// answers `attach` with the `attached` handshake on the stream and then holds the call open, and it carries the
// pages' traffic, as the server's tunnels do: a connection per `tunnel.open`, read and written in chunks.
function createApi(directory: string, events: string[]) {
  const streams = new Set<ServerResponse>()
  const tunnels = new Map<string, Tunnel>()

  const session = {
    id: "ses_fixture",
    projectID: "prj_fixture",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory },
  }

  const open = (target: { host: string; port: number }) =>
    new Promise<string>((resolve, reject) => {
      const id = `tunnel-${tunnels.size}`
      const tunnel: Tunnel = { socket: connect(target.port, target.host), chunks: [], ended: false, wake: () => undefined }

      const end = () => {
        tunnel.ended = true
        tunnel.wake()
      }

      tunnel.socket.on("data", (chunk: Buffer) => {
        tunnel.chunks.push(chunk)
        tunnel.wake()
      })
      tunnel.socket.on("end", end)
      tunnel.socket.on("close", end)
      tunnel.socket.on("error", reject)
      tunnel.socket.on("connect", () => {
        tunnels.set(id, tunnel)
        resolve(id)
      })
    })

  const read = async (tunnel: Tunnel) => {
    if (!tunnel.chunks.length && !tunnel.ended) await new Promise<void>((resolve) => (tunnel.wake = resolve))
    const chunk = tunnel.chunks.shift() ?? Buffer.alloc(0)

    // A chunk the wire cannot carry at once goes back for the next read.
    if (chunk.length > 32 * 1024) tunnel.chunks.unshift(chunk.subarray(32 * 1024))

    return { data: chunk.subarray(0, 32 * 1024).toString("base64"), eof: tunnel.ended && !tunnel.chunks.length }
  }

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
    request.on("end", async () => {
      const input: Call = JSON.parse(Buffer.concat(chunks).toString()).input
      const method = path.slice("/api/rpc/experimental.browser/".length)

      if (method === "attach") {
        events.push("attach")

        return streams.forEach((stream) =>
          stream.write(
            frame({
              type: "rpc.experimental.browser.control",
              created: 0,
              location: session.location,
              data: { type: "attached", connectionID: input.connectionID, version: 4 },
            }),
          ),
        )
      }

      const tunnel = tunnels.get(input.tunnelID ?? "")
      const answer = (output?: Answer) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ output }))

      if (method === "tunnel.open" && input.target) return answer(await open(input.target).catch(() => undefined))

      if (method === "tunnel.read" && tunnel) return answer(await read(tunnel))

      if (method === "tunnel.write" && tunnel) {
        tunnel.socket.write(Buffer.from(input.data ?? "", "base64"))

        if (input.end) tunnel.socket.end()
      }

      if (method === "tunnel.close") tunnel?.socket.destroy()
      answer()
    })
  })

  return {
    server,
    close() {
      tunnels.forEach((tunnel) => tunnel.socket.destroy())
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
  const { createSignInLinks } = await import("./profile/link")
  const { RefsStore } = await import("./refs")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")
  // What happened, in order: attachments, page requests with the sign-in they carried, the copies' log lines, and
  // the fixture's own marks.
  const events: string[] = []

  // The site the restored tab shows. Its page says whether the request came signed in.
  const pages = createServer((request, response) => {
    if (request.url === "/favicon.ico") return void response.writeHead(404).end()
    const signedIn = /(^|; )sid=profile-sign-in(;|$)/.test(request.headers.cookie ?? "")
    events.push(`page ${request.url} ${signedIn ? "signed in" : "signed out"}`)
    response.writeHead(200, { "content-type": "text/html" })
    response.end(`<!doctype html><title>${signedIn ? "Signed in" : "Signed out"}</title><p>account</p>`)
  })

  const api = createApi(process.env.ELECTRON_SIGN_IN_COPY_ROOT ?? "", events)
  const origin = await listen(pages)
  const server = await listen(api.server)
  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const values = new Map<string, unknown>()
  const lifetime = new AbortController()
  const verifier = createHandlePath()
  const profileSession = electron.session.fromPartition("sign-in-copy-fixture")
  const later = Math.floor(Date.now() / 1000) + 86_400

  // The profile is signed in to the site, and to 300 made-up others.
  await profileSession.cookies.set({ url: `${origin}/`, name: "sid", value: "profile-sign-in", expirationDate: later })
  await Promise.all(
    Array.from({ length: 300 }, (_, site) =>
      profileSession.cookies.set({ url: `https://site-${site}.example/`, domain: `.site-${site}.example`, name: "sid", value: `made-up-${site}`, secure: true, expirationDate: later }),
    ),
  )

  // Each read of the profile's whole list waits for the hold of its time, if any.
  const hold: Hold = {}

  const profileStore: MirroredSession = {
    cookies: {
      get: async (filter) => {
        if (!filter.url && !filter.domain && !filter.name) await hold.list

        return profileSession.cookies.get(filter)
      },
      set: (details) => profileSession.cookies.set(details),
      remove: (url, name) => profileSession.cookies.remove(url, name),
      on: (event, listener) => void profileSession.cookies.on(event, listener),
      off: (event, listener) => void profileSession.cookies.off(event, listener),
    },
  }

  const partitions: Session[] = []

  const links = createSignInLinks<Session>({
    profile: profileStore,
    sharing: () => true,
    log: (_level, message, data) => void events.push(`log ${message}${"written" in data ? ` written=${data.written}` : ""}${"toRemote" in data ? ` toRemote=${data.toRemote}` : ""}`),
  })

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

  // SAFETY: a pane of a remote server with no extension reads only these members of the profile.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const profile = {
    partition: "sign-in-copy-fixture",
    session: profileSession,
    previews: createPreviews(profileSession, lifetime.signal, verifier),
    extensionIDs: () => [],
    extensionMenu: () => [],
    extensionTabs: { register: () => () => undefined, activated: () => undefined, hidden: () => undefined },
    downloads: new Map(),
    permissions: new Map(),
    // As the profile links a partition: the real links, which start the partition's mirror.
    link(other: Session) {
      other.setUserAgent(profileSession.getUserAgent())
      partitions.push(other)

      return links.link(other)
    },
  } as unknown as Profile

  // Every inventory the pane reported to the window, in order.
  const reported: Browser.Tab[][] = []

  const pane = createBrowserPane({
    toolbar: false,
    windows: { get: (id) => (id === win.id ? win : undefined), list: () => [win], focused: () => win, on: () => () => undefined },
    t: (key) => key,
    serverEndpoints: { get: () => ({ id: "remote", url: server, headers: {}, sameMachine: false }) },
    storage,
    refs: storage.store("refs", RefsStore),
    embeds,
    profile,
    sites: createSitePermissions(storage, () => undefined),
    system: createSystemMedia(),
    verifier,
    log: { write: () => undefined },
    emit: (_window, value: { readonly event: PaneEvent }) => {
      if (value.event.type === "state" && value.event.state) reported.push([...value.event.state.tabs])
    },
  })

  // Until `check` holds, for at most `ms`: what never comes fails the test's comparison, not the fixture.
  const until = async (check: () => boolean, ms: number) => {
    const deadline = Date.now() + ms

    while (!check() && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 20))

    return check()
  }

  const within = <A>(work: Promise<A>, ms: number) =>
    Promise.race([work.then(() => true, () => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))])

  // SAFETY: the pane takes a tab's id as the window sends it; this one has the id's form.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  const tabID = "tab_00000000-0000-4000-8000-000000000001" as Browser.TabID
  const tab: Browser.Tab = { id: tabID, url: `${origin}/account`, title: "Account", loading: false, canGoBack: false, canGoForward: false, generation: 0 }
  const restore = { tabs: [tab], focusedTabID: tabID }
  const copied = () => partitions.at(-1)?.cookies.get({}).then((cookies) => cookies.length)

  // 1. The window registers with a restored tab while the copy takes its time. The attachment does not wait for it.
  const slow = Promise.withResolvers<void>()
  hold.list = slow.promise
  const registered = await within(pane.register(win.id, "binding", { server: "remote", session: "ses_fixture", restore }), 10_000)
  events.push(`mark registered=${registered}`)
  // The window shows the restored tab, whose page waits for the copy alone.
  pane.load(win.id, "binding", tabID)
  await until(() => !!reported.at(-1)?.some((item) => item.id === tabID && item.loading), 3_000)
  events.push(`mark tab loading=${!!reported.at(-1)?.some((item) => item.id === tabID && item.loading)} copied=${await copied()}`)
  slow.resolve()
  const loaded = await until(() => events.some((line) => line.startsWith("page /account")), 20_000)
  await until(() => !!reported.at(-1)?.some((item) => item.id === tabID && !item.loading && item.title.startsWith("Signed")), 5_000)
  events.push(`mark page loaded=${loaded} title=${reported.at(-1)?.find((item) => item.id === tabID)?.title} copied=${await copied()}`)

  const logged = (line: string, from: number) => events.slice(from).some((item) => item.startsWith(`log browser sign-in copy ${line}`))

  // 2. The window registers again while a copy is under way, as it does when an attachment takes too long. The
  // registration it leaves behind ends, and its copy with it; the new one's copy is the only one that goes on.
  const abandoned = Promise.withResolvers<void>()
  hold.list = abandoned.promise
  await pane.register(win.id, "binding-abandoned", { server: "remote", session: "ses_fixture", restore })
  events.push("mark registered again")
  const kept = Promise.withResolvers<void>()
  hold.list = kept.promise
  await pane.register(win.id, "binding-kept", { server: "remote", session: "ses_fixture", restore })
  events.push("mark registered a third time")
  const second = events.length
  abandoned.resolve()
  await until(() => logged("cancelled", second), 5_000)
  events.push(`mark abandoned partition holds=${(await partitions.at(-2)?.cookies.get({}))?.length}`)
  kept.resolve()
  await until(() => logged("finished", second), 10_000)
  events.push(`mark kept partition holds=${await copied()}`)

  // 3. The app quits with a copy under way: the pane and the links are gone before the copy could end.
  const quitting = Promise.withResolvers<void>()
  hold.list = quitting.promise
  await pane.register(win.id, "binding-quit", { server: "remote", session: "ses_fixture", restore })
  events.push("mark registered before quitting")
  const third = events.length
  await pane.dispose()
  links.dispose()
  events.push("mark disposed")
  quitting.resolve()
  await until(() => logged("cancelled", third), 5_000)

  process.stdout.write(`${JSON.stringify({ events })}\n`)
  lifetime.abort()
  api.close()
  pages.closeAllConnections()
  pages.close()
  electron.app.quit()
})
