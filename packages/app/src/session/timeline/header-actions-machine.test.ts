import { expect, test } from "bun:test"
import {
  createSessionHeaderTitleState,
  selectSessionHeaderTitleView,
  transitionSessionHeaderTitle,
  type SessionHeaderTitleEvent,
  type SessionHeaderTitleState,
} from "./header-actions-machine"

const titleReplay = (events: SessionHeaderTitleEvent[], from = createSessionHeaderTitleState("ses_a")) =>
  events.reduce((state: SessionHeaderTitleState, event) => transitionSessionHeaderTitle(state, event).state, from)

const attempt = (state: SessionHeaderTitleState) => ("attempt" in state ? state.attempt : -1)

const submit = { type: "edit.submitted", sessionID: "ses_a", editable: true, currentTitle: "Old" } as const

test("Rename opens the editor once the closing menu hands focus back", () => {
  const closing = titleReplay([
    { type: "menu.toggled", open: true, editable: true },
    { type: "rename.chosen" },
    { type: "menu.toggled", open: false, editable: true },
  ])

  expect(selectSessionHeaderTitleView(closing)).toMatchObject({
    editing: false,
    menuOpen: false,
    editOnMenuClose: true,
  })

  const next = transitionSessionHeaderTitle(closing, { type: "menu.closed", editable: true, title: "Old" })

  expect(selectSessionHeaderTitleView(next.state)).toMatchObject({ editing: true, draft: "Old" })
  expect(next.effects).toEqual([{ type: "focus.schedule", attempt: attempt(next.state) }])
})

test("a Rename whose menu never handed focus back does not open the editor on a later, unrelated close", () => {
  const state = titleReplay([
    { type: "menu.toggled", open: true, editable: true },
    { type: "rename.chosen" },
    { type: "menu.toggled", open: false, editable: true },
    // The menu remounted without reporting its close; the user opens it again and presses Escape.
    { type: "menu.toggled", open: true, editable: true },
    { type: "menu.toggled", open: false, editable: true },
  ])

  expect(selectSessionHeaderTitleView(state).editOnMenuClose).toBe(false)
  expect(transitionSessionHeaderTitle(state, { type: "menu.closed", editable: true, title: "Old" }).state).toBe(state)
})

test("Enter and the blur after it save once", () => {
  const editing = titleReplay([
    { type: "edit.opened", editable: true, title: "Old" },
    { type: "draft.changed", value: " New " },
  ])

  const first = transitionSessionHeaderTitle(editing, submit)
  const second = transitionSessionHeaderTitle(first.state, submit)

  expect(first.effects).toContainEqual({
    type: "rename.save",
    attempt: attempt(first.state),
    sessionID: "ses_a",
    title: "New",
  })
  expect(second.state).toBe(first.state)
  expect(second.effects).toEqual([])
})

test("an unchanged or blank title closes the editor without saving", () => {
  for (const value of ["Old", "   "]) {
    const next = transitionSessionHeaderTitle(
      titleReplay([
        { type: "edit.opened", editable: true, title: "Old" },
        { type: "draft.changed", value },
      ]),
      submit,
    )

    expect(next.state.status).toBe("idle")
    expect(next.effects.some((effect) => effect.type === "rename.save")).toBe(false)
  }
})

test("leaving the session mid-save resets the header, and the late save cannot close a newer editor", () => {
  const saving = titleReplay([
    { type: "edit.opened", editable: true, title: "Old" },
    { type: "draft.changed", value: "New" },
    submit,
  ])

  const reopened = titleReplay(
    [
      { type: "target.synced", sessionKey: "ses_a", editable: false },
      { type: "target.synced", sessionKey: "ses_a", editable: true },
      { type: "edit.opened", editable: true, title: "New" },
    ],
    saving,
  )

  expect(selectSessionHeaderTitleView(reopened)).toMatchObject({ editing: true, saving: false })
  expect(transitionSessionHeaderTitle(reopened, { type: "rename.succeeded", attempt: attempt(saving) }).state).toBe(
    reopened,
  )
})

test("a save that fails or hangs returns to the edit with the draft", () => {
  const saving = titleReplay([
    { type: "edit.opened", editable: true, title: "Old" },
    { type: "draft.changed", value: "Retry" },
    submit,
  ])

  for (const event of [
    { type: "rename.failed", attempt: attempt(saving), cause: new Error("no") },
    { type: "rename.timed-out", attempt: attempt(saving) },
  ] as const) {
    const next = transitionSessionHeaderTitle(saving, event)

    expect(selectSessionHeaderTitleView(next.state)).toMatchObject({ editing: true, saving: false, draft: "Retry" })
    expect(next.effects).toContainEqual(expect.objectContaining({ type: "toast.rename-failed" }))
  }

  expect(
    transitionSessionHeaderTitle(saving, { type: "rename.succeeded", attempt: attempt(saving) }).state.status,
  ).toBe("idle")
})
