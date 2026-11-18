import { createServer } from "node:http"
import electron from "electron"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"
import type { TabActivity } from "./policy"
import type { Profile } from "./profile"

// The Electron main process of `electron-page.test.ts`, bundled and run by the pinned Electron. It opens one pane page
// as the pane does, loads a page that navigates by itself while it boots, right-clicks it as the agent and as the
// person, then registers a pane binding for one window and calls it as another. It prints what happened as one JSON
// line.

const frame = `<!doctype html><title>frame</title><p>frame</p>`

// Everything a real site does while it boots: History API writes, a client redirect and a frame load.
const boot = `<!doctype html><title>boot</title><iframe src="/frame"></iframe><script>
history.replaceState({}, "", "/boot?replaced")
history.pushState({}, "", "/boot?pushed")
addEventListener("load", () => location.replace("/landed"))
</script>`

const landed = `<!doctype html><title>landed</title><iframe src="/frame" hidden></iframe>
<button style="position:fixed;inset:0;width:100%;height:100%">Target</button>
<script>history.replaceState({}, "", "/landed?ready")</script>`

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" })
  response.end(request.url?.startsWith("/boot") ? boot : request.url?.startsWith("/landed") ? landed : frame)
})

const counts = { popups: 0, menus: 0, inputs: 0 }

// The product's guard decides whether a menu opens; this only keeps a native menu off the screen and counts it.
electron.Menu.prototype.popup = () => {
  counts.popups++
}

