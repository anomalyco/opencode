import { createServer } from "node:http"
import electron from "electron"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"
import type { Browser as BrowserRpc } from "@opencode/plugin-browser/rpc"
import type { PageEnd } from "./page-log"
import type { TabActivity } from "./policy"
import type { Profile } from "./profile"

// The Electron main process of `electron-crash.test.ts`, bundled and run by the pinned Electron. It opens pane pages
// on a private-looking address, ends their renderers for real (a DevTools `Page.crash`, then a kill), fails one load, and
// ends a child process of the browser. It prints every line the product wrote to the desktop log, with what Electron
// itself reported, as one JSON line.

// What a bug report must never carry: the path, the query, the fragment, the title and the page's text.
const path = "/mail/inbox/alex?token=s3cret-token#message-42"

const inbox = `<!doctype html><title>Payroll for Alex</title><p>Your one-time code is 493817</p>`

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" })
  response.end(inbox)
})

type Line = { level: string; message: string; data: object }

void electron.app.whenReady().then(async () => {
  const { Browser } = await import("@opencode/plugin-browser/rpc")
  const { createBrowserPage } = await import("./chromium")
  const { createBrowserPane } = await import("./pane")
  const { createHandlePath } = await import("./disk")
  const { browserFailure, PageEndedError } = await import("./errors")
  const { RefsStore } = await import("./refs")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const verifier = createHandlePath()
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

  const signal = new AbortController().signal
  const refs = { next: 0 }
  const sites = createSitePermissions(storage, () => undefined)
  const system = createSystemMedia()
  const lines: Line[] = []
  const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  // Until `check` holds, for at most `ms`: a line that never comes fails the test's comparison, not the fixture.
  const until = async (check: () => boolean, ms: number) => {
    const deadline = Date.now() + ms

    while (!check() && Date.now() < deadline) await settle(25)
  }

  // One tab's page as the pane makes it, with the product's log and what the page told the pane when it stopped.
  const open = async (id: BrowserRpc.TabID, url: string) => {
    const activity: TabActivity = { agentRuns: 0 }
    const ends: PageEnd[] = []
    // What Electron reported by itself, in order; the product's listeners were added first.
    const signals: string[] = []

    const page = createBrowserPage(win, {
      id,
      toolbar: false,
      partition: "crash-fixture",
      network: null,
      publish: () => undefined,
      refused: () => undefined,
      fail: (end) => {
        ends.push(end)
        void page.dispose()
      },
      log: (level, message, data) => lines.push({ level, message, data }),
      popup: () => {
        throw new Error("The fixture page opens no window.")
      },
      activity,
      userInput: () => undefined,
      local: true,
      signal,
      shared: { ref: () => `e${++refs.next}` },
      menu: { t: (key) => key, extensions: () => [], navigate: async () => undefined, open: async () => undefined, verifier },
      embeds,
      sites,
      system,
    })

    page.contents.on("render-process-gone", (_event, details) => signals.push(`render-process-gone ${details.reason} ${details.exitCode}`))
    page.contents.debugger.on("detach", (_event, reason) => signals.push(`detach ${reason}`))
    page.contents.debugger.on("message", (_event, method) => {
      if (method === "Inspector.targetCrashed") signals.push(method)
    })
    await page.ready
    // The agent's navigation: the tab is agent-driven from here on. A load that fails rejects, which the log covers.
    await page.execute({ action: { type: "navigate", tabID: id, url }, files: [] }, signal, "agent").catch(() => undefined)

    return { page, ends, signals }
  }

  // What an agent's command running on the tab hears, built as the pane builds it from the page's own report.
  const failure = (id: BrowserRpc.TabID, end: PageEnd | undefined) =>
    end ? browserFailure({ type: "snapshot", tabID: id }, new PageEndedError(end)).message : undefined

  // A renderer crash via DevTools `Page.crash`, after the pane noted the page's memory as its timer does.
  // Unlike `forcefullyCrashRenderer()`, which may report `killed` on macOS ARM64, `Page.crash` reliably crashes the renderer.
  const crashedID = Browser.TabID.make("tab_11111111-1111-1111-1111-111111111111")
  const crashed = await open(crashedID, origin + path)
  crashed.page.sampleMemory(electron.app.getAppMetrics())
  await crashed.page.execute({ action: { type: "snapshot", tabID: crashedID }, files: [] }, signal, "agent")

  if (!crashed.page.contents.debugger.isAttached()) crashed.page.contents.debugger.attach("1.3")
  void crashed.page.contents.debugger.sendCommand("Page.crash").catch(() => undefined)
  await until(() => crashed.ends.length > 0, 10_000)
  // Every later signal of the same crash has arrived by now.
  await settle(500)

  // A kill from outside, as the system's out-of-memory killer or a task manager does it.
  const killedID = Browser.TabID.make("tab_22222222-2222-2222-2222-222222222222")
  const killed = await open(killedID, origin + path)
  process.kill(killed.page.contents.getOSProcessId(), "SIGKILL")
  await until(() => killed.ends.length > 0, 10_000)
  await settle(500)

  // A main-frame load that fails: nothing listens on the port.
  const closed = createServer()
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve))
  const closedAddress = closed.address()
  const refused = `http://127.0.0.1:${closedAddress instanceof Object ? closedAddress.port : 0}`
  await new Promise<void>((resolve) => closed.close(() => resolve()))
  const failedID = Browser.TabID.make("tab_33333333-3333-3333-3333-333333333333")
  const failed = await open(failedID, refused + path)
  await until(() => lines.some((line) => line.message === "browser page load failed"), 10_000)
  await settle(500)
  await failed.page.dispose()

  // A child process of the browser that ends: the pane logs it, with no page of its own open here.
  // SAFETY: a pane with no binding reads only the profile's partition, previews, downloads and permissions.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const profile = {
    partition: "crash-fixture",
    previews: { failure: () => undefined },
    extensionIDs: () => [],
    downloads: new Map(),
    permissions: new Map(),
  } as unknown as Profile

  const pane = createBrowserPane({
    toolbar: false,
    windows: { get: (id) => (id === win.id ? win : undefined), list: () => [win], focused: () => win, on: () => () => undefined },
    t: (key) => key,
    serverEndpoints: { get: () => undefined },
    storage,
    refs: storage.store("refs", RefsStore),
    embeds,
    profile,
    sites,
    system,
    verifier,
    log: { write: (level, message, data) => lines.push({ level, message, data: data ?? {} }) },
    emit: () => undefined,
  })

  // The GPU process, which takes every page's picture with it. CI's Linux runs with the GPU disabled, where Chromium
  // may not outlive its last compositor: a utility process, such as the network service, ends there instead.
  const processes = electron.app.getAppMetrics()
  const gpu = process.platform === "linux" ? undefined : processes.find((metric) => metric.type === "GPU")
  const child = gpu ?? processes.find((metric) => metric.type === "Utility")
  const gone: string[] = []
  electron.app.on("child-process-gone", (_event, details) => gone.push(`${details.type} ${details.reason} ${details.exitCode}`))

  if (child) process.kill(child.pid, "SIGKILL")
  await until(() => lines.some((line) => line.message === "browser child process gone"), 10_000)
  await pane.dispose()

  process.stdout.write(
    `${JSON.stringify({
      origin,
      refused,
      lines,
      crashed: { signals: crashed.signals, ends: crashed.ends, failure: failure(crashedID, crashed.ends[0]) },
      killed: { signals: killed.signals, ends: killed.ends, failure: failure(killedID, killed.ends[0]) },
      child: child?.type ?? "",
      gone,
      platform: process.platform,
    })}\n`,
  )
  server.closeAllConnections()
  server.close()
  electron.app.quit()
})
