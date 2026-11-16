import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  createVisit,
  initialPrompts,
  INTENT_MS,
  promptSite,
  promptText,
  selectPrompt,
  transitionPrompts,
  transitionVisit,
  type PromptEvent,
  type PromptState,
  type Visit,
  type VisitEvent,
  type WaitingRequest,
} from "./prompt-machine"

const replay = (events: readonly PromptEvent[], state: PromptState = initialPrompts) =>
  events.reduce((current, event) => transitionPrompts(current, event).state, state)

const replayVisit = (events: readonly VisitEvent[], state: Visit) =>
  events.reduce((current, event) => transitionVisit(current, event).state, state)

const camera: WaitingRequest = {
  kind: "permission",
  key: "https://a.example\ncamera",
  origin: "https://a.example",
  permissions: ["camera"],
  remember: "kept",
  agent: false,
  system: false,
}

const signIn: WaitingRequest = {
  kind: "auth",
  key: "https://a.example\nbasic",
  origin: "https://a.example",
  host: "a.example",
  realm: "Admin",
  failed: false,
  navigation: false,
}

describe("the queue of what a tab waits for", () => {
  test("joins a repeated identical request instead of stacking it, and counts it, so the pane shows it anew", () => {
    const first = transitionPrompts(initialPrompts, { type: "requested", request: camera })
    const again = transitionPrompts(first.state, { type: "requested", request: camera })

    expect(again.id).toBe(first.id)
    expect(again.state.items).toHaveLength(1)
    expect(first.state.items[0]?.asked).toBe(1)
    expect(again.state.items[0]?.asked).toBe(2)
  })

  test("queues other requests and shows a blocking sign-in before older permission requests", () => {
    const state = replay([
      { type: "requested", request: camera },
      { type: "requested", request: { ...camera, key: "https://a.example\nnotifications", permissions: ["notifications"] } },
      { type: "requested", request: signIn },
    ])

    expect(state.items.map((item) => item.id)).toEqual([1, 2, 3])
    expect(selectPrompt(state)?.kind).toBe("auth")
    expect(selectPrompt(replay([{ type: "settled", id: 3 }], state))?.id).toBe(1)
  })

  test("ends what a navigation or close clears exactly once, and settling it later does nothing", () => {
    const state = replay([
      { type: "requested", request: camera },
      { type: "requested", request: signIn },
    ])

    const navigated = transitionPrompts(state, { type: "cleared", kinds: ["auth", "leave"] })

    expect(navigated.ended).toEqual([2])
    expect(navigated.state.items.map((item) => item.kind)).toEqual(["permission"])
    expect(transitionPrompts(navigated.state, { type: "settled", id: 2 }).state).toBe(navigated.state)

    const closed = transitionPrompts(navigated.state, { type: "cleared" })
    expect(closed.ended).toEqual([1])
    expect(transitionPrompts(closed.state, { type: "cleared" }).ended).toEqual([])
  })

  test("gives a new request a new id after the last one settled", () => {
    const settled = replay([{ type: "requested", request: camera }, { type: "settled", id: 1 }])

    expect(transitionPrompts(settled, { type: "requested", request: camera }).id).toBe(2)
  })
})

describe("which prompt shows", () => {
  test("shows Leave site? before a sign-in that waits, so a held close always comes back", () => {
    const state = replay([
      { type: "requested", request: signIn },
      { type: "requested", request: { kind: "leave", key: "leave" } },
    ])

    expect(selectPrompt(state)?.kind).toBe("leave")
  })

  test("ends only the sign-ins of the navigation that stopped", () => {
    const state = replay([
      { type: "requested", request: { ...signIn, navigation: true } },
      { type: "requested", request: { ...signIn, key: "fetch", navigation: false } },
    ])

    const stopped = transitionPrompts(state, { type: "cleared", kinds: ["auth"], navigation: true })

    expect(stopped.ended).toEqual([1])
    expect(stopped.state.items.map((item) => item.key)).toEqual(["fetch"])
  })
})

