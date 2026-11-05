import { describe, expect, test } from "bun:test"
import {
  createLineCommentEditorState,
  parseMentionToken,
  transitionLineCommentEditor,
  viewLineCommentEditor,
  type LineCommentEditorConfig,
  type LineCommentEditorEvent,
  type LineCommentEditorKey,
  type LineCommentEditorState,
  type LineCommentEditorTransition,
} from "./machine"

const config = (patch: Partial<LineCommentEditorConfig> = {}): LineCommentEditorConfig => ({
  value: "",
  allowEmpty: false,
  variant: "compact",
  alternateSubmit: null,
  submitting: false,
  ...patch,
})

// The token the driver reads from the textarea with the caret at the end of `value`.
const typed = (value: string): LineCommentEditorEvent => ({
  type: "mention.synced",
  token: parseMentionToken(value, value.length, value.length),
})

const key = (
  name: string,
  settings: LineCommentEditorConfig,
  patch: Partial<Omit<LineCommentEditorKey, "key">> = {},
): LineCommentEditorEvent => ({
  type: "key.down",
  target: "textarea",
  key: name,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
  repeat: false,
  ...patch,
  config: settings,
})

function run(state: LineCommentEditorState, ...events: LineCommentEditorEvent[]) {
  return events.reduce<LineCommentEditorTransition>(
    (result, event) => {
      const next = transitionLineCommentEditor(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects], handled: next.handled }
    },
    { state, effects: [], handled: false },
  )
}

const attemptOf = (state: LineCommentEditorState) => (state.status === "disposed" ? -1 : state.attempt)

