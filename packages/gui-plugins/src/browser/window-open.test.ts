import { expect, test } from "bun:test"
import { ACTIVATION_LIFESPAN_MS, clickDisposition, closesUnshown, windowOpening, type Press, type Unshown } from "./window-open"

const url = "https://docs.example/guide"

const other = "https://ads.example/offer"

type Request = Parameters<typeof windowOpening>[0]

const left: Press = { type: "mouse", button: "left", at: 1_000 }

const middle: Press = { type: "mouse", button: "middle", at: 1_000 }

const enter = (disposition: ReturnType<typeof clickDisposition>): Press => ({ type: "key", disposition, at: 1_000 })

// The person just pressed a link in a web page they drive: Chromium reported the link's navigation to a new tab, the
// link is under the pointer, and no `window.open` was reported.
const pressed: Request = {
  artifact: false,
  openable: true,
  url,
  disposition: "background-tab",
  report: undefined,
  link: { url },
  hovered: url,
  owner: "user",
  press: left,
  at: 1_100,
}

const gesture = { url, userGesture: true }

const behind = { type: "open", background: true } as const

const front = { type: "open", background: false } as const

const block = { type: "block" } as const

const rows: readonly (readonly [name: string, request: Partial<Request>, expected: ReturnType<typeof windowOpening>])[] = [
  // The person's own press on a link, which Chromium routes by its button and modifiers with no gesture report.
  ["the person's middle-click opens a tab behind", { press: middle }, behind],
  ["the person's Ctrl+click opens a tab behind", { press: left }, behind],
  ["a middle-click still opens behind when the page changed the link's address as it was pressed", { press: middle, hovered: other }, behind],
  ["the person's Ctrl+Shift+click opens a tab in front", { disposition: "foreground-tab" }, front],
  ["the person's Shift+middle-click opens a tab in front", { press: middle, disposition: "foreground-tab" }, front],
  ["the person's Shift+click, a new window in Chrome, opens a tab in front", { disposition: "new-window" }, front],
  ["the person's Ctrl+Enter on a link opens a tab behind", { press: enter("background-tab"), hovered: "" }, behind],
  ["the person's Ctrl+Shift+Enter opens a tab in front", { press: enter("foreground-tab"), disposition: "foreground-tab", hovered: "" }, front],
  ["the person's Shift+Enter opens a tab in front", { press: enter("new-window"), disposition: "new-window", hovered: "" }, front],
  ["the press still counts at the end of Chromium's activation lifetime", { press: { ...left, at: 0 }, at: ACTIVATION_LIFESPAN_MS }, behind],
  ["the press no longer counts after it", { press: { ...left, at: 0 }, at: ACTIVATION_LIFESPAN_MS + 1 }, block],
  // Not the link the person pressed. A request with no clicked-link report is no link: `window.open` whose own report
  // is missing gets nothing from a press, whatever it asks for.
  ["window.open with no report right after a press is blocked", { disposition: "foreground-tab", link: undefined }, block],
  ["window.open with features and no report right after a press is blocked", { disposition: "new-window", link: undefined }, block],
  ["a request with no clicked-link report is blocked even behind", { link: undefined }, block],
  ["a clicked-link report for another address is blocked", { link: { url: other } }, block],
  ["a click the page makes up for a tab in front, with the pointer on no link, is blocked", { disposition: "foreground-tab", hovered: "" }, block],
  ["a click the page makes up for a tab in front on another link than the pointer's is blocked", { disposition: "foreground-tab", hovered: other }, block],
  ["a Shift+click the page makes up on another link than the pointer's is blocked", { disposition: "new-window", hovered: other }, block],
  ["a new window after a middle press, which never asks for one, is blocked", { press: middle, disposition: "new-window" }, block],
  ["a click the page makes up after a plain Enter is blocked", { press: enter(undefined), disposition: "foreground-tab" }, block],
  ["a tab in front after Ctrl+Enter, which asks for one behind, is blocked", { press: enter("background-tab"), disposition: "foreground-tab" }, block],
  ["a request with nobody's press, or after a press a request already used, is blocked", { press: undefined }, block],
  // What Chromium reports itself: `window.open` and `target="_blank"`, by anyone's click. The report alone decides.
  ['a clicked target="_blank" link or window.open opens a tab in front', { disposition: "foreground-tab", report: gesture, link: undefined }, front],
  ["window.open from a Ctrl+click opens a tab behind", { disposition: "background-tab", report: gesture, link: undefined }, behind],
  ["window.open with features from a click opens a tab in front", { disposition: "new-window", report: gesture, link: undefined }, front],
  ["the agent's click on a target=\"_blank\" link opens its tab as before", { disposition: "foreground-tab", report: gesture, link: undefined, owner: "agent", press: undefined }, front],
  ["window.open with no gesture is blocked, right after a press too", { disposition: "foreground-tab", report: { url, userGesture: false } }, block],
  ["a gesture reported for another address is blocked", { disposition: "foreground-tab", report: { url: other, userGesture: true } }, block],
  // The agent's input is not the person's, even right after the person's own press.
  ["the agent's middle-click or Ctrl+click is blocked", { owner: "agent" }, block],
  ["the agent's Ctrl+Shift+click is blocked", { disposition: "foreground-tab", owner: "agent" }, block],
  ["the agent's Shift+click is blocked", { disposition: "new-window", owner: "agent" }, block],
  ["the agent's window.open with no gesture is blocked", { disposition: "foreground-tab", owner: "agent", report: { url, userGesture: false } }, block],
  // A preview and an extension's page follow the web page's rule for what a tab can show.
  ["a middle-click in a preview on a link to another workspace file opens a tab behind", { press: middle }, behind],
  ["a middle-click on a link no tab shows, such as another app's or another extension's, is answered as a click on it", { press: middle, openable: false }, { type: "refuse" }],
  ["the agent's middle-click on such a link is answered the same way", { openable: false, owner: "agent" }, { type: "refuse" }],
  // An artifact opens nothing by itself: its link is offered, however it was pressed.
  ["a middle-click in an artifact asks before it opens", { artifact: true, press: middle }, { type: "ask" }],
  ["a clicked target=\"_blank\" link in an artifact asks before it opens", { artifact: true, disposition: "foreground-tab", report: gesture }, { type: "ask" }],
  ["window.open with no gesture in an artifact asks before it opens", { artifact: true, disposition: "foreground-tab", report: { url, userGesture: false } }, { type: "ask" }],
  ["the agent's middle-click in an artifact asks before it opens", { artifact: true, owner: "agent" }, { type: "ask" }],
]

