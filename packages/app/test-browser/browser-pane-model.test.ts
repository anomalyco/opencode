import { expect, test } from "bun:test"
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
    command: async () => undefined,
    inspect: async () => undefined,
    highlight: async () => undefined,
    zoom: async () => undefined,
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

  return { ...owned, sessions, route: setCurrent, refs, emit, send }
}

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
