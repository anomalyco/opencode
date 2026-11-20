import { createServer, type ServerResponse } from "node:http"
import path from "node:path"
import electron from "electron"
import type { BuiltinMainStorage } from "@opencode/plugin/gui/builtin"
import type { Embeds } from "@opencode/plugin/gui/main"
import type { RefusalNotice } from "./ipc"
import type { TabActivity } from "./policy"

// The Electron main process of `electron-links.test.ts`, bundled and run by the pinned Electron. It opens one pane page
// on a made-up page of links and presses them as the person does, through Chromium's own input events: with the
// middle button, with Ctrl (Cmd on macOS) and Shift, plainly, and with Enter on the focused link. The agent then
// middle-clicks the same link, and two more pages ask for a tab with nobody's press. It prints the tabs and notices
// each press led to as one JSON line.
//
// One more page acts on its own 50 ms, 500 ms or 2 s after the person's press, with its renderer slowed: its frame from
// another site calls `window.open`, or it clicks a link of its own with Shift. Neither is the person's. Each gets a
// press of its own, since the first request after a press uses that press up.
//
// Some links lead to a download, to another app's link or to an address the pane refuses, as the first navigation of
// the tab they open. Every download here gets its save path in this process's own `will-download` listener, before the
// page's handler sees it, so none can open the system's save dialog.

// One row of 40px every 50px, so a press at (20, 50 * row + 20) lands on that row.
const links = `<!doctype html><title>Links</title>
<style>a,div{position:fixed;left:0;width:300px;height:40px;display:block}</style>
<a href="/target?plain" style="top:0">Plain link</a>
<a href="/target?blank" target="_blank" style="top:50px">Blank link</a>
<a href="mailto:someone@example.test" style="top:100px">Mail link</a>
<div style="top:150px">No link</div>
<a href="/target?opener" target="_blank" rel="opener" style="top:200px">Opener link</a>
<a href="/download" style="top:250px">Download link</a>
<a href="/download" target="_blank" style="top:300px">Blank download link</a>
<a href="/to-mail" style="top:350px">Mail redirect</a>
<a href="/to-refused" style="top:400px">Refused redirect</a>
<a href="/then-download" style="top:450px">Page then download</a>
<script>
window.presses = 0
window.moves = 0
for (const type of ["click", "auxclick"]) addEventListener(type, () => window.presses++, true)
addEventListener("pointermove", () => window.moves++, true)
</script>`

// A Shift+click the page makes up by itself asks for a new window, as the person's would.
const synthetic = `<!doctype html><title>Synthetic</title><a href="/target?synthetic">Link</a><script>
setTimeout(() => document.querySelector("a").dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true, cancelable: true })), 50)
</script>`

// What a page does on its own after a real press, as `window.plan` says: it tells its frame from another site, which the
// press gave no activation, to open a window, or it clicks another link with Shift. A real press on its link navigates
// nowhere.
const afterPress = `<!doctype html><title>After press</title>
<style>a,div{position:fixed;left:0;width:300px;height:40px;display:block}</style>
<div style="top:0">Elsewhere</div>
<a href="/target?prevented" style="top:50px">Prevented link</a>
<a id="other" href="/target" style="top:100px">Other link</a>
<iframe src="http://localhost:PORT/opener" style="position:fixed;top:200px;left:0;width:300px;height:60px"></iframe>
<script>
window.presses = 0
window.moves = 0
addEventListener("pointermove", () => window.moves++, true)
addEventListener("message", () => { window.ready = true })
addEventListener("click", (event) => {
  if (!event.isTrusted) return
  window.presses++
  if (event.target.closest("a")) event.preventDefault()
  const { kind, delay } = window.plan
  if (kind === "frame") return frames[0].postMessage(delay, "*")
  setTimeout(() => {
    const other = document.getElementById("other")
    other.href = "/target?made-up-" + delay
    other.dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true, cancelable: true }))
  }, delay)
}, true)
</script>`

// The frame keeps its renderer busy before the window it asks for.
const opener = `<!doctype html><title>Opener</title><script>
addEventListener("message", (event) => {
  setTimeout(() => {
    for (const end = performance.now() + 20; performance.now() < end; );
    window.open("/target?frame-" + event.data)
  }, event.data)
})
parent.postMessage("ready", "*")
</script>`

const unprompted = `<!doctype html><title>Unprompted</title><script>setTimeout(() => window.open("/target?timer"), 50)</script>`

// A document that commits, then leaves for a download by itself.
const thenDownload = `<!doctype html><title>Then download</title><script>setTimeout(() => { location.href = "/download" }, 50)</script>`