describe("line comment editor machine", () => {
  test("Enter and Tab wait for a refined search only while the previous list is on screen", () => {
    const settings = config({ value: "Check @src/a" })

    const open = run(createLineCommentEditorState(), typed("Check @src"), {
      type: "mention.loaded",
      attempt: 1,
      items: ["server.ts"],
    })

    const refining = run(open.state, typed("Check @src/a"))

    expect(refining.state.status).toBe("mention-loading")
    expect(refining.effects).toEqual([{ type: "mention.load", attempt: 2, query: "src/a" }])

    for (const name of ["Enter", "Tab"]) {
      const pressed = transitionLineCommentEditor(refining.state, key(name, settings))

      expect(pressed.handled).toBe(true)
      expect(pressed.effects).toEqual([])
      expect(pressed.state).toBe(refining.state)
    }
  })

  test("with no list on screen, Enter sends at once and Tab leaves the field while a search runs", () => {
    const settings = config({ value: "mail a@b.com" })
    const loading = run(createLineCommentEditorState(), typed("mail a@b.com"))

    expect(loading.state.status).toBe("mention-loading")

    const enter = transitionLineCommentEditor(loading.state, key("Enter", settings))

    expect(enter.effects).toEqual([{ type: "submit", mode: "primary", value: "mail a@b.com" }])
    expect(enter.state.status).toBe("editing")
    // The search's late answer no longer opens a list.
    expect(
      transitionLineCommentEditor(enter.state, { type: "mention.loaded", attempt: 1, items: ["b.ts"] }).state,
    ).toBe(enter.state)

    const tab = transitionLineCommentEditor(loading.state, key("Tab", settings))

    expect(tab.handled).toBe(false)
    expect(tab.state).toBe(loading.state)
  })

  test("a bare @ or a token with no matches leaves Escape to cancel the comment", () => {
    const settings = config({ value: "see @" })
    const bare = run(createLineCommentEditorState(), typed("see @"))

    expect(bare.state.status).toBe("editing")
    expect(bare.effects).toEqual([])

    const empty = run(createLineCommentEditorState(), typed("user@example.com"), {
      type: "mention.loaded",
      attempt: 1,
      items: [],
    })

    expect(empty.state).toMatchObject({ status: "editing", dismissed: { start: 4, query: "example.com" } })
    expect(transitionLineCommentEditor(empty.state, key("Escape", settings)).effects).toEqual([
      { type: "cancel", blur: true },
    ])
    // Moving the caret back to the same token does not search again.
    expect(transitionLineCommentEditor(empty.state, typed("user@example.com")).state).toBe(empty.state)
  })

  test("the list holds at most ten results and the highlight wraps within them", () => {
    const items = Array.from({ length: 25 }, (_, index) => `src/${index}.ts`)
    const settings = config({ value: "@src" })
    const open = run(createLineCommentEditorState(), typed("@src"), { type: "mention.loaded", attempt: 1, items })

    expect(viewLineCommentEditor(open.state, settings).mentionItems).toHaveLength(10)

    const up = transitionLineCommentEditor(open.state, key("ArrowUp", settings))

    expect(viewLineCommentEditor(up.state, settings).activeMentionPath).toBe("src/9.ts")
    expect(up.handled).toBe(true)

    const around = run(
      up.state,
      key("ArrowDown", settings),
      key("n", settings, { ctrl: true }),
      key("p", settings, { ctrl: true }),
    )

    expect(viewLineCommentEditor(around.state, settings).activeMentionPath).toBe("src/0.ts")
    expect(transitionLineCommentEditor(around.state, key("Enter", settings)).effects).toEqual([
      { type: "mention.insert", path: "src/0.ts", token: { query: "src", start: 0, end: 4 } },
    ])
  })

  test("refining a query keeps the old list on screen but only the new search can complete it", () => {
    const settings = config({ value: "@sr" })

    const first = run(createLineCommentEditorState(), typed("@s"), {
      type: "mention.loaded",
      attempt: 1,
      items: ["server.ts"],
    })

    const refined = run(first.state, typed("@sr"))

    expect(refined.state.status).toBe("mention-loading")
    expect(viewLineCommentEditor(refined.state, settings).mentionItems).toEqual(["server.ts"])
    expect(refined.effects).toEqual([{ type: "mention.load", attempt: 2, query: "sr" }])

    // Enter would insert the stale `server.ts`.
    const enter = transitionLineCommentEditor(refined.state, key("Enter", settings))

    expect(enter.effects).toEqual([])
    expect(enter.handled).toBe(true)

    // A late answer for `@s` changes nothing.
    expect(
      transitionLineCommentEditor(refined.state, { type: "mention.loaded", attempt: 1, items: ["stale.ts"] }).state,
    ).toBe(refined.state)

    const settled = transitionLineCommentEditor(refined.state, { type: "mention.loaded", attempt: 2, items: ["src/"] })

    expect(viewLineCommentEditor(settled.state, settings).mentionItems).toEqual(["src/"])
  })

  test("an owner that resets the value, starts submitting, or a footer submit closes the list", () => {
    const settings = config({ value: "@src/a", variant: "default" })

    const open = run(createLineCommentEditorState(), typed("@src/a"), {
      type: "mention.loaded",
      attempt: 1,
      items: ["src/a.ts"],
    })

    const reset = transitionLineCommentEditor(open.state, { type: "props.synced", config: config(), token: null })

    expect(viewLineCommentEditor(reset.state, config()).mentionItems).toEqual([])

    const submitting = transitionLineCommentEditor(open.state, {
      type: "props.synced",
      config: { ...settings, submitting: true },
      token: parseMentionToken("@src/a", 6, 6),
    })

    expect(submitting.state.status).toBe("submitting")
    expect(viewLineCommentEditor(submitting.state, settings).mentionItems).toEqual([])

    const footer = transitionLineCommentEditor(open.state, { type: "submit.requested", config: settings })

    expect(footer.state.status).toBe("editing")
    expect(footer.effects).toEqual([{ type: "submit", mode: "primary", value: "@src/a" }])
  })

  test("a submitting editor swallows Enter and Escape without acting", () => {
    const settings = config({ value: "Done", submitting: true })

    const submitting = transitionLineCommentEditor(createLineCommentEditorState(), {
      type: "props.synced",
      config: settings,
      token: null,
    })

    for (const name of ["Enter", "Escape"]) {
      expect(transitionLineCommentEditor(submitting.state, key(name, settings))).toEqual({
        state: submitting.state,
        effects: [],
        handled: true,
      })
    }

    expect(transitionLineCommentEditor(submitting.state, key("Tab", settings)).handled).toBe(false)
    expect(
      transitionLineCommentEditor(submitting.state, { type: "action.clicked", modified: false, config: settings })
        .effects,
    ).toEqual([])

    const done = transitionLineCommentEditor(submitting.state, {
      type: "props.synced",
      config: { ...settings, submitting: false },
      token: null,
    })

    expect(done.state.status).toBe("editing")
  })

  test("the alternate submit follows the held modifier and clears on blur or when it goes away", () => {
    const settings = config({ value: "Ship it", alternateSubmit: { disabled: false } })

    const held = transitionLineCommentEditor(createLineCommentEditorState(), {
      type: "modifier.changed",
      active: true,
      config: settings,
    })

    expect(viewLineCommentEditor(held.state, settings).alternateActive).toBe(true)
    expect(
      transitionLineCommentEditor(held.state, { type: "action.clicked", modified: false, config: settings }).effects,
    ).toEqual([{ type: "submit", mode: "alternate", value: "Ship it" }])

    // Entering the action without the modifier clears a stale hold.
    const entered = transitionLineCommentEditor(held.state, {
      type: "modifier.changed",
      active: false,
      config: settings,
    })

    expect(viewLineCommentEditor(entered.state, settings).alternateActive).toBe(false)
    expect(
      viewLineCommentEditor(transitionLineCommentEditor(held.state, { type: "window.blurred" }).state, settings),
    ).toMatchObject({ alternateActive: false })

    const dropped = transitionLineCommentEditor(held.state, {
      type: "props.synced",
      config: { ...settings, alternateSubmit: null },
      token: null,
    })

    expect(dropped.state).toMatchObject({ alternate: false })

    const unsupported = transitionLineCommentEditor(createLineCommentEditorState(), {
      type: "modifier.changed",
      active: true,
      config: { ...settings, variant: "default" },
    })

    expect(unsupported.state).toMatchObject({ alternate: false })
  })

  test("Mod+Enter with the list open sends through the alternate submit", () => {
    const settings = config({ value: "@src", alternateSubmit: { disabled: false } })

    const open = run(createLineCommentEditorState(), typed("@src"), {
      type: "mention.loaded",
      attempt: 1,
      items: ["src/a.ts"],
    })

    expect(transitionLineCommentEditor(open.state, key("Enter", settings, { ctrl: true })).effects).toEqual([
      { type: "submit", mode: "alternate", value: "@src" },
    ])
  })

  test("Escape closes a visible list once, and the same token stays closed", () => {
    const settings = config({ value: "@src" })

    const open = run(createLineCommentEditorState(), typed("@src"), {
      type: "mention.loaded",
      attempt: 1,
      items: ["src/a.ts"],
    })

    const closed = transitionLineCommentEditor(open.state, key("Escape", settings))

    expect(closed.effects).toEqual([])
    expect(closed.handled).toBe(true)
    expect(transitionLineCommentEditor(closed.state, typed("@src")).state).toBe(closed.state)
    expect(transitionLineCommentEditor(closed.state, key("Escape", settings)).effects).toEqual([
      { type: "cancel", blur: true },
    ])
  })

  test("a failed or timed-out search ends loading, and stale timeouts do nothing", () => {
    const loading = run(createLineCommentEditorState(), typed("@src"))

    expect(transitionLineCommentEditor(loading.state, { type: "mention.failed", attempt: 1 }).state.status).toBe(
      "editing",
    )
    expect(transitionLineCommentEditor(loading.state, { type: "mention.timeout", attempt: 1 }).state.status).toBe(
      "editing",
    )

    const next = run(loading.state, typed("@lib"))

    expect(attemptOf(next.state)).toBe(2)
    expect(transitionLineCommentEditor(next.state, { type: "mention.timeout", attempt: 1 }).state).toBe(next.state)
  })

  test("a disposed editor ignores late results", () => {
    const loading = run(createLineCommentEditorState(), typed("@src"))
    const disposed = transitionLineCommentEditor(loading.state, { type: "disposed" })

    expect(disposed.state).toEqual({ status: "disposed" })
    expect(
      transitionLineCommentEditor(disposed.state, { type: "mention.loaded", attempt: 1, items: ["a"] }).state,
    ).toBe(disposed.state)
  })
})
