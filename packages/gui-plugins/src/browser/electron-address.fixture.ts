import { createServer } from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"
import electron from "electron"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"

// The Electron main process of `electron-address.test.ts`, bundled and run by the pinned Electron. It opens one pane
// page with a workspace, as the pane does for the built-in local server, and submits addresses to it as the address
// bar does: a file inside the workspace, one outside, a web page, and a web page while the extension startup gate
// holds navigations, followed by Stop. It prints what the tab showed after each as one JSON line.

const requests: string[] = []

const server = createServer((request, response) => {
  requests.push(request.url ?? "")
  response.writeHead(200, { "content-type": "text/html" })
  response.end("<!doctype html><title>Web</title><p>web</p>")
})

void electron.app.whenReady().then(async () => {
  const { Browser } = await import("@opencode/plugin-browser/rpc")
  const { createBrowserPage } = await import("./chromium")
  const { createHandlePath } = await import("./disk")
  const { refusal } = await import("./policy")
  const { createPreviews } = await import("./profile/previews")
  const { guardSession } = await import("./session-guard")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")
  const { workspacePages } = await import("./workspace-pages")
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
  const root = process.env.ELECTRON_ADDRESS_ROOT ?? ""
  const outside = pathToFileURL(process.env.ELECTRON_ADDRESS_OUTSIDE ?? "").href
  const inside = pathToFileURL(path.join(root, "inside.html")).href
  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const values = new Map<string, unknown>()

  // SAFETY: the site permissions read only `store` and its `value` and `set`.
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
  const signal = new AbortController().signal
  const refs = { next: 0 }
  const partition = "address-fixture"
  const session = electron.session.fromPartition(partition)
  const verifier = createHandlePath()
  const previews = createPreviews(session, signal, verifier)
  guardSession(session, new Map())
  // The extension startup gate, closed on demand: it holds web navigations until its extensions answer.
  const gate = { held: false }

  const page = createBrowserPage(win, {
    id: tabID,
    toolbar: false,
    partition,
    network: null,
    publish: () => undefined,
    refused: () => undefined,
    fail: () => undefined,
    popup: () => {
      throw new Error("The fixture page opens no window.")
    },
    activity: { agentRuns: 0 },
    userInput: () => undefined,
    local: true,
    signal,
    fileRoots: () => [root],
    workspace: workspacePages(previews, verifier, root, { type: "local", roots: () => [root] }, signal),
    previewFailure: previews.failure,
    waitForFilters: (url, stop) =>
      gate.held && /^https?:/.test(url)
        ? new Promise<void>((_resolve, reject) => stop.addEventListener("abort", () => reject(stop.reason), { once: true }))
        : undefined,
    shared: { ref: () => `e${++refs.next}` },
    menu: { t: (key) => key, extensions: () => [], navigate: async () => undefined, open: async () => undefined, verifier },
    embeds,
    sites: createSitePermissions(storage, () => undefined),
    system: createSystemMedia(),
  })

  await page.ready

  const command = (action: { type: "navigate"; url: string } | { type: "stop" }) =>
    page.execute({ action: { ...action, tabID }, files: [] }, signal, "user").then(
      () => "done",
      (error: Error) => error.message,
    )

  // What the address bar and the strip show, and whether the document on screen is a scoped preview.
  const shown = () => {
    const tab = page.state()

    return { url: tab.url, title: tab.title, error: tab.loadError, preview: page.contents.getURL().startsWith("oc-preview://") }
  }

  const typed = async (url: string) => ({ outcome: await command({ type: "navigate", url }), ...shown() })
  const file = await typed(inside)
  // The window explains this code as its refusal notice before the address reaches the page (`command` in pane.ts).
  const notice = refusal(outside, { fileRoots: [root] })
  const refused = await typed(outside)
  const web = await typed(`${origin}/web`)
  await typed(inside)
  gate.held = true
  const before = requests.length
  const held = command({ type: "navigate", url: `${origin}/held` })

  const spinning = (): Promise<void> =>
    page.state().loading ? Promise.resolve() : new Promise<void>((resolve) => setImmediate(resolve)).then(spinning)

  await spinning()
  const stopped = { outcome: await command({ type: "stop" }), held: await held, ...shown(), requests: requests.length - before }
  process.stdout.write(`${JSON.stringify({ inside, origin, file, notice, refused, web, stopped })}\n`)
  await page.dispose()
  server.close()
  electron.app.quit()
})