describe("a tab's visit", () => {
  const start = createVisit("https://bank.example")

  test("follows the top-level navigation through redirects, and forgets it when it stops without committing", () => {
    const pending = replayVisit([{ type: "started", url: "https://intranet.example/" }], start)
    expect(pending.pending).toBe("https://intranet.example/")

    const redirected = replayVisit([{ type: "redirected", url: "https://sso.intranet.example/login" }], pending)
    expect(redirected.pending).toBe("https://sso.intranet.example/login")

    // A 204, a download, a failed or a stopped load: the tab stays on its page.
    const stopped = transitionVisit(redirected, { type: "stopped" })
    expect(stopped.state.pending).toBeUndefined()
    expect(stopped.clear).toEqual({ kinds: ["auth"], navigation: true })
  })

  test("ends the visit when another origin commits", () => {
    const visited = replayVisit(
      [
        { type: "challenged", key: "https://bank.example\nbasic", attempt: 2 },
        { type: "dismissed", origin: "https://bank.example" },
      ],
      start,
    )

    const same = transitionVisit(visited, { type: "committed", origin: "https://bank.example" })
    const other = transitionVisit(visited, { type: "committed", origin: "https://news.example" })

    expect(same.ended).toBe(false)
    expect(same.state.dismissed).toEqual(["https://bank.example"])
    expect(other.ended).toBe(true)
    expect(other.state).toEqual(createVisit("https://news.example"))
  })

  test("lets a user navigation ask the page to confirm, only while it is fresh and nobody else navigated", () => {
    const action = { type: "reload", tabID: Browser.TabID.make("tab_11111111-1111-1111-1111-111111111111") } as const
    const intended = transitionVisit(start, { type: "intended", action, at: 1_000 }).state

    expect(transitionVisit(intended, { type: "unloading", at: 1_000 + INTENT_MS }).leave).toEqual(action)
    expect(transitionVisit(intended, { type: "unloading", at: 1_001 + INTENT_MS }).leave).toBeUndefined()
    const agent = transitionVisit(intended, { type: "intent-ended" }).state
    expect(transitionVisit(agent, { type: "unloading", at: 1_000 }).leave).toBeUndefined()
    // Once asked, the same intent does not ask twice.
    const asked = transitionVisit(intended, { type: "unloading", at: 1_000 }).state
    expect(transitionVisit(asked, { type: "unloading", at: 1_000 }).leave).toBeUndefined()
  })

  test("lets the page go once after the user chose Leave", () => {
    const leaving = transitionVisit(start, { type: "bypassed" }).state
    const unloaded = transitionVisit(leaving, { type: "unloading", at: 0 })

    expect(unloaded.proceed).toBe(true)
    expect(transitionVisit(unloaded.state, { type: "unloading", at: 0 }).proceed).toBe(false)
  })

  test("asks again after a dismissed sign-in only when the user navigates", () => {
    const dismissed = transitionVisit(start, { type: "dismissed", origin: "https://bank.example" }).state
    const byPage = transitionVisit(dismissed, { type: "started", url: "https://bank.example/again" }).state
    expect(byPage.dismissed).toEqual(["https://bank.example"])

    const intended = transitionVisit(dismissed, { type: "intended", action: { type: "close" }, at: 0 }).state
    const byUser = transitionVisit(intended, { type: "started", url: "https://bank.example/again" }).state
    expect(byUser.dismissed).toEqual([])
    expect(byUser.attempts).toEqual({})
  })
})

describe("who asks", () => {
  test("names a site by its ASCII host, so an international name shows as punycode", () => {
    expect(promptSite("https://bücher.example/a", "https://bücher.example/")).toEqual({
      kind: "web",
      host: "xn--bcher-kva.example",
      embedded: false,
    })
  })

  test("keeps the end of a long host, where its own domain is", () => {
    const host = `${"a".repeat(80)}.example.com`
    const site = promptSite(`https://${host}/`, `https://${host}/`)

    expect(site.host).toHaveLength(64)
    expect(site.host.startsWith("…")).toBe(true)
    expect(site.host.endsWith(".example.com")).toBe(true)
  })

  test("marks a frame of another origin as embedded, and names files and pages without a host", () => {
    expect(promptSite("https://ads.example/frame", "https://news.example/").embedded).toBe(true)
    expect(promptSite("https://bank.example/", "https://bank.example/", { origin: "null", main: true })).toEqual({ kind: "page", host: "", embedded: false })
    expect(promptSite("file:///C:/repo/page.html", "file:///C:/repo/page.html")).toEqual({ kind: "file", host: "", embedded: false })
    expect(promptSite("data:text/html,x", "https://news.example/")).toEqual({ kind: "page", host: "", embedded: true })
  })

  test("names a dialog's real origin: a blob's creator, or an embedded page when the origin is opaque", () => {
    expect(promptSite("blob:https://evil.example/6d44", "https://bank.example/")).toEqual({
      kind: "web",
      host: "evil.example",
      embedded: true,
    })
    expect(promptSite("blob:https://bank.example/6d44", "https://bank.example/")).toEqual({ kind: "web", host: "bank.example", embedded: false })
    // An opaque frame inside a local preview is still another document than the page.
    expect(promptSite("data:text/html,x", "file:///C:/repo/page.html")).toEqual({ kind: "page", host: "", embedded: true })
    // The live frame's origin wins over its address: a sandboxed frame at the bank's address is not the bank.
    expect(promptSite("https://bank.example/upload", "https://bank.example/", { origin: "null", main: false })).toEqual({ kind: "page", host: "", embedded: true })
    expect(promptSite("https://bank.example/", "https://bank.example/", { origin: "null", main: true })).toEqual({ kind: "page", host: "", embedded: false })
    expect(promptSite("file:///C:/repo/page.html", "file:///C:/repo/page.html")).toEqual({ kind: "file", host: "", embedded: false })
  })

  test("drops controls that reorder or hide page text, and bounds it", () => {
    expect(promptText("Pay \u202eevil\u202c now\nok\tdone", 100)).toBe("Pay evil now\nok\tdone")
    expect(promptText("x".repeat(50), 10)).toHaveLength(10)
  })
})
