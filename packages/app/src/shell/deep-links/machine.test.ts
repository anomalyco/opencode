import { describe, expect, test } from "bun:test"
import {
  INITIAL_DEEP_LINK_STATE,
  parseDeepLink,
  transitionDeepLinks,
  type DeepLink,
  type DeepLinkEffect,
  type DeepLinkEvent,
} from "./machine"

const project = `opencode://open-project?directory=${encodeURIComponent("C:\\work\\api")}`

const session = `opencode://new-session?directory=%2Frepo&prompt=${encodeURIComponent("fix the build")}`

const sessionLink = "opencode://session/ses_abc123"

const remoteSessionLink = `opencode://session/ses_sub_456?server=${encodeURIComponent("http://100.73.96.98:4097/")}`

const ready = transitionDeepLinks(INITIAL_DEEP_LINK_STATE, { type: "server.ready" }).state

const sessionsReady = transitionDeepLinks(INITIAL_DEEP_LINK_STATE, { type: "sessions.ready" }).state

const replay = (events: readonly DeepLinkEvent[], from = INITIAL_DEEP_LINK_STATE) =>
  events.reduce(
    (acc, event) => {
      const next = transitionDeepLinks(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state: from, effects: new Array<DeepLinkEffect>() },
  )

const openedDirectories = (effects: readonly DeepLinkEffect[]) =>
  effects.flatMap((effect) => (effect.type === "open" && effect.link.type !== "session" ? [effect.link.directory] : []))

const openedSessions = (effects: readonly DeepLinkEffect[]) =>
  effects.flatMap((effect) => (effect.type === "open" && effect.link.type === "session" ? [effect.link] : []))

const asked = (effects: readonly DeepLinkEffect[]) =>
  effects.flatMap((effect) => (effect.type === "ask" ? [effect.attempt] : []))

describe("deep links", () => {
  const cases: Array<{ url: string; link: DeepLink | undefined }> = [
    { url: project, link: { type: "open-project", directory: "C:\\work\\api" } },
    { url: "opencode://open-project?directory=/repo", link: { type: "open-project", directory: "/repo" } },
    { url: "opencode://open-project?directory=C:/work/api", link: { type: "open-project", directory: "C:/work/api" } },
    { url: session, link: { type: "new-session", directory: "/repo", prompt: "fix the build" } },
    {
      url: "opencode://new-session?directory=/repo",
      link: { type: "new-session", directory: "/repo", prompt: undefined },
    },
    { url: sessionLink, link: { type: "session", sessionID: "ses_abc123", server: undefined } },
    { url: "opencode://session/ses_abc123/", link: { type: "session", sessionID: "ses_abc123", server: undefined } },
    {
      url: remoteSessionLink,
      link: { type: "session", sessionID: "ses_sub_456", server: "http://100.73.96.98:4097" },
    },
    {
      url: `opencode://session/ses_abc123?server=${encodeURIComponent("HTTPS://Example.COM:443/api///")}`,
      link: { type: "session", sessionID: "ses_abc123", server: "https://example.com/api" },
    },
    { url: "opencode://session", link: undefined },
    { url: "opencode://session/", link: undefined },
    { url: "opencode://session/ses_abc123/extra", link: undefined },
    { url: "opencode://session/ses_abc123//", link: undefined },
    { url: "opencode://session/../ses_abc123", link: undefined },
    { url: "opencode://session/a/../ses_abc123", link: undefined },
    { url: "opencode://session/..", link: undefined },
    { url: "opencode://session/.", link: undefined },
    { url: "opencode://session/%2e%2e", link: undefined },
    { url: "opencode://session/ses%2F123", link: undefined },
    { url: "opencode://session/ses%5C123", link: undefined },
    { url: "opencode://session/ses_123%0A", link: undefined },
    { url: "opencode://session/ses_123%E2%80%AE", link: undefined },
    { url: "opencode://session/ses%20123", link: undefined },
    { url: `opencode://session/${"a".repeat(257)}`, link: undefined },
    { url: "opencode://session/%E0%A4%A%", link: undefined },
    { url: "opencode://session/ses_123?server=", link: undefined },
    { url: "opencode://session/ses_123?server=not-a-url", link: undefined },
    { url: "opencode://session/ses_123?server=javascript%3Aalert(1)", link: undefined },
    { url: "opencode://session/ses_123?server=file%3A%2F%2F%2Fetc%2Fpasswd", link: undefined },
    { url: "opencode://session/ses_123?server=http%3A%2F%2Fuser%3Apass%40example.com", link: undefined },
    { url: "opencode://session/ses_123?server=http%3A%2F%2Fexample.com%3Ffoo%3Dbar", link: undefined },
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
    { url: "opencode://open?project=/repo", link: undefined },
    { url: "https://open-project?directory=/repo", link: undefined },
    { url: "https://session/ses_123", link: undefined },
    { url: "opencode://open-project/%E0%A4%A%", link: undefined },
  ]

  test.each(cases)("reads $url", ({ url, link }) => {
    expect(parseDeepLink(url)).toEqual(link)
  })

  test("a link opens nothing until the user accepts its folder", () => {
    const received = transitionDeepLinks(ready, { type: "links.received", urls: [project] })

    expect(received.effects).toEqual([
      { type: "ask", attempt: 1, link: { type: "open-project", directory: "C:\\work\\api" } },
    ])

    const accepted = transitionDeepLinks(received.state, { type: "link.accepted", attempt: 1 })

    expect(accepted.effects).toEqual([{ type: "open", link: { type: "open-project", directory: "C:\\work\\api" } }])
    expect(accepted.state).toEqual({
      confirm: { status: "idle", attempt: 1 },
      server: { status: "ready" },
      sessions: { status: "waiting", queued: [] },
    })
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
    expect(openedDirectories(result.effects)).toEqual(["/repo"])
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

    expect(openedDirectories(result.effects)).toEqual(["C:\\work\\api"])
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
    expect(openedDirectories(result.effects)).toEqual([])

    const served = transitionDeepLinks(result.state, { type: "server.ready" })

    expect(openedDirectories(served.effects)).toEqual(["C:\\work\\api", "/repo"])
    expect(served.state).toEqual({
      confirm: { status: "idle", attempt: 2 },
      server: { status: "ready" },
      sessions: { status: "waiting", queued: [] },
    })
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

    expect(openedDirectories(result.effects)).toEqual([])
    expect(result.state.server).toEqual({
      status: "waiting",
      accepted: [{ type: "open-project", directory: "C:\\work\\api" }],
    })
  })

  test("session links open directly when servers are ready without asking for confirmation", () => {
    const received = transitionDeepLinks(sessionsReady, {
      type: "links.received",
      urls: [sessionLink, remoteSessionLink, "opencode://console/authorized?window=a"],
    })

    expect(asked(received.effects)).toEqual([])
    expect(openedSessions(received.effects)).toEqual([
      { type: "session", sessionID: "ses_abc123", server: undefined },
      { type: "session", sessionID: "ses_sub_456", server: "http://100.73.96.98:4097" },
    ])
  })

  test("session links received before servers are ready wait and open in order once ready", () => {
    const queued = replay([
      { type: "links.received", urls: [sessionLink, project] },
      { type: "links.received", urls: [remoteSessionLink] },
    ])

    expect(asked(queued.effects)).toEqual([1])
    expect(openedSessions(queued.effects)).toEqual([])

    const readyResult = transitionDeepLinks(queued.state, { type: "sessions.ready" })

    expect(openedSessions(readyResult.effects)).toEqual([
      { type: "session", sessionID: "ses_abc123", server: undefined },
      { type: "session", sessionID: "ses_sub_456", server: "http://100.73.96.98:4097" },
    ])
    expect(readyResult.state.sessions).toEqual({ status: "ready" })

    const lost = transitionDeepLinks(readyResult.state, { type: "sessions.lost" }).state
    const queuedAgain = transitionDeepLinks(lost, { type: "links.received", urls: [sessionLink] })
    expect(openedSessions(queuedAgain.effects)).toEqual([])
    expect(queuedAgain.state.sessions).toEqual({
      status: "waiting",
      queued: [{ type: "session", sessionID: "ses_abc123", server: undefined }],
    })
  })

  test("a link the app doesn't open changes nothing", () => {
    const next = transitionDeepLinks(INITIAL_DEEP_LINK_STATE, {
      type: "links.received",
      urls: ["opencode://other", "opencode://open-project?directory=%5C%5Chost%5Cshare", "opencode://session/../bad"],
    })

    expect(next.state).toBe(INITIAL_DEEP_LINK_STATE)
    expect(next.effects).toEqual([])
  })
})
