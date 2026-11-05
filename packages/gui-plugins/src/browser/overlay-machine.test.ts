import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  capturesEscape,
  initialOverlayState,
  overlayComment,
  overlayView,
  transitionOverlay,
  type OverlayContext,
  type OverlayEffect,
  type OverlayEvent,
  type OverlayState,
  type OverlayTransition,
} from "./overlay-machine"

// Folds the events in order and returns the last transition.
const replay = (events: readonly OverlayEvent[], state: OverlayState = initialOverlayState) =>
  events.reduce<OverlayTransition>((last, event) => transitionOverlay(last.state, event), { state, effects: [] })

const alpha = Browser.TabID.make("tab_11111111-1111-1111-1111-111111111111")

const beta = Browser.TabID.make("tab_22222222-1111-1111-1111-111111111111")

const tab = (id = alpha, generation = 0) => ({ id, url: "https://alpha.example/", title: "Alpha", generation })

const context = (overrides: Partial<OverlayContext> = {}): OverlayContext => ({
  sessionKey: "Alpha",
  tab: tab(),
  visible: true,
  inspectable: true,
  ...overrides,
})

const element = {
  ref: Browser.Ref.make("e7"),
  selector: "main > button.primary",
  label: "button.primary",
  rect: { x: 48, y: 40, width: 160, height: 36 },
}

const confirmed: OverlayEvent = {
  type: "inspect.reported",
  sessionKey: "Alpha",
  tabID: alpha,
  active: true,
  context: context(),
}

const picked: OverlayEvent = {
  type: "inspect.reported",
  sessionKey: "Alpha",
  tabID: alpha,
  active: false,
  element,
  context: context(),
}

const picking = () => replay([{ type: "picker.toggled", context: context() }, confirmed]).state

describe("the picker shows as on only once main confirms it", () => {
  test("an unanswered request keeps the button up and leaves Escape to the app", () => {
    const requested = transitionOverlay(initialOverlayState, { type: "picker.toggled", context: context() })

    expect(requested.state).toEqual({ status: "idle" })
    expect(requested.effects).toEqual([{ type: "set-inspect", sessionKey: "Alpha", tabID: alpha, enabled: true }])
    expect(overlayView(requested.state, "Alpha", alpha).picking).toBe(false)
    expect(capturesEscape(requested.state)).toBe(false)
    expect(transitionOverlay(requested.state, { type: "escape.pressed" }).state).toBe(requested.state)

    const started = transitionOverlay(requested.state, confirmed)
    expect(overlayView(started.state, "Alpha", alpha).picking).toBe(true)
    expect(capturesEscape(started.state)).toBe(true)
  })

  test("every way out of the picker leaves it at once and tells main", () => {
    const off: OverlayEffect = { type: "set-inspect", sessionKey: "Alpha", tabID: alpha, enabled: false }

    const exits: OverlayEvent[] = [
      { type: "escape.pressed" },
      { type: "picker.toggled", context: context() },
      { type: "context.changed", context: context({ visible: false }) },
      { type: "context.changed", context: context({ inspectable: false }) },
      { type: "context.changed", context: context({ tab: tab(beta) }) },
      { type: "context.changed", context: context({ sessionKey: "Beta" }) },
      { type: "disposed" },
    ]

    exits.forEach((event) => {
      const next = transitionOverlay(picking(), event)
      expect(capturesEscape(next.state)).toBe(false)
      expect(next.effects).toEqual([off])
    })

    const noting = transitionOverlay(picking(), { type: "note.opened", context: context() })
    expect(noting.state.status).toBe("noting")
    expect(noting.effects).toEqual([off])
  })

  test("a picker main starts on a page the user does not see stops again", () => {
    const hidden = transitionOverlay(initialOverlayState, { ...confirmed, context: context({ visible: false }) })
    const other = transitionOverlay(initialOverlayState, { ...confirmed, context: context({ tab: tab(beta) }) })

    expect(hidden.state.status).toBe("idle")
    expect(hidden.effects).toEqual([{ type: "set-inspect", sessionKey: "Alpha", tabID: alpha, enabled: false }])
    expect(other.state.status).toBe("idle")
  })

  test("main stopping the picker leaves it", () => {
    const stopped = transitionOverlay(picking(), { ...confirmed, active: false })

    expect(stopped.state.status).toBe("idle")
    expect(stopped.effects).toEqual([])
  })
})

