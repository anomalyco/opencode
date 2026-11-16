import { describe, expect, test } from "bun:test"
import {
  initialPrompts,
  promptHost,
  promptSite,
  promptText,
  selectPrompt,
  transitionPrompts,
  type PromptEvent,
  type PromptState,
  type WaitingRequest,
} from "./prompt-machine"

const replay = (events: readonly PromptEvent[], state: PromptState = initialPrompts) =>
  events.reduce((current, event) => transitionPrompts(current, event).state, state)

const camera: WaitingRequest = {
  kind: "permission",
  key: "https://a.example\ncamera",
  origin: "https://a.example",
  permissions: ["camera"],
  remember: true,
}

const signIn: WaitingRequest = { kind: "auth", key: "https://a.example\nbasic\nAdmin", host: "a.example", realm: "Admin", failed: false }

describe("the queue of what a tab waits for", () => {
  test("joins a repeated identical request instead of stacking it", () => {
    const first = transitionPrompts(initialPrompts, { type: "requested", request: camera })
    const again = transitionPrompts(first.state, { type: "requested", request: camera })

    expect(again.id).toBe(first.id)
    expect(again.state).toBe(first.state)
    expect(again.state.items).toHaveLength(1)
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

describe("who asks", () => {
  test("names a site by its ASCII host, so an international name shows as punycode", () => {
    expect(promptSite("https://bücher.example/a", "https://bücher.example/")).toEqual({
      kind: "web",
      host: "xn--bcher-kva.example",
      embedded: false,
    })
  })

  test("shows the end of every host it names, where the registrable domain is, in one formatter", () => {
    const phish = "https://sso.corp.example.com.auth-portal-session-verify.account-security-check.evil.test:8443/auth"
    const host = promptHost(phish)

    expect(host.length).toBeLessThanOrEqual(64)
    expect(host.endsWith(".evil.test:8443")).toBe(true)
    expect(host.startsWith("…")).toBe(true)
    expect(promptHost("https://bücher.example/")).toBe("xn--bcher-kva.example")
    expect(promptHost("http://127.0.0.1:7821")).toBe("127.0.0.1:7821")
    expect(promptHost("not a url")).toBe("")
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
    expect(promptSite("file:///C:/repo/page.html", "file:///C:/repo/page.html")).toEqual({ kind: "file", host: "", embedded: false })
    expect(promptSite("data:text/html,x", "https://news.example/")).toEqual({ kind: "page", host: "", embedded: true })
  })

  test("drops controls that reorder or hide page text, and bounds it", () => {
    expect(promptText("Pay \u202eevil\u202c now\nok\tdone", 100)).toBe("Pay evil now\nok\tdone")
    expect(promptText("x".repeat(50), 10)).toHaveLength(10)
  })
})
