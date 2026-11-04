import { describe, expect, test } from "bun:test"
import {
  createDeepLinkState,
  transitionDeepLinks,
  type DeepLinkCommand,
  type DeepLinkEvent,
  type DeepLinkState,
} from "./machine"

const oauth = "opencode://console/authorized?window=a"
const oauthB = "opencode://console/authorized?window=b"
const project = "opencode://open?project=/repo"

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly DeepLinkEvent[], from = createDeepLinkState()) {
  return events.reduce<{ state: DeepLinkState; commands: (readonly DeepLinkCommand[])[] }>(
    (result, event) => {
      const next = transitionDeepLinks(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

const ready = (windowID: string, clientID: number): DeepLinkEvent[] => [
  { type: "window.opened", windowID },
  { type: "window.ready", windowID, clientID },
]

describe("deep link delivery", () => {
  test("never hands an acknowledged link to a reloaded or new window", () => {
    const live = replay([
      ...ready("a", 1),
      { type: "window.focused", windowID: "a" },
      { type: "links.received", urls: [oauth, project] },
    ])
    expect(live.commands.at(-1)).toEqual([
      { type: "links.deliver", windowID: "a", clientID: 1, attempt: 1, urls: [oauth, project] },
      { type: "window.focus", windowID: "a" },
    ])

    // View > Reload, then a new window: on dev both booted renderers drained the shared queue again.
    const after = replay(
      [
        { type: "delivery.acknowledged", clientID: 1, attempt: 1 },
        { type: "client.disconnected", clientID: 1 },
        { type: "window.ready", windowID: "a", clientID: 2 },
        ...ready("b", 3),
      ],
      live.state,
    )
    expect(after.commands.flat()).toEqual([])
    expect(after.state.links).toEqual([])
  })

  test("queues a link until the first window is ready", () => {
    const result = replay([{ type: "links.received", urls: [project] }, { type: "window.opened", windowID: "a" }])
    expect(result.commands.flat()).toEqual([])
    expect(result.state.links).toEqual([{ status: "queued", url: project, target: undefined }])

    expect(transitionDeepLinks(result.state, { type: "window.ready", windowID: "a", clientID: 1 }).commands).toEqual([
      { type: "links.deliver", windowID: "a", clientID: 1, attempt: 1, urls: [project] },
    ])
  })

  test("waits for the window a console return names instead of the focused one", () => {
    const result = replay([
      { type: "window.opened", windowID: "a" },
      ...ready("b", 2),
      { type: "window.focused", windowID: "b" },
      { type: "links.received", urls: [oauth] },
    ])
    expect(result.commands.at(-1)).toEqual([{ type: "window.focus", windowID: "a" }])

    expect(transitionDeepLinks(result.state, { type: "window.ready", windowID: "a", clientID: 1 }).commands).toEqual([
      { type: "links.deliver", windowID: "a", clientID: 1, attempt: 1, urls: [oauth] },
    ])
  })

  test("splits one arrival into a batch and attempt per window", () => {
    const result = replay([
      ...ready("b", 2),
      ...ready("c", 3),
      { type: "window.focused", windowID: "c" },
      { type: "links.received", urls: [project, oauthB] },
    ])
    expect(result.commands.at(-1)).toEqual([
      { type: "links.deliver", windowID: "c", clientID: 3, attempt: 1, urls: [project] },
      { type: "links.deliver", windowID: "b", clientID: 2, attempt: 2, urls: [oauthB] },
      { type: "window.focus", windowID: "b" },
    ])
  })

  test("delivers an unacknowledged link again to the next renderer and ignores stale replies", () => {
    const delivered = replay([...ready("a", 1), { type: "links.received", urls: [project] }])

    const reloaded = replay(
      [
        { type: "client.disconnected", clientID: 1 },
        { type: "window.ready", windowID: "a", clientID: 2 },
      ],
      delivered.state,
    )
    expect(reloaded.commands).toEqual([
      [],
      [{ type: "links.deliver", windowID: "a", clientID: 2, attempt: 2, urls: [project] }],
    ])

    const stale: DeepLinkEvent[] = [
      { type: "delivery.acknowledged", clientID: 1, attempt: 1 },
      { type: "delivery.acknowledged", clientID: 2, attempt: 1 },
      { type: "delivery.acknowledged", clientID: 1, attempt: 2 },
      { type: "client.disconnected", clientID: 1 },
      { type: "window.ready", windowID: "a", clientID: 2 },
    ]
    stale.forEach((event) => {
      const next = transitionDeepLinks(reloaded.state, event)
      expect(next.state).toBe(reloaded.state)
      expect(next.commands).toEqual([])
    })
  })

  test("sends links for a closed window to the focused one, as before", () => {
    const result = replay([
      { type: "window.opened", windowID: "a" },
      ...ready("b", 2),
      { type: "links.received", urls: [oauth] },
      { type: "window.closed", windowID: "a" },
    ])
    expect(result.commands.at(-1)).toEqual([
      { type: "links.deliver", windowID: "b", clientID: 2, attempt: 1, urls: [oauth] },
    ])
  })

  test("follows focus to a ready window while the focused one loads", () => {
    const result = replay([
      { type: "window.opened", windowID: "a" },
      { type: "window.focused", windowID: "a" },
      ...ready("b", 2),
      { type: "links.received", urls: [project] },
      { type: "window.focused", windowID: "b" },
    ])
    expect(result.commands.at(-2)).toEqual([{ type: "window.focus", windowID: "a" }])
    expect(result.commands.at(-1)).toEqual([
      { type: "links.deliver", windowID: "b", clientID: 2, attempt: 1, urls: [project] },
    ])
  })

  test("adopts a window whose renderer reports ready before it registers", () => {
    const result = replay([
      { type: "window.ready", windowID: "a", clientID: 1 },
      { type: "window.opened", windowID: "a" },
    ])
    expect(result.state.windows).toEqual({ a: { status: "ready", clientID: 1 } })
  })
})
