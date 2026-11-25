import { afterEach, expect, jest, spyOn, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { IpcClient, SessionRef, SetupContext } from "@opencode/plugin/gui"
import { liveAccessor } from "@opencode/plugin/gui/host"
import { Browser } from "../../plugin-browser/src/rpc"
import { BrowserHistory } from "../../gui-plugins/src/browser/history/ipc"
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
// `given` is what the window knows of that server, the sessions' location and the pane's Ipc as the model starts.
// With `slow`, main takes a registration only once the test calls `answer`, as while it attaches to the server.
function fixture(
  given: { connected?: boolean; compatible?: boolean; local?: boolean; located?: boolean; ipc?: "active" | "pending" | "inactive"; slow?: boolean } = {},
) {
  const bindings = new Map<string, string>()
  const listeners = new Set<(value: { binding: string; event: PaneEvent }) => void>()
  // What main rejects the next commands with, first in, first out.
  const rejections: string[] = []
  const [connected, setConnected] = createSignal(given.connected ?? true)
  const [ipc, setIpc] = createSignal(given.ipc ?? "active")
  const answered = Promise.withResolvers<void>()
  // The sessions the server runs, as the test starts them.
  const [running, setRunning] = createSignal<readonly string[]>([])
  // The sessions whose details carry a desktop's browser grant, this window's or another's.
  const [held, setHeld] = createSignal<readonly string[]>([])

  if (!given.slow) answered.resolve()

  const server = {
    id: "browser-test",
    compatible: given.compatible ?? true,
    get connected() {
      return connected()
    },
    local: given.local ?? true,
    builtin: true,
    data: {
      on: () => () => undefined,
      session: {
        status: (id: string) => (running().includes(id) ? "running" : "idle"),
        get: (id: string) => ({ permissions: held().includes(id) ? [{ action: "browser", resource: "*", effect: "allow" }] : [] }),
      },
    },
  }

  const refs = ["ses_alpha", "ses_beta"].map((id) => ({
    key: `${server.id}\n${id}`,
    id,
    tab: id,
    server,
    pending: false,
    location: given.located === false ? undefined : { directory: "/repo" },
  }))

  const [current, setCurrent] = createSignal(refs[0])

  const pane: PaneClient = {
    register: async (input) => {
      bindings.set(input.session, input.binding)
      await answered.promise
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

  const live = liveAccessor(() => {
    const status = ipc()

    return status === "active" ? { status, generation: 1, value: pane } : { status }
  })

  const history = { value: { visits: [] }, set: () => undefined }
  // Main's history of every page is away, as on the web: these cases are about the pane.
  const away = liveAccessor(() => ({ status: "inactive" }))
  // The tabs the last run saved for the strip, which the model writes with every inventory: none here.
  const tabs = { value: { sessions: [] }, set: () => undefined }

  const fake = {
    id: "browser",
    t: (key: string, params?: Record<string, string>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    use: (token: { readonly id: string }) => (token.id === BrowserHistory.id ? away : live),
    sessions: { current, list: () => refs },
    screen: { current: () => undefined },
    links: { open: () => undefined },
    layout: { narrow: () => false, ready: () => false, stored: () => [], state: () => "closed", open() {}, close() {}, side: { opened: () => false } },
    stores: { history, tabs },
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

  return { ...owned, sessions, route: setCurrent, refs, emit, send, rejections, setConnected, setIpc, run: (id: string) => setRunning((ids) => [...ids, id]), hold: (id: string, value: boolean) => setHeld((ids) => (value ? [...ids, id] : ids.filter((item) => item !== id))), answer: answered.resolve, registered: () => Array.from(bindings.keys()), binding: (id: string) => bindings.get(id) }
}

// Runs the promise jobs queued so far, which the fake clock does not: more turns than a registration takes.
const turns = async () => {
  for (const _ of Array.from({ length: 32 })) await Promise.resolve()
}

// Whether the promise is still pending once every queued job ran.
const waits = async (promise: Promise<void>) => {
  const state = { done: false }

  void promise.then(() => (state.done = true))
  await turns()

  return !state.done
}

afterEach(() => void jest.useRealTimers())

// What the system says of the network, which nothing but the navigator's own property can change. Returns the undo.
const network = (online: boolean) => {
  const was = navigator.onLine

  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online })

  return () => void Object.defineProperty(navigator, "onLine", { configurable: true, get: () => was })
}

// A prompt waits for the desktop's attachment only while one is in flight on a server that can answer it. In every
// other state the gate resolves in the same tick: no timer runs, and nothing is asked of a server that cannot answer.
test.each([
  { state: "the server is not connected, or is reconnecting", given: { connected: false } },
  { state: "the server is one this app cannot talk to", given: { compatible: false } },
  { state: "the session has no location yet", given: { located: false } },
  { state: "the window is offline and the server is on another computer", given: { local: false }, offline: true },
  { state: "the pane's plugin is disabled or failed", given: { ipc: "inactive" as const } },
  { state: "another desktop owns the session", error: "browser.pane.replaced" },
  { state: "the server has no browser for the session", error: "browser.pane.unsupported" },
  { state: "the server does not have the session", error: "browser.pane.missing" },
  { state: "the desktop is attached already", attached: true },
  { state: "the plugin was disposed", disposed: true },
])("a prompt does not wait when $state", async (row) => {
  jest.useFakeTimers()
  const restore = network(!row.offline)
  const app = fixture(row.given)
  const session = app.sessions[1]
  const never = new AbortController().signal

  try {
    // An earlier prompt met the state: what main answered it with is how the session stands now.
    if (row.error || row.attached) {
      const first = app.model.ready(session, never)
      await turns()
      app.send(session.id, row.error ? { type: "state", state: null, error: row.error } : { type: "state", state: { tabs: [tab("b")], focusedTabID: tab("b").id } })
      expect(await waits(first)).toBe(false)
    }

    if (row.disposed) app.dispose()
    const registered = app.registered().length
    expect(await waits(app.model.ready(session, never))).toBe(false)

    // Nothing was started that could not answer.
    if (!row.attached) expect(app.registered().length).toBe(registered)
  } finally {
    restore()
    app.dispose()
  }
})

test.each([
  { name: "the desktop has attached", end: "answer" },
  { name: "the server goes away", end: "disconnect" },
  { name: "the plugin is disposed", end: "dispose" },
  { name: "the host stops waiting", end: "abort" },
  { name: "the pane's plugin stops", end: "ipc" },
] as const)("a prompt waits while the attachment is in flight, until $name", async (row) => {
  jest.useFakeTimers()
  const app = fixture({ slow: true })
  const session = app.sessions[1]
  const host = new AbortController()

  try {
    const waiting = app.model.ready(session, host.signal)

    expect(await waits(waiting)).toBe(true)
    expect(app.registered()).toContain(session.id)
    // No timer of the gate's own ends the wait: the host's does.
    jest.advanceTimersByTime(900)
    expect(await waits(waiting)).toBe(true)

    if (row.end === "answer") app.answer()

    if (row.end === "disconnect") app.setConnected(false)

    if (row.end === "dispose") app.dispose()

    if (row.end === "abort") host.abort()

    if (row.end === "ipc") app.setIpc("inactive")
    expect(await waits(waiting)).toBe(false)
  } finally {
    app.dispose()
  }
})

test("a prompt waits for a pane that is still starting, and for one whose server is on this computer while offline", async () => {
  jest.useFakeTimers()
  const restore = network(false)
  const starting = fixture({ ipc: "pending" })
  const local = fixture({ local: true, slow: true })
  const never = new AbortController().signal

  try {
    const first = starting.model.ready(starting.sessions[1], never)
    expect(await waits(first)).toBe(true)
    starting.setIpc("inactive")
    expect(await waits(first)).toBe(false)

    expect(await waits(local.model.ready(local.sessions[1], never))).toBe(true)
  } finally {
    restore()
    starting.dispose()
    local.dispose()
  }
})

// After the app starts only the routed session attaches. One in another tab has nobody to open it when the server
// resumes it, or an automation or a finished job wakes it, and its agent lists the browser tools only once attached.
test("a session in a tab nobody opened attaches once it runs", async () => {
  const app = fixture()
  const session = app.sessions[1]

  try {
    await turns()
    expect(app.registered()).not.toContain(session.id)

    app.run(session.id)
    await turns()
    expect(app.registered()).toContain(session.id)
  } finally {
    app.dispose()
  }
})

// Another window that opens the session takes its browser, and main closes this window's binding as replaced. Nothing
// took it back: the browser left the side panel's launchers and the agent's tools for as long as the app ran, with
// the other window long closed.
test("a session another window took stays on offer, and comes back with the person's prompt, not with a press", async () => {
  const app = fixture()
  const session = app.sessions[0]

  try {
    await turns()
    app.emit(session.id, { tabs: [tab("a")], focusedTabID: tab("a").id })
    // The grant this window's attachment wrote, which the other window's attachment keeps.
    app.hold(session.id, true)
    const first = app.binding(session.id)
    app.send(session.id, { type: "state", state: null, error: "browser.pane.replaced" })
    await turns()
    expect(app.model.attached(session)).toBe(false)
    expect(app.model.openable(session)).toBe(true)

    // A press here must not fail the commands an agent has in flight in the window that holds the session.
    document.dispatchEvent(new Event("pointerdown"))
    await turns()
    expect(app.binding(session.id)).toBe(first)

    void app.model.ready(session, new AbortController().signal)
    await turns()
    expect(app.binding(session.id)).not.toBe(first)
  } finally {
    app.dispose()
  }
})

test("a session another window took attaches again once that window lets it go", async () => {
  const app = fixture()
  const session = app.sessions[0]

  try {
    await turns()
    app.emit(session.id, { tabs: [tab("a")], focusedTabID: tab("a").id })
    app.hold(session.id, true)
    const first = app.binding(session.id)
    app.send(session.id, { type: "state", state: null, error: "browser.pane.replaced" })
    await turns()
    expect(app.binding(session.id)).toBe(first)

    // The other window closed: the server revoked the grant its attachment held.
    app.hold(session.id, false)
    await turns()
    expect(app.binding(session.id)).not.toBe(first)
  } finally {
    app.dispose()
  }
})

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

    // A message main never sent before: the notice names the reload, offers it again, and the code and the action are
    // logged as text, which the desktop log keeps.
    app.rejections.push("something new in main")
    app.model.command(alpha, { type: "reload", tabID: page.id })
    await Bun.sleep(0)
    expect(app.model.failure(alpha, page.id)).toMatchObject({ text: "failed.command.reload", lasting: false })
    expect(app.model.failure(alpha, page.id)?.retry).toBeFunction()
    expect(warned).toHaveBeenCalledWith("[browser] unmapped failure: something new in main (action: reload)")
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
