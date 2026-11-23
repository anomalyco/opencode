import { createServer } from "node:http"
import electron from "electron"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"
import type { Browser as BrowserRpc } from "@opencode/plugin-browser/rpc"
import type { TabActivity } from "./policy"

// The Electron main process of `electron-restore.test.ts`, bundled and run by the pinned Electron. It restores two
// tabs as the pane does when it first shows them (`load` in pane.ts): one whose saved title is known and one saved
// before titles were kept. Their page sends its <title> late, as a slow site does. It prints every tab state the pages
// published, in order, as one JSON line.

const head = `<!doctype html><html><head><meta charset="utf-8">`

const rest = `<title>Real title</title></head><body><p>page</p></body></html>`

// The title arrives after the document committed and started to parse.
const server = createServer((request, response) => {
  if (request.url === "/favicon.ico") return void response.writeHead(404).end()
  response.writeHead(200, { "content-type": "text/html" })
  response.write(head + " ".repeat(2048))
  setTimeout(() => response.end(rest), 400)
})

void electron.app.whenReady().then(async () => {
  const { Browser } = await import("@opencode/plugin-browser/rpc")
  const { createBrowserPage } = await import("./chromium")
  const { createHandlePath } = await import("./disk")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const verifier = createHandlePath()
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

  // Restores one tab as the pane's `load` does, and returns the states its page published until it stopped loading.
  const restore = async (id: BrowserRpc.TabID, path: string, title: string) => {
    const activity: TabActivity = { agentRuns: 0 }
    const states: { title: string; loading: boolean; url: string }[] = []
    const url = origin + path
    // The pane takes a page's reports only once it holds the page, which is after its construction.
    const held: ReturnType<typeof createBrowserPage>[] = []

    const page = createBrowserPage(win, {
      id,
      toolbar: false,
      partition: "restore-fixture",
      network: null,
      restore: { id, url, title, loading: false, canGoBack: false, canGoForward: false, generation: 1 },
      publish: () => {
        const tab = held[0]?.state()
        const last = states.at(-1)

        if (!tab) return

        if (last?.title !== tab.title || last.loading !== tab.loading || last.url !== tab.url)
          states.push({ title: tab.title, loading: tab.loading, url: tab.url })
      },
      refused: () => undefined,
      fail: () => undefined,
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

    held.push(page)
    await page.ready
    await new Promise<void>((resolve) => {
      const settled = () => {
        if (page.contents.isLoading() || page.contents.getTitle() !== "Real title") return
        page.contents.off("did-stop-loading", settled)
        page.contents.off("page-title-updated", settled)
        resolve()
      }

      page.contents.on("did-stop-loading", settled)
      page.contents.on("page-title-updated", settled)
      settled()
    })
    const last = page.state()
    await page.dispose()

    return { url, states, last: { title: last.title, loading: last.loading, url: last.url } }
  }

  const saved = await restore(Browser.TabID.make("tab_11111111-1111-1111-1111-111111111111"), "/saved", "Saved title")
  const untitled = await restore(Browser.TabID.make("tab_22222222-2222-2222-2222-222222222222"), "/untitled", "")
  process.stdout.write(`${JSON.stringify({ saved, untitled })}\n`)
  server.closeAllConnections()
  server.close()
  electron.app.quit()
})