test.each(rows)("%s", (_name, request, expected) => {
  expect(windowOpening({ ...pressed, ...request })).toEqual(expected)
})

test("Chromium opens a link by its click's button and modifiers, with Cmd in place of Ctrl on macOS", () => {
  const plain = { middle: false, control: false, meta: false, shift: false }
  expect(clickDisposition(plain, false)).toBeUndefined()
  expect(clickDisposition({ ...plain, middle: true }, false)).toBe("background-tab")
  expect(clickDisposition({ ...plain, control: true }, false)).toBe("background-tab")
  expect(clickDisposition({ ...plain, control: true, shift: true }, false)).toBe("foreground-tab")
  expect(clickDisposition({ ...plain, middle: true, shift: true }, false)).toBe("foreground-tab")
  expect(clickDisposition({ ...plain, shift: true }, false)).toBe("new-window")
  expect(clickDisposition({ ...plain, meta: true }, false)).toBeUndefined()
  expect(clickDisposition({ ...plain, meta: true }, true)).toBe("background-tab")
  expect(clickDisposition({ ...plain, control: true }, true)).toBeUndefined()
})

// A tab the person's link opened, which has shown no document yet.
const unshown = { opened: true, committed: false, owner: "user" } as const

const leaving: readonly (readonly [name: string, tab: Partial<Parameters<typeof closesUnshown>[0]>, outcome: Unshown, closes: boolean])[] = [
  ["a new tab whose first navigation became a download closes once the download has its place", {}, "download", true],
  ["it stays while the person is still choosing where to save", {}, "download.choosing", false],
  ["a new tab whose first navigation went to another app closes", {}, "app", true],
  ["a new tab whose first navigation was refused stays, with its notice", {}, "refused", false],
  ["a tab that has shown a document stays when a download starts in it", { committed: true }, "download", false],
  ["a tab that has shown a document stays when it is sent to another app", { committed: true }, "app", false],
  ["a tab no page opened stays when the address typed into it downloads", { opened: false }, "download", false],
  ["a tab no page opened stays when it is sent to another app", { opened: false }, "app", false],
  ["the agent's new tab keeps its download and stays", { owner: "agent" }, "download", false],
  ["the agent's new tab stays when it is sent to another app", { owner: "agent" }, "app", false],
]

test.each(leaving)("%s", (_name, tab, outcome, closes) => {
  expect(closesUnshown({ ...unshown, ...tab }, outcome)).toBe(closes)
})
