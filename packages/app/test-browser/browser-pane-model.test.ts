import { expect, spyOn, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { IpcClient, SessionRef, SetupContext } from "@opencode/plugin/gui"
import { liveAccessor } from "@opencode/plugin/gui/host"
import { Browser } from "../../plugin-browser/src/rpc"
import type definition from "../../gui-plugins/src/browser/index"
import type { BrowserPane, PaneEvent } from "../../gui-plugins/src/browser/ipc"
import { createModel } from "../../gui-plugins/src/browser/model"

type PaneClient = IpcClient<(typeof BrowserPane)["spec"]>

const tab = (digit: string, url = `https://${digit}.example/`): Browser.Tab => ({
  id: Browser.TabID.make(`tab_${digit.repeat(8)}-1111-1111-1111-111111111111`),
  url,
  title: url,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 0,
})

// The real model over the pane's main-process Ipc, faked at its boundary, with two shell sessions on one server.
function fixture() {
  const bindings = new Map<string, string>()
  const listeners = new Set<(value: { binding: string; event: PaneEvent }) => void>()
  // What main rejects the next commands with, first in, first out.
  const rejections: string[] = []
  const server = { id: "browser-test", compatible: true, builtin: true, data: { on: () => () => undefined, session: { status: () => "idle" } } }

  const refs = ["ses_alpha", "ses_beta"].map((id) => ({
    key: `${server.id}\n${id}`,
    id,
    tab: id,
    server,
    pending: false,
    location: { directory: "/repo" },
  }))

  const [current, setCurrent] = createSignal(refs[0])

  const pane: PaneClient = {
    register: async (input) => {
      bindings.set(input.session, input.binding)
    },
    load: async () => undefined,
    command: async () => {
      const message = rejections.shift()

      if (message !== undefined) throw new Error(message)
    },
    inspect: async () => undefined,
    highlight: async () => undefined,
    zoom: async () => undefined,
    setViewport: async () => undefined,
    site: async () => ({ cookies: 0 }),
    clearSite: async () => undefined,
    reveal: async () => undefined,
    close: async () => undefined,
    state: () => undefined,
    on: (_name, listener) => {
      // SAFETY: the pane's Ipc has one event, whose payload is exactly this binding and PaneEvent.
      const added = listener as (value: { binding: string; event: PaneEvent }) => void
      listeners.add(added)

      return () => void listeners.delete(added)
    },
  }

  const live = liveAccessor(() => ({ status: "active" as const, generation: 1, value: pane }))
  const history = { value: { visits: [] }, set: () => undefined }

  const fake = {
    id: "browser",
    t: (key: string, params?: Record<string, string>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    use: () => live,
    sessions: { current, list: () => refs },
    screen: { current: () => undefined },
    links: { open: () => undefined },
    layout: { narrow: () => false, stored: () => [], state: () => "closed", open() {}, close() {}, side: { opened: () => false } },
    stores: { history },
  }

  // SAFETY: the model reads only these context fields, and these fields of a session and its server.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const ctx = fake as unknown as SetupContext<typeof definition>
  const owned = createRoot((dispose) => ({ model: createModel(ctx), dispose }))

  const send = (session: string, event: PaneEvent) => {
    const binding = bindings.get(session)

    if (binding) listeners.forEach((listener) => listener({ binding, event }))
  }

  const emit = (session: string, state: Browser.State) => send(session, { type: "state", state })

  // SAFETY: the model reads only the listed fields of a session ref.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const sessions = refs.map((ref) => ref as unknown as SessionRef)

  return { ...owned, sessions, route: setCurrent, refs, emit, send, rejections }
}

test("drops page details when a tab closes or its binding is suspended", () => {
  const app = fixture()

  const session = app.sessions[0]

  const closed = tab("a")

  const retained = tab("b")

  const viewport = { mode: "fixed", width: 390, height: 844 } as const

  try {
    app.emit(session.id, { tabs: [closed, retained], focusedTabID: closed.id })

    for (const tab of [closed, retained]) app.send(session.id, { type: "page", tabID: tab.id, zoom: 1, viewport })
    expect(app.model.page(session, closed.id)?.viewport).toEqual(viewport)
    const remaining = { tabs: [retained], focusedTabID: retained.id }
    app.emit(session.id, remaining)
    expect(app.model.page(session, closed.id)).toBeUndefined()
    expect(app.model.page(session, retained.id)?.viewport).toEqual(viewport)

    app.send(session.id, { type: "state", state: remaining, error: "browser.pane.suspended" })
    expect(app.model.tab(session, retained.id)?.url).toBe(retained.url)
    expect(app.model.page(session, retained.id)).toBeUndefined()
  } finally {
    app.dispose()
  }
})

test("one session's transitions leave another session's attachment as it was", async () => {
  const app = fixture()
  const [alpha, beta] = app.sessions

  try {
    // Both sessions attach and register with main; each gets its own inventory.
    app.route(app.refs[1])
    await Bun.sleep(0)
    app.emit("ses_alpha", { tabs: [tab("a")], focusedTabID: tab("a").id })
    app.emit("ses_beta", { tabs: [tab("b")], focusedTabID: tab("b").id })
    expect(app.model.attached(alpha)).toBe(true)
    expect(app.model.attached(beta)).toBe(true)

    // The user opens a blank tab in Alpha only: a blank tab Beta's agent opens must not take Beta's address focus.
    app.model.open(alpha)
    app.emit("ses_beta", { tabs: [tab("b"), tab("c", "about:blank")], focusedTabID: tab("c").id })
    expect(app.model.opened(beta, tab("c").id)).toBe(false)

    app.emit("ses_alpha", { tabs: [tab("a"), tab("d", "about:blank")], focusedTabID: tab("d").id })
    expect(app.model.opened(alpha, tab("a").id)).toBe(false)
    expect(app.model.opened(alpha, tab("d").id)).toBe(true)
    expect(app.model.tabs(beta, [tab("b").id, tab("c").id])).toEqual([tab("b").id, tab("c").id])
  } finally {
    app.dispose()
  }
})

test("the app menu's hard reload runs once, on the pane the window shows", async () => {
  const app = fixture()
  const reloads: (boolean | undefined)[] = []
  const pane = { visible: true }
  const nothing = () => undefined

  const unmount = app.model.mount({
    visible: () => pane.visible,
    address: () => "",
    reload: (ignoreCache) => void reloads.push(ignoreCache),
    close: nothing,
    inspectable: () => false,
    inspect: nothing,
    focusAddress: nothing,
    find: nothing,
    findMatch: nothing,
    press: nothing,
    focused: nothing,
  })

  try {
    app.route(app.refs[1])
    await Bun.sleep(0)
    // Main sends it to every binding of the window with a tab in front. Only the routed session's pane answers.
    app.send("ses_alpha", { type: "hardReload" })
    expect(reloads).toEqual([])
    app.send("ses_beta", { type: "hardReload" })
    expect(reloads).toEqual([true])
    // A pane that is mounted but not on screen, such as behind Review, is not what the person sees.
    pane.visible = false
    app.send("ses_beta", { type: "hardReload" })
    expect(reloads).toEqual([true])
  } finally {
    unmount()
    app.dispose()
  }
})

test("a passkey notice names the tab's origin and offers the import for the page's registrable site", async () => {
  const app = fixture()
  const [alpha] = app.sessions
  const page = tab("a", "https://login.github.com/session")

  try {
    await Bun.sleep(0)
    app.emit("ses_alpha", { tabs: [page], focusedTabID: page.id })
    // Main sends both: the notice's own site, which the import searches for, and the origin the tab was on.
    app.send("ses_alpha", {
      type: "refusal",
      tabID: page.id,
      notice: { reason: "browser.passkey", site: "github.com" },
      token: "token",
      site: "https://login.github.com",
    })
    expect(app.model.notice(alpha, page.id)).toEqual({
      token: "token",
      origin: 'notice.site {"site":"https://login.github.com"}',
      text: "refused.passkey",
      label: "refused.passkey.import",
      passkey: { site: "github.com", choose: true },
    })
    // Where the agent's tab refuses, the new tab opens the origin main reported with the notice and the button names
    // it: not the tab's path, which the page can change without replacing the notice.
    app.emit("ses_alpha", { tabs: [{ ...page, url: "https://login.github.com/changed?since=notice" }], focusedTabID: page.id })
    app.send("ses_alpha", { type: "refusal", tabID: page.id, notice: { reason: "browser.passkey.off", site: "github.com" }, token: "off", site: "https://login.github.com" })
    expect(app.model.notice(alpha, page.id)).toEqual({
      token: "off",
      origin: 'notice.site {"site":"https://login.github.com"}',
      text: "refused.passkey.off",
      label: "refused.passkey.newTab",
      title: "https://login.github.com",
      passkey: { newTab: "https://login.github.com" },
    })
    // A page with no web origin has nowhere to reopen.
    app.send("ses_alpha", { type: "refusal", tabID: page.id, notice: { reason: "browser.passkey.off" }, token: "none" })
    expect(app.model.notice(alpha, page.id)).toEqual({ token: "none", origin: "notice.page", text: "refused.passkey.off" })
  } finally {
    app.dispose()
  }
})

test("a command main rejects says what the person tried, never the app's generic failure text", async () => {
  const app = fixture()
  const [alpha] = app.sessions
  const page = tab("a")
  const warned = spyOn(console, "warn").mockImplementation(() => undefined)

  try {
    await Bun.sleep(0)
    app.emit("ses_alpha", { tabs: [page], focusedTabID: page.id })

    // A message main never sent before: the notice names the reload, offers it again, and the code is logged.
    app.rejections.push("something new in main")
    app.model.command(alpha, { type: "reload", tabID: page.id })
    await Bun.sleep(0)
    expect(app.model.failure(alpha, page.id)).toMatchObject({ text: "failed.command.reload", lasting: false })
    expect(app.model.failure(alpha, page.id)?.retry).toBeFunction()
    expect(warned).toHaveBeenCalledWith("[browser] unmapped failure", { code: "something new in main", action: "reload" })
    // It belongs to the tab the command was for.
    expect(app.model.failure(alpha, tab("b").id)).toBeUndefined()

    // A refused address keeps main's reason and stays to be read; nothing is logged for a code the table knows.
    warned.mockClear()
    app.rejections.push("browser.address.web")
    app.model.command(alpha, { type: "navigate", tabID: page.id, url: "ftp://files.example/" })
    await Bun.sleep(0)
    expect(app.model.failure(alpha, page.id)).toMatchObject({ text: "refused.web", lasting: true, retry: undefined })
    expect(warned).not.toHaveBeenCalled()

    // A load that failed is the page area's to explain, from the tab's own state: no notice above it as well.
    app.rejections.push("ERR_NAME_NOT_RESOLVED (-105) loading 'https://nowhere.example/'")
    app.model.command(alpha, { type: "navigate", tabID: page.id, url: "https://nowhere.example/" })
    await Bun.sleep(0)
    expect(app.model.failure(alpha, page.id)).toBeUndefined()

    // The person closes a notice by its identity.
    app.rejections.push("something new in main")
    app.model.command(alpha, { type: "back", tabID: page.id })
    await Bun.sleep(0)
    const shown = app.model.failure(alpha, page.id)
    expect(shown?.text).toBe("failed.command.back")
    app.model.dismissFailure(alpha, shown?.id ?? -1)
    expect(app.model.failure(alpha, page.id)).toBeUndefined()
  } finally {
    warned.mockRestore()
    app.dispose()
  }
})
