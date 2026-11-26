import { describe, expect, test } from "bun:test"
import {
  INITIAL_DEEP_LINK_STATE,
  parseDeepLink,
  transitionDeepLinks,
  type DeepLinkEffect,
  type DeepLinkEvent,
} from "./machine"

const project = `opencode://open-project?directory=${encodeURIComponent("C:\\work\\api")}`

const session = `opencode://new-session?directory=%2Frepo&prompt=${encodeURIComponent("fix the build")}`

const ready = transitionDeepLinks(INITIAL_DEEP_LINK_STATE, { type: "server.ready" }).state

const replay = (events: readonly DeepLinkEvent[], from = INITIAL_DEEP_LINK_STATE) =>
  events.reduce(
    (acc, event) => {
      const next = transitionDeepLinks(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state: from, effects: new Array<DeepLinkEffect>() },
  )

const opened = (effects: readonly DeepLinkEffect[]) =>
  effects.flatMap((effect) => (effect.type === "open" ? [effect.link.directory] : []))

const asked = (effects: readonly DeepLinkEffect[]) =>
  effects.flatMap((effect) => (effect.type === "ask" ? [effect.attempt] : []))

describe("deep links", () => {
  test.each([
    { url: project, link: { type: "open-project", directory: "C:\\work\\api" } },
    { url: "opencode://open-project?directory=/repo", link: { type: "open-project", directory: "/repo" } },
    { url: "opencode://open-project?directory=C:/work/api", link: { type: "open-project", directory: "C:/work/api" } },
    { url: session, link: { type: "new-session", directory: "/repo", prompt: "fix the build" } },
    {
      url: "opencode://new-session?directory=/repo",
      link: { type: "new-session", directory: "/repo", prompt: undefined },
    },
    { url: "opencode://open-project", link: undefined },
    { url: "opencode://open-project?directory=%2Frepo%0A", link: undefined },
    { url: "opencode://open-project?directory=%2Frepo%E2%80%AE", link: undefined },
    { url: "opencode://open-project?directory=repo", link: undefined },
    { url: "opencode://open-project?directory=~%2Frepo", link: undefined },
    { url: "opencode://open-project?directory=C%3Arepo", link: undefined },
    { url: "opencode://open-project?directory=%5Crepo", link: undefined },
    { url: "opencode://open-project?directory=%2Frepo%2F..%2F..%2Fnet%2Fhost", link: undefined },
    { url: "opencode://open-project?directory=%5C%5Chost%5Cshare", link: undefined },
    { url: "opencode://open-project?directory=%5C%5C%3F%5CUNC%5Chost%5Cshare", link: undefined },
    { url: "opencode://open-project?directory=%2F%2Fhost%2Fshare", link: undefined },
    { url: "opencode://open-project?directory=%2F%5Chost%5Cshare", link: undefined },
    { url: "opencode://open-project?directory=%2FNet%2Fhost%2Fshare", link: undefined },
    { url: "opencode://open-project?directory=file%3A%2F%2Fhost%2Fshare", link: undefined },
    { url: "opencode://console/authorized?window=a", link: undefined },
    { url: "https://open-project?directory=/repo", link: undefined },
    { url: "opencode://open-project/%E0%A4%A%", link: undefined },
  ])("reads $url", ({ url, link }) => {
    expect(parseDeepLink(url)).toEqual(link)
  })

  test("a link opens nothing until the user accepts its folder", () => {
    const received = transitionDeepLinks(ready, { type: "links.received", urls: [project] })

    expect(received.effects).toEqual([
      { type: "ask", attempt: 1, link: { type: "open-project", directory: "C:\\work\\api" } },
    ])

    const accepted = transitionDeepLinks(received.state, { type: "link.accepted", attempt: 1 })

    expect(accepted.effects).toEqual([{ type: "open", link: { type: "open-project", directory: "C:\\work\\api" } }])
    expect(accepted.state).toEqual({ confirm: { status: "idle", attempt: 1 }, server: { status: "ready" } })
  })

  test("a declined link never opens, and the next link is asked about on its own", () => {
    const result = replay(
      [
        { type: "links.received", urls: [project, session] },
        { type: "link.declined", attempt: 1 },
        { type: "link.accepted", attempt: 2 },
      ],
      ready,
    )

    expect(asked(result.effects)).toEqual([1, 2])
    expect(opened(result.effects)).toEqual(["/repo"])
  })

  test("the closed dialog's late decline doesn't decline the link asked about after it", () => {
    const result = replay(
      [
        { type: "links.received", urls: [project, session] },
        { type: "link.accepted", attempt: 1 },
        { type: "link.declined", attempt: 1 },
        { type: "link.accepted", attempt: 1 },
      ],
      ready,
    )

    expect(opened(result.effects)).toEqual(["C:\\work\\api"])
    expect(result.state.confirm).toMatchObject({ status: "asking", attempt: 2 })
  })

  test("a link that started the app is asked about at once, and opens once the app's server is ready", () => {
    const result = replay([
      { type: "links.received", urls: [project, "opencode://console/authorized?window=a"] },
      { type: "server.lost" },
      { type: "link.accepted", attempt: 1 },
      { type: "links.received", urls: [session] },
      { type: "link.accepted", attempt: 2 },
    ])

    expect(asked(result.effects)).toEqual([1, 2])
    expect(opened(result.effects)).toEqual([])

    const served = transitionDeepLinks(result.state, { type: "server.ready" })

    expect(opened(served.effects)).toEqual(["C:\\work\\api", "/repo"])
    expect(served.state).toEqual({ confirm: { status: "idle", attempt: 2 }, server: { status: "ready" } })
  })

  test("after the server drops, an accepted link waits for it again", () => {
    const lost = transitionDeepLinks(ready, { type: "server.lost" }).state

    const result = replay(
      [
        { type: "links.received", urls: [project] },
        { type: "link.accepted", attempt: 1 },
      ],
      lost,
    )

    expect(opened(result.effects)).toEqual([])
    expect(result.state.server).toEqual({
      status: "waiting",
      accepted: [{ type: "open-project", directory: "C:\\work\\api" }],
    })
  })

  test("a link the app doesn't open changes nothing", () => {
    const next = transitionDeepLinks(INITIAL_DEEP_LINK_STATE, {
      type: "links.received",
      urls: ["opencode://other", "opencode://open-project?directory=%5C%5Chost%5Cshare"],
    })

    expect(next.state).toBe(INITIAL_DEEP_LINK_STATE)
    expect(next.effects).toEqual([])
  })
})