function served(path: string | undefined) {
  if (path === "/links") return links

  if (path === "/then-download") return thenDownload

  if (path === "/opener") return opener

  if (path === "/synthetic") return synthetic

  if (path === "/unprompted") return unprompted

  return "<!doctype html><title>Target</title><p>target</p>"
}

void electron.app.whenReady().then(async () => {
  const { Schema } = await import("effect")
  const { Browser } = await import("@opencode/plugin-browser/rpc")
  const { createBrowserPage } = await import("./chromium")
  const { createHandlePath } = await import("./disk")
  const { activityOwner } = await import("./policy")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")
  // Downloads whose last bytes wait, so a test decides whether its tab closed before the download ended.
  const held = new Set<ServerResponse>()

  const server = createServer((request, response) => {
    if (request.url === "/favicon.ico") return void response.writeHead(404).end()

    if (request.url === "/download") {
      response.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="report.bin"' })
      response.write("made-up ")

      return void held.add(response)
    }

    if (request.url === "/to-mail") return void response.writeHead(302, { location: "mailto:someone@example.test" }).end()

    // An address with a password, which the pane opens nowhere.
    if (request.url === "/to-refused")
      return void response.writeHead(302, { location: `http://someone:secret@${request.headers.host}/target?refused` }).end()

    if (request.url === "/after-press") {
      response.writeHead(200, { "content-type": "text/html" })

      return void response.end(afterPress.replace("PORT", String(request.headers.host).split(":")[1] ?? ""))
    }

    response.writeHead(200, { "content-type": "text/html" })
    response.end(served(request.url))
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const port = address instanceof Object ? address.port : 0
  const origin = `http://127.0.0.1:${port}`
  // Never shown and never focused: the presses below are Chromium input events, not the system's.
  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const partition = "links-fixture"
  const verifier = createHandlePath()
  const values = new Map<string, unknown>()

  type Page = ReturnType<typeof createBrowserPage>

  // Each page by its web contents, as the pane keeps each tab's download handler (`downloads` in pane.ts).
  const pages = new Map<number, Page>()
  const downloads: { url: string; state: string; updated: boolean }[] = []

  for (const session of [electron.session.fromPartition(partition), electron.session.defaultSession])
    session.on("will-download", (_event, item, source) => {
      // First, and whatever follows: an item with a save path asks nobody where to save it. The file lands in this
      // run's own profile folder, which the test removes.
      item.setSavePath(path.join(electron.app.getPath("userData"), "downloads", `download-${downloads.length}`))
      const download = { url: item.getURL().replace(origin, ""), state: item.getState(), updated: false }
      downloads.push(download)
      // As the session's one listener hands a download to the tab that started it (session-guard.ts).
      pages.get(source.id)?.download(item)
      // Added after the page's own listeners, so the page has answered an update before this says there was one.
      item.on("updated", () => {
        download.updated = true
      })
      item.once("done", (_done, state) => {
        download.state = state
        download.updated = true
      })
    })

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

  // The window host owns bounds and occlusion; here every view fills the window and shows when its page says so.
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
  const made = { count: 0 }

  // What the page asked the pane for: each tab with whether it stays behind the current one, and each notice.
  type Opened = { readonly background: boolean; readonly owner: string; closed: boolean; readonly notices: RefusalNotice[] }

  const opened: Opened[] = []
  const tabs = new Map<Opened, Page>()
  const notices: RefusalNotice[] = []

  // A page as the pane makes it (`create` in pane.ts). One a link or script opened adopts Chromium's new contents, says
  // its own notices, and can close itself or hand an address back to the tab that opened it.
  const make = (activity: TabActivity, popup?: { readonly options: Electron.BrowserWindowConstructorOptions; readonly tab: Opened; readonly refused: (url: string) => void }): Page => {
    const created = createBrowserPage(win, {
      id: Browser.TabID.make(`tab_${String(++made.count).padStart(8, "0")}-1111-1111-1111-111111111111`),
      toolbar: false,
      partition,
      network: null,
      popupOptions: popup?.options,
      initialize: popup ? false : undefined,
      opened: popup && {
        close: () => {
          const page = tabs.get(popup.tab)

          if (!page || popup.tab.closed) return
          popup.tab.closed = true
          pages.delete(page.contents.id)
          void page.dispose()
        },
        refused: popup.refused,
      },
      publish: () => undefined,
      refused: (notice) => (popup ? popup.tab.notices : notices).push(notice),
      fail: () => undefined,
      popup: (options, background, child, refused) => {
        const tab: Opened = { background, owner: activityOwner(child), closed: false, notices: [] }
        const page = make(child, { options, tab, refused })
        opened.push(tab)
        tabs.set(tab, page)

        return page.contents
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

    pages.set(created.contents.id, created)
    // A tab that closes before it is ready fails its start, which the pane expects too (`create` in pane.ts).
    void created.ready.catch(() => undefined)

    return created
  }

  const activity: TabActivity = { agentRuns: 0 }
  const page = make(activity)
  const tabID = page.state().id
  await page.ready

  const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 20))

  // Bounded, so a press that leads to nothing fails the test's comparison instead of hanging the fixture.
  const until = async (done: () => boolean | Promise<boolean>) => {
    for (const deadline = Date.now() + 10_000; Date.now() < deadline && !(await done()); ) await turn()
  }

  const count = (name: "presses" | "moves") => page.contents.executeJavaScript(`window.${name} ?? 0`).then(Number, () => 0)

  const presses = () => count("presses")

  const go = async (path: string) => {
    await page.execute({ action: { type: "navigate", tabID, url: origin + path }, files: [] }, signal, "user")
    // A hidden window's page is throttled and takes no input. The agent's commands lift that themselves; the person's
    // window is on screen.
    page.contents.setBackgroundThrottling(false)
  }

  // Addresses as paths, whichever of the server's two sites they are on.
  const local = (notice: RefusalNotice) =>
    "target" in notice ? { ...notice, target: notice.target.replace(origin, "").replace(`http://localhost:${port}`, "") } : notice

  // What happened since `before`: the new tabs, each once its first navigation has ended in a page, a notice, a
  // download or its own closing; the new notices of the pressed page; and the new downloads, once they have ended.
  const outcome = async (before: { opened: number; notices: number; downloads: number }, downloading = false) => {
    const started = () => downloads.slice(before.downloads)

    if (downloading) await until(() => started().some((download) => download.updated))

    const shown = await Promise.all(
      opened.slice(before.opened).map(async (tab) => {
        const page = tabs.get(tab)

        if (!page) return tab
        await page.ready.catch(() => undefined)
        await until(() => tab.closed || tab.notices.length > 0 || started().some((download) => download.updated) || (!!page.contents.getURL() && !page.contents.isLoading()))

        return tab
      }),
    )

    // Only now do the downloads get their last bytes: each has already met its tab open or closed.
    const met = started().map((download) => ({ download, tab: shown.some((tab) => tab.closed) ? "closed" : "open" }))
    held.forEach((response) => response.end("bytes"))
    held.clear()
    await until(() => started().every((download) => download.state !== "progressing"))

    const listed = await Promise.all(
      shown.map(async (tab) => {
        const page = tabs.get(tab)
        const base = { background: tab.background, owner: tab.owner }

        if (!page || tab.closed) return { ...base, closed: true }
        const url = page.state().url.replace(origin, "")
        // A tab with no document has no window to ask.
        const opener: unknown = page.contents.getURL() ? await page.contents.executeJavaScript("window.opener === null ? 'none' : 'opener'") : undefined
        pages.delete(page.contents.id)
        await page.dispose()

        // What is undefined is left out of the printed line.
        return { ...base, url, opener, notices: tab.notices.length ? tab.notices.map(local) : undefined }
      }),
    )

    return {
      tabs: listed,
      notices: notices.slice(before.notices).map(local),
      owner: activityOwner(activity),
      downloads: met.length ? met.map((item) => ({ url: item.download.url, state: item.download.state, tab: item.tab })) : undefined,
    }
  }

  const mark = () => ({ opened: opened.length, notices: notices.length, downloads: downloads.length })

  // The person's press, as Chromium receives one from the system.
  const press = async (row: number, button: "left" | "middle", modifiers: ("shift" | "control" | "meta")[] = [], downloading = false) => {
    const before = mark()
    const seen = await presses()
    const at = { x: 20, y: row * 50 + 20 }
    // The pointer is on what it presses, as a person's is.
    page.contents.sendInputEvent({ type: "mouseMove", ...at, modifiers })
    page.contents.sendInputEvent({ type: "mouseDown", ...at, button, clickCount: 1, modifiers })
    page.contents.sendInputEvent({ type: "mouseUp", ...at, button, clickCount: 1, modifiers })
    // The page saw the click, and what it asked the pane for followed: a tab or a notice, or neither.
    await until(async () => (await presses()) > seen)
    await until(async () => opened.length > before.opened || notices.length > before.notices || (await presses()) > seen)
    await turn()

    return outcome(before, downloading)
  }

  // The person's Enter on the plain link, which Chromium opens as it opens a click with the same modifiers.
  const enter = async (modifiers: ("shift" | "control" | "meta")[]) => {
    const before = mark()
    await page.contents.executeJavaScript("document.querySelector('a').focus()")

    for (const type of ["keyDown", "char", "keyUp"] as const) page.contents.sendInputEvent({ type, keyCode: "Enter", modifiers })
    await until(() => opened.length > before.opened || notices.length > before.notices)

    return outcome(before)
  }

  // The agent's click on a link, through its own click command.
  const agentPress = async (name: string, button: "left" | "middle", downloading = false) => {
    const before = mark()
    const snapshot = await page.execute({ action: { type: "snapshot", tabID }, files: [] }, signal, "agent")
    const content = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(snapshot.value).content
    const ref = new RegExp(`@(e\\d+) \\[link\\] "${name}"`).exec(content)?.[1]

    if (!ref) throw new Error(`The snapshot names no ${name}:\n${content}`)

    const refusal = await page
      .execute({ action: { type: "click", tabID, ref: Browser.Ref.make(ref), button }, files: [] }, signal, "agent")
      .then(
        () => undefined,
        (error: Error) => error.message,
      )

    if (!refusal) await until(() => notices.length > before.notices || opened.length > before.opened)

    return { ...(await outcome(before, downloading)), refusal }
  }

  // A plain press on the page that then acts on its own: one request follows it, which is not the person's.
  const pressThenWait = async (row: number, kind: "frame" | "made-up", delay: number) => {
    await page.contents.executeJavaScript(`window.plan = ${JSON.stringify({ kind, delay })}`)
    const before = mark()
    const at = { x: 20, y: row * 50 + 20 }
    page.contents.sendInputEvent({ type: "mouseMove", ...at })
    page.contents.sendInputEvent({ type: "mouseDown", ...at, button: "left", clickCount: 1 })
    page.contents.sendInputEvent({ type: "mouseUp", ...at, button: "left", clickCount: 1 })
    await until(() => notices.length > before.notices || opened.length > before.opened)
    await turn()

    return { on: row ? "link" : "elsewhere", kind, delay, ...(await outcome(before)) }
  }

  // A page that asks for a tab by itself, with nobody's press.
  const unasked = async (path: string) => {
    const before = mark()
    await go(path)
    await until(() => notices.length > before.notices || opened.length > before.opened)

    return outcome(before)
  }

  await go("/links")
  // The page takes input once it has painted.
  await until(async () => {
    page.contents.sendInputEvent({ type: "mouseMove", x: 500 + (Date.now() % 2), y: 500 })

    return (await count("moves")) > 0
  })
  const modifier = process.platform === "darwin" ? "meta" : "control"
  const middle = await press(0, "middle")
  const modified = await press(0, "left", [modifier])
  const modifiedShift = await press(0, "left", [modifier, "shift"])
  const middleShift = await press(0, "middle", ["shift"])
  const shift = await press(0, "left", ["shift"])
  const blank = await press(1, "left")
  const blankMiddle = await press(1, "middle")
  const mail = await press(2, "left")
  const mailMiddle = await press(2, "middle")
  const nothing = await press(3, "middle")
  const opener = await press(4, "left")
  const openerMiddle = await press(4, "middle")
  const key = await enter([modifier])
  const download = await press(5, "middle", [], true)
  const blankDownload = await press(6, "left", [], true)
  const mailRedirect = await press(7, "middle")
  const refusedRedirect = await press(8, "middle")
  const thenDownloaded = await press(9, "middle", [], true)
  const agent = await agentPress("Plain link", "middle")
  const agentDownload = await agentPress("Blank download link", "left", true)
  const reclaimed = await press(0, "middle")
  const synthesized = await unasked("/synthetic")
  const timer = await unasked("/unprompted")
  await go("/after-press")
  await until(async () => {
    page.contents.sendInputEvent({ type: "mouseMove", x: 500 + (Date.now() % 2), y: 500 })

    return (await count("moves")) > 0 && (await page.contents.executeJavaScript("window.ready === true"))
  })
  // A slow renderer, so a report that could arrive late would.
  await page.contents.debugger.sendCommand("Emulation.setCPUThrottlingRate", { rate: 4 })
  const afterwards: Awaited<ReturnType<typeof pressThenWait>>[] = []

  for (const row of [0, 1])
    for (const kind of ["frame", "made-up"] as const)
      for (const delay of [50, 500, 2000]) afterwards.push(await pressThenWait(row, kind, delay))

  process.stdout.write(
    `${JSON.stringify({ platform: process.platform, middle, modified, modifiedShift, middleShift, shift, blank, blankMiddle, mail, mailMiddle, nothing, opener, openerMiddle, key, download, blankDownload, mailRedirect, refusedRedirect, thenDownload: thenDownloaded, agent, agentDownload, reclaimed, synthetic: synthesized, timer, afterPress: afterwards })}\n`,
  )
  await page.dispose()
  server.closeAllConnections()
  server.close()
  electron.app.quit()
})