describe("one overlay at a time", () => {
  test("a pick that lands while a page note is open replaces the note", () => {
    const noting = replay([
      { type: "note.opened", context: context() },
      { type: "draft.changed", value: "Header" },
    ])

    const commenting = transitionOverlay(noting.state, picked)

    expect(commenting.state.status).toBe("commenting")
    expect(overlayView(commenting.state, "Alpha", alpha)).toMatchObject({ frozen: true, picking: false })
    expect(commenting.effects).toEqual([])
  })

  test("a page note replaces a comment and clears its highlight", () => {
    const commenting = transitionOverlay(picking(), picked).state
    const noting = transitionOverlay(commenting, { type: "note.opened", context: context() })

    expect(noting.state.status).toBe("noting")
    expect(noting.effects).toEqual([{ type: "clear-highlight", sessionKey: "Alpha", tabID: alpha }])
  })

  test("opening the note again keeps its draft", () => {
    const noting = replay([
      { type: "note.opened", context: context() },
      { type: "draft.changed", value: "Header" },
    ])

    expect(transitionOverlay(noting.state, { type: "note.opened", context: context() }).state).toBe(noting.state)
  })

  test("a pick on a page no longer shown clears its highlight and opens nothing", () => {
    const result = transitionOverlay(picking(), { ...picked, context: context({ tab: tab(beta) }) })

    expect(result.state.status).toBe("idle")
    expect(result.effects).toEqual([{ type: "clear-highlight", sessionKey: "Alpha", tabID: alpha }])
  })
})

describe("comments", () => {
  const commenting = () => transitionOverlay(picking(), picked).state

  test("attach the element's ref while the page is the one it was picked on", () => {
    const submitted = replay(
      [
        { type: "draft.changed", value: "Primary colour" },
        { type: "overlay.submitted", value: "Primary colour", context: context() },
      ],
      commenting(),
    )

    expect(submitted.state.status).toBe("idle")
    expect(submitted.effects).toEqual([
      {
        type: "attach-comment",
        tabID: alpha,
        url: "https://alpha.example/",
        element,
        live: true,
        comment: "Primary colour",
      },
      { type: "clear-highlight", sessionKey: "Alpha", tabID: alpha },
    ])
  })

  test("keep the draft through a reload but drop the ref", () => {
    const reloaded = replay(
      [
        { type: "draft.changed", value: "Still off" },
        { type: "context.changed", context: context({ tab: tab(alpha, 1) }) },
      ],
      commenting(),
    )

    expect(overlayComment(reloaded.state, "Alpha", alpha)?.draft).toBe("Still off")

    const submitted = transitionOverlay(reloaded.state, {
      type: "overlay.submitted",
      value: "Still off",
      context: context({ tab: tab(alpha, 1) }),
    })

    expect(submitted.effects[0]).toMatchObject({ type: "attach-comment", live: false })
  })

  test("a press beside the editor cancels only an empty draft", () => {
    const empty = transitionOverlay(commenting(), { type: "backdrop.pressed" })
    expect(empty.state.status).toBe("idle")
    expect(empty.effects).toEqual([{ type: "clear-highlight", sessionKey: "Alpha", tabID: alpha }])

    const drafted = replay([{ type: "draft.changed", value: "Keep me" }], commenting()).state
    expect(transitionOverlay(drafted, { type: "backdrop.pressed" }).state).toBe(drafted)
  })

  test("the editor keeps the side it opened on", () => {
    const measured = replay(
      [
        { type: "editor.resized", height: 79.5 },
        { type: "editor.resized", height: 140 },
      ],
      commenting(),
    ).state

    expect(measured).toMatchObject({ editorHeight: 140, editorInitialHeight: 80 })
  })

  test("close with their tab and with the pane", () => {
    expect(
      transitionOverlay(commenting(), { type: "context.changed", context: context({ tab: tab(beta) }) }).effects,
    ).toEqual([{ type: "clear-highlight", sessionKey: "Alpha", tabID: alpha }])
    expect(
      transitionOverlay(commenting(), { type: "context.changed", context: context({ visible: false }) }).state.status,
    ).toBe("commenting")
    expect(transitionOverlay(commenting(), { type: "disposed" }).effects).toEqual([
      { type: "clear-highlight", sessionKey: "Alpha", tabID: alpha },
    ])
  })
})
