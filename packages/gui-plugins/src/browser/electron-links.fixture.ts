import { createServer } from "node:http"
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

// One row of 40px every 50px, so a press at (20, 50 * row + 20) lands on that row.
const links = `<!doctype html><title>Links</title>
<style>a,div{position:fixed;left:0;width:300px;height:40px;display:block}</style>
<a href="/target?plain" style="top:0">Plain link</a>
<a href="/target?blank" target="_blank" style="top:50px">Blank link</a>
<a href="mailto:someone@example.test" style="top:100px">Mail link</a>
<div style="top:150px">No link</div>
<a href="/target?opener" target="_blank" rel="opener" style="top:200px">Opener link</a>
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

const unprompted = `<!doctype html><title>Unprompted</title><script>setTimeout(() => window.open("/target?timer"), 50)</script>`

function served(path: string | undefined) {
  if (path === "/links") return links

  if (path === "/synthetic") return synthetic

  if (path === "/unprompted") return unprompted

  return "<!doctype html><title>Target</title><p>target</p>"
}

const server = createServer((request, response) => {
  if (request.url === "/favicon.ico") return void response.writeHead(404).end()
  response.writeHead(200, { "content-type": "text/html" })
  response.end(served(request.url))
})

void electron.app.whenReady().then(async () => {
  const { Schema } = await import("effect")
  const { Browser } = await import("@opencode/plugin-browser/rpc")
  const { createBrowserPage } = await import("./chromium")
  const { createHandlePath } = await import("./disk")
  const { activityOwner } = await import("./policy")
  const { createSitePermissions } = await import("./site-permissions")
  const { createSystemMedia } = await import("./system-media")
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`
  // Never shown and never focused: the presses below are Chromium input events, not the system's.
  const win = new electron.BrowserWindow({ show: false, width: 800, height: 600 })
  const partition = "links-fixture"
  const verifier = createHandlePath()
  const values = new Map<string, unknown>()
  // No press here starts a download; one that did would end here, before the system's save dialog.
  electron.session.fromPartition(partition).on("will-download", (event) => event.preventDefault())

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
  const opened: { background: boolean; owner: string; page: ReturnType<typeof createBrowserPage> }[] = []
  const notices: RefusalNotice[] = []

  // A page as the pane makes it (`create` in pane.ts); one a link or script opened adopts Chromium's new contents.
  const make = (activity: TabActivity, popupOptions?: Electron.BrowserWindowConstructorOptions): ReturnType<typeof createBrowserPage> =>
    createBrowserPage(win, {
      id: Browser.TabID.make(`tab_${String(++made.count).padStart(8, "0")}-1111-1111-1111-111111111111`),
      toolbar: false,
      partition,
      network: null,
      popupOptions,
      initialize: popupOptions ? false : undefined,
      publish: () => undefined,
      refused: (notice) => notices.push(notice),
      fail: () => undefined,
      popup: (options, background, child) => {
        const page = make(child, options)
        opened.push({ background, owner: activityOwner(child), page })

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

  // What happened since `before`: the new tabs, once each has loaded its first page, and the new notices.
  const outcome = async (before: { opened: number; notices: number }) => {
    const tabs = await Promise.all(
      opened.slice(before.opened).map(async (item) => {
        await item.page.ready
        await until(() => !!item.page.contents.getURL() && !item.page.contents.isLoading())
        const opener: unknown = await item.page.contents.executeJavaScript("window.opener === null ? 'none' : 'opener'")
        const url = item.page.state().url.replace(origin, "")
        await item.page.dispose()

        return { background: item.background, owner: item.owner, url, opener }
      }),
    )

    return { tabs, notices: notices.slice(before.notices).map((notice) => ("target" in notice ? { ...notice, target: notice.target.replace(origin, "") } : notice)), owner: activityOwner(activity) }
  }

  const mark = () => ({ opened: opened.length, notices: notices.length })

  // The person's press, as Chromium receives one from the system.
  const press = async (row: number, button: "left" | "middle", modifiers: ("shift" | "control" | "meta")[] = []) => {
    const before = mark()
    const seen = await presses()
    const at = { x: 20, y: row * 50 + 20 }
    page.contents.sendInputEvent({ type: "mouseDown", ...at, button, clickCount: 1, modifiers })
    page.contents.sendInputEvent({ type: "mouseUp", ...at, button, clickCount: 1, modifiers })
    // The page saw the click, and what it asked the pane for followed: a tab or a notice, or neither.
    await until(async () => (await presses()) > seen)
    await until(async () => opened.length > before.opened || notices.length > before.notices || (await presses()) > seen)
    await turn()

    return outcome(before)
  }

  // The person's Enter on the plain link, which Chromium opens as it opens a click with the same modifiers.
  const enter = async (modifiers: ("shift" | "control" | "meta")[]) => {
    const before = mark()
    await page.contents.executeJavaScript("document.querySelector('a').focus()")

    for (const type of ["keyDown", "char", "keyUp"] as const) page.contents.sendInputEvent({ type, keyCode: "Enter", modifiers })
    await until(() => opened.length > before.opened || notices.length > before.notices)

    return outcome(before)
  }

  // The agent's middle-click on the plain link, through its own click command.
  const agentPress = async () => {
    const before = mark()
    const snapshot = await page.execute({ action: { type: "snapshot", tabID }, files: [] }, signal, "agent")
    const content = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(snapshot.value).content
    const ref = /@(e\d+) \[link\] "Plain link"/.exec(content)?.[1]

    if (!ref) throw new Error(`The snapshot names no Plain link:\n${content}`)

    const refusal = await page
      .execute({ action: { type: "click", tabID, ref: Browser.Ref.make(ref), button: "middle" }, files: [] }, signal, "agent")
      .then(
        () => undefined,
        (error: Error) => error.message,
      )

    if (!refusal) await until(() => notices.length > before.notices || opened.length > before.opened)

    return { ...(await outcome(before)), refusal }
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
  const agent = await agentPress()
  const reclaimed = await press(0, "middle")
  const synthesized = await unasked("/synthetic")
  const timer = await unasked("/unprompted")
  process.stdout.write(
    `${JSON.stringify({ platform: process.platform, middle, modified, modifiedShift, middleShift, shift, blank, blankMiddle, mail, mailMiddle, nothing, opener, openerMiddle, key, agent, reclaimed, synthetic: synthesized, timer })}\n`,
  )
  await page.dispose()
  server.closeAllConnections()
  server.close()
  electron.app.quit()
})