void electron.app.whenReady().then(async () => {
  const { Schema } = await import("effect")
  const { Browser } = await import("@opencode/plugin-browser/rpc")
  const { createBrowserPage } = await import("./chromium")
  const { createBrowserPane } = await import("./pane")
  const { RefsStore } = await import("./refs")
  const { activityOwner } = await import("./policy")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
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

  // The window host owns bounds and occlusion; here the view fills the window and shows when the page says so.
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

  const tabID = Browser.TabID.make("tab_11111111-1111-1111-1111-111111111111")
  const activity: TabActivity = { agentRuns: 0 }
  const signal = new AbortController().signal
  const refs = { next: 0 }
  const sites = createSitePermissions(storage, () => undefined)
  const system = createSystemMedia()

  const page = createBrowserPage(win, {
    id: tabID,
    toolbar: false,
    partition: "page-fixture",
    network: null,
    publish: () => undefined,
    refused: () => undefined,
    fail: () => undefined,
    popup: () => {
      throw new Error("The fixture page opens no window.")
    },
    activity,
    userInput: () => {
      counts.inputs++
    },
    local: true,
    signal,
    shared: { ref: () => `e${++refs.next}` },
    menu: { t: (key) => key, extensions: () => [], navigate: async () => undefined, open: async () => undefined },
    embeds,
    sites,
    system,
  })

  page.contents.on("context-menu", () => {
    counts.menus++
  })
  await page.ready
  // A plugin's tab opens with the person's authority, as `createTab` does. The redirect may abort this first load.
  await page
    .execute({ action: { type: "navigate", tabID, url: `${origin}/boot` }, files: [] }, signal, "user")
    .catch(() => undefined)
  await new Promise<void>((resolve) => {
    const settled = () => {
      if (page.contents.getURL() !== `${origin}/landed?ready` || page.contents.isLoading()) return
      page.contents.off("did-stop-loading", settled)
      page.contents.off("did-navigate-in-page", settled)
      resolve()
    }

    page.contents.on("did-stop-loading", settled)
    page.contents.on("did-navigate-in-page", settled)
    settled()
  })
  const report = () => ({ ...counts, owner: activityOwner(activity) })
  const booted = report()

  // The page's report of a right-click, which arrives after the click's own events. The product's listener was added
  // first, so it has decided by then. Bounded, so a platform that raises no report fails the test's comparison.
  const menu = () =>
    Promise.race([
      new Promise<void>((resolve) => page.contents.once("context-menu", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ])

  const rightClick = async () => {
    const snapshot = await page.execute({ action: { type: "snapshot", tabID }, files: [], agent: "build" }, signal, "agent")
    const content = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(snapshot.value).content
    const ref = /@(e\d+) \[button\] "Target"/.exec(content)?.[1]

    if (!ref) throw new Error(`The snapshot names no Target button:\n${content}`)
    const reported = menu()
    await page.execute(
      { action: { type: "click", tabID, ref: Browser.Ref.make(ref), button: "right" }, files: [], agent: "build" },
      signal,
      "agent",
    )
    await reported

    return report()
  }

  const personClick = async () => {
    const reported = menu()
    page.contents.sendInputEvent({ type: "mouseDown", x: 100, y: 100, button: "right", clickCount: 1 })
    page.contents.sendInputEvent({ type: "mouseUp", x: 100, y: 100, button: "right", clickCount: 1 })
    await reported

    return report()
  }

  const agent = await rightClick()
  const person = await personClick()
  const after = await rightClick()
  // The agent's `wait` sends the page nothing. The person takes the tab back first, so the wait starting shows as the
  // tab becoming the agent's again; their right-click while it is still held is then their own.
  await personClick()
  const waited = { done: false }

  const wait = page
    .execute({ action: { type: "wait", tabID, condition: "delay", timeoutMs: 3_000 }, files: [], agent: "build" }, signal, "agent")
    .finally(() => {
      waited.done = true
    })

  const started = (): Promise<void> =>
    activityOwner(activity) === "agent" || waited.done ? Promise.resolve() : new Promise<void>((resolve) => setImmediate(resolve)).then(started)

  await started()
  const waiting = { ...(await personClick()), during: !waited.done }
  await wait
  await page.dispose()

  // The session's server never answers, so the binding stays registered to its window with no tab and no network.
  const held = createServer(() => undefined)
  await new Promise<void>((resolve) => held.listen(0, "127.0.0.1", resolve))
  const heldAddress = held.address()

  // SAFETY: a binding of the app's own server that never attaches reads only the profile's partition, previews,
  // downloads and extension IDs.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const profile = {
    partition: "page-fixture",
    previews: { failure: () => undefined },
    extensionIDs: () => [],
    downloads: new Map(),
    permissions: new Map(),
  } as unknown as Profile

  const pane = createBrowserPane({
    toolbar: false,
    windows: { get: (id) => (id === win.id ? win : undefined), list: () => [win], focused: () => win, on: () => () => undefined },
    t: (key) => key,
    serverEndpoints: {
      get: () => ({ id: "fixture", url: `http://127.0.0.1:${heldAddress instanceof Object ? heldAddress.port : 0}`, headers: {}, sameMachine: true }),
    },
    storage,
    refs: storage.store("refs", RefsStore),
    embeds,
    profile,
    sites,
    system,
    emit: () => undefined,
  })

  void pane.register(win.id, "binding", { server: "fixture", session: "ses_fixture" }).catch(() => undefined)

  const outcome = (call: () => Promise<string | boolean | void> | void) =>
    Promise.resolve()
      .then(call)
      .then(
        (value) => `returned ${JSON.stringify(value)}`,
        (error: Error) => error.message,
      )

  const calls = (window: number) =>
    Promise.all([
      outcome(() => pane.createTab(window, "binding", "plugin", "https://example.com/")),
      outcome(() => pane.closeTab(window, "binding", "plugin", "handle")),
      outcome(() => pane.command(window, "binding", { type: "tabs.open" })),
      outcome(() => pane.openPage(window, "binding", tabID, "https://example.com/")),
      outcome(() => pane.load(window, "binding", tabID)),
    ])

  const windows = { owner: await calls(win.id), other: await calls(win.id + 1) }
  process.stdout.write(`${JSON.stringify({ booted, agent, person, after, waiting, windows })}\n`)
  await pane.dispose()
  held.closeAllConnections()
  held.close()
  server.close()
  electron.app.quit()
})
