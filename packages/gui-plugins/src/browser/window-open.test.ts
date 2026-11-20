import { expect, test } from "bun:test"
import { ACTIVATION_LIFESPAN_MS, windowOpening } from "./window-open"

const url = "https://docs.example/guide"

type Request = Parameters<typeof windowOpening>[0]

// The person pressed a moment ago in a web page they drive, and Chromium reported no `window.open`.
const pressed: Request = { artifact: false, openable: true, url, disposition: "background-tab", report: undefined, owner: "user", pressedAt: 1_000, at: 1_100 }

const gesture = { url, userGesture: true }

const behind = { type: "open", background: true } as const

const front = { type: "open", background: false } as const

const block = { type: "block" } as const

const rows: readonly (readonly [name: string, request: Partial<Request>, expected: ReturnType<typeof windowOpening>])[] = [
  // The person's own click on a link, which Chromium routes by its button and modifiers with no gesture report.
  ["the person's middle-click or Ctrl+click opens a tab behind", { disposition: "background-tab" }, behind],
  ["the person's Ctrl+Shift+click or Shift+middle-click opens a tab in front", { disposition: "foreground-tab" }, front],
  ["the person's Shift+click, a new window in Chrome, opens a tab in front", { disposition: "new-window" }, front],
  ["the person's press still counts at the end of Chromium's activation lifetime", { pressedAt: 0, at: ACTIVATION_LIFESPAN_MS }, behind],
  ["the person's press no longer counts after it", { pressedAt: 0, at: ACTIVATION_LIFESPAN_MS + 1 }, block],
  // What Chromium reports itself: `window.open` and `target="_blank"`, by anyone's click.
  ['a clicked target="_blank" link or window.open opens a tab in front', { disposition: "foreground-tab", report: gesture }, front],
  ["window.open from a Ctrl+click opens a tab behind", { disposition: "background-tab", report: gesture }, behind],
  ["window.open with features from a click opens a tab in front", { disposition: "new-window", report: gesture }, front],
  ["the agent's click on a target=\"_blank\" link opens its tab as before", { disposition: "foreground-tab", report: gesture, owner: "agent", pressedAt: undefined }, front],
  // No user gesture: a blocked pop-up, whatever the person pressed before.
  ["window.open on load or on a timer is blocked", { disposition: "foreground-tab", report: { url, userGesture: false } }, block],
  ["a gesture reported for another address is blocked", { disposition: "foreground-tab", report: { url: `${url}/other`, userGesture: true } }, block],
  ["a Shift+click the page makes up with nobody's press is blocked", { disposition: "new-window", pressedAt: undefined }, block],
  // The agent's input is not the person's, even right after the person's own press.
  ["the agent's middle-click or Ctrl+click is blocked", { disposition: "background-tab", owner: "agent" }, block],
  ["the agent's Ctrl+Shift+click is blocked", { disposition: "foreground-tab", owner: "agent" }, block],
  ["the agent's Shift+click is blocked", { disposition: "new-window", owner: "agent" }, block],
  ["the agent's window.open with no gesture is blocked", { disposition: "foreground-tab", owner: "agent", report: { url, userGesture: false } }, block],
  // A preview and an extension's page follow the web page's rule for what a tab can show.
  ["a middle-click in a preview on a link to another workspace file opens a tab behind", { url: "oc-preview://host/notes.html" }, behind],
  ["a middle-click in an extension's page on a link to its own page opens a tab behind", { url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html" }, behind],
  ["a middle-click on a link no tab shows, such as another app's or another extension's, is answered as a click on it", { url: "mailto:someone@example.test", openable: false }, { type: "refuse" }],
  ["the agent's middle-click on such a link is answered the same way", { url: "mailto:someone@example.test", openable: false, owner: "agent" }, { type: "refuse" }],
  // An artifact opens nothing by itself: its link is offered, however it was pressed.
  ["a middle-click in an artifact asks before it opens", { artifact: true }, { type: "ask" }],
  ["a clicked target=\"_blank\" link in an artifact asks before it opens", { artifact: true, disposition: "foreground-tab", report: gesture }, { type: "ask" }],
  ["window.open with no gesture in an artifact asks before it opens", { artifact: true, disposition: "foreground-tab", report: { url, userGesture: false } }, { type: "ask" }],
  ["the agent's middle-click in an artifact asks before it opens", { artifact: true, owner: "agent" }, { type: "ask" }],
]

test.each(rows)("%s", (_name, request, expected) => {
  expect(windowOpening({ ...pressed, ...request })).toEqual(expected)
})
