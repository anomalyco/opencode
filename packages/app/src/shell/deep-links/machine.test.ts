import { describe, expect, test } from "bun:test"
import {
  INITIAL_DEEP_LINK_STATE,
  parseDeepLink,
  transitionDeepLinks,
  type DeepLink,
  type DeepLinkEvent,
} from "./machine"

const project = `opencode://open-project?directory=${encodeURIComponent("C:\\work\\api")}`

const session = `opencode://new-session?directory=%2Frepo&prompt=${encodeURIComponent("fix the build")}`

describe("deep links", () => {
  test.each([
    { url: project, link: { type: "open-project", directory: "C:\\work\\api" } },
    { url: "opencode://open-project?directory=/repo", link: { type: "open-project", directory: "/repo" } },
    { url: session, link: { type: "new-session", directory: "/repo", prompt: "fix the build" } },
    {
      url: "opencode://new-session?directory=/repo",
      link: { type: "new-session", directory: "/repo", prompt: undefined },
    },
    { url: "opencode://session/ses_abc123", link: { type: "session", sessionID: "ses_abc123" } },
    { url: "opencode://session", link: undefined },
    { url: "opencode://session/", link: undefined },
    { url: "opencode://session/msg_abc", link: undefined },
    { url: "opencode://session/ses_abc/extra", link: undefined },
    { url: "https://session/ses_abc", link: undefined },
    { url: "opencode://open-project", link: undefined },
    { url: "opencode://open-project?directory=%2Frepo%0A", link: undefined },
    { url: "opencode://console/authorized?window=a", link: undefined },
    { url: "https://open-project?directory=/repo", link: undefined },
    { url: "opencode://open-project/%E0%A4%A%", link: undefined },
  ])("reads $url", ({ url, link }) => {
    expect(parseDeepLink(url)).toEqual(link)
  })

  test("a link that started the app waits for the app's server, then each opens in order", () => {
    const events: DeepLinkEvent[] = [
      { type: "links.received", urls: [project, "opencode://console/authorized?window=a"] },
      { type: "server.lost" },
      { type: "links.received", urls: [session, "opencode://session/ses_abc"] },
      { type: "server.ready" },
    ]

    const result = events.reduce(
      (acc, event) => {
        const next = transitionDeepLinks(acc.state, event)

        return { state: next.state, opened: [...acc.opened, ...next.effects.map((effect) => opened(effect.link))] }
      },
      { state: INITIAL_DEEP_LINK_STATE, opened: new Array<string>() },
    )

    expect(result.opened).toEqual(["C:\\work\\api", "/repo", "ses_abc"])
    expect(result.state).toEqual({ type: "ready" })
  })

  test("while the server is ready a link opens at once, and after it drops links wait again", () => {
    const ready = transitionDeepLinks(INITIAL_DEEP_LINK_STATE, { type: "server.ready" }).state
    const opened = transitionDeepLinks(ready, { type: "links.received", urls: [project] })

    expect(opened.state).toBe(ready)
    expect(opened.effects).toEqual([{ type: "open", link: { type: "open-project", directory: "C:\\work\\api" } }])

    const lost = transitionDeepLinks(ready, { type: "server.lost" }).state
    const waiting = transitionDeepLinks(lost, { type: "links.received", urls: [project] })

    expect(waiting.effects).toEqual([])
    expect(waiting.state).toEqual({ type: "waiting", queued: [{ type: "open-project", directory: "C:\\work\\api" }] })
  })

  test("a link the app doesn't open changes nothing", () => {
    const next = transitionDeepLinks(INITIAL_DEEP_LINK_STATE, { type: "links.received", urls: ["opencode://other"] })

    expect(next.state).toBe(INITIAL_DEEP_LINK_STATE)
    expect(next.effects).toEqual([])
  })
})

const opened = (link: DeepLink) => (link.type === "session" ? link.sessionID : link.directory)
