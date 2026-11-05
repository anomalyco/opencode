import { expect, test } from "bun:test"
import {
  createSessionDeleteState,
  createSessionHeaderTitleState,
  selectSessionDeleteView,
  selectSessionHeaderTitleView,
  transitionSessionDelete,
  transitionSessionHeaderTitle,
  type SessionDeleteEvent,
  type SessionDeleteState,
  type SessionHeaderTitleEvent,
  type SessionHeaderTitleState,
} from "./header-actions-machine"

const titleReplay = (events: SessionHeaderTitleEvent[], from = createSessionHeaderTitleState("ses_a")) =>
  events.reduce((state: SessionHeaderTitleState, event) => transitionSessionHeaderTitle(state, event).state, from)

const deleteReplay = (events: SessionDeleteEvent[], from = createSessionDeleteState("ses_a")) =>
  events.reduce((state: SessionDeleteState, event) => transitionSessionDelete(state, event).state, from)

const attempt = (state: SessionHeaderTitleState | SessionDeleteState) => ("attempt" in state ? state.attempt : -1)

const submit = { type: "edit.submitted", sessionID: "ses_a", editable: true, currentTitle: "Old" } as const

const target = { removedIDs: ["ses_a"], nextID: "ses_b" }

test("Rename edits at once and ignores the menu closing after it", () => {
  const state = titleReplay([
    { type: "menu.toggled", open: true, editable: true },
    { type: "edit.opened", editable: true, title: "Old" },
    { type: "menu.toggled", open: false, editable: true },
  ])

  expect(selectSessionHeaderTitleView(state)).toMatchObject({ editing: true, draft: "Old", keepFocusOnMenuClose: true })
})

test("closing the menu without Rename never opens the editor on a later close", () => {
  const state = titleReplay([
    { type: "menu.toggled", open: true, editable: true },
    { type: "menu.toggled", open: false, editable: true },
    { type: "menu.toggled", open: true, editable: true },
    { type: "menu.toggled", open: false, editable: true },
  ])

  expect(selectSessionHeaderTitleView(state)).toMatchObject({ editing: false, menuOpen: false })
})

test("Enter and the blur after it save once", () => {
  const editing = titleReplay([
    { type: "edit.opened", editable: true, title: "Old" },
    { type: "draft.changed", value: " New " },
  ])
  const first = transitionSessionHeaderTitle(editing, submit)
  const second = transitionSessionHeaderTitle(first.state, submit)

  expect(first.effects).toContainEqual({ type: "rename.save", attempt: attempt(first.state), sessionID: "ses_a", title: "New" })
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

  expect(transitionSessionHeaderTitle(saving, { type: "rename.succeeded", attempt: attempt(saving) }).state.status).toBe(
    "idle",
  )
})

test("Delete claims the request at once, so a double click or Cancel waits for it", () => {
  const deleting = transitionSessionDelete(createSessionDeleteState("ses_a"), { type: "confirm.requested", target })

  expect(deleting.effects).toEqual([
    { type: "delete.run", attempt: 1, sessionID: "ses_a", target },
    { type: "timer.start", attempt: 1 },
  ])
  expect(selectSessionDeleteView(deleting.state).busy).toBe(true)

  for (const event of [{ type: "confirm.requested", target }, { type: "cancel.requested" }] as const) {
    const next = transitionSessionDelete(deleting.state, event)

    expect(next.state).toBe(deleting.state)
    expect(next.effects).toEqual([])
  }
})

test("a delete that fails or hangs returns to the confirmation", () => {
  const deleting = deleteReplay([{ type: "confirm.requested", target }])

  for (const event of [
    { type: "delete.failed", attempt: attempt(deleting), cause: new Error("no") },
    { type: "delete.timed-out", attempt: attempt(deleting) },
  ] as const) {
    const next = transitionSessionDelete(deleting, event)

    expect(next.state.status).toBe("confirming")
    expect(next.effects).toContainEqual(expect.objectContaining({ type: "toast.delete-failed" }))
  }
})

test("a delete closes the dialog and leaves the session, even when it lands after the dialog went", () => {
  const deleting = deleteReplay([{ type: "confirm.requested", target }])
  const done = transitionSessionDelete(deleting, { type: "delete.succeeded", attempt: attempt(deleting), target })

  expect(done.effects).toEqual([
    { type: "timer.cancel" },
    { type: "dialog.close" },
    { type: "session.removed", sessionID: "ses_a", target },
  ])

  const disposed = transitionSessionDelete(deleting, { type: "disposed" })
  expect(
    transitionSessionDelete(disposed.state, { type: "delete.succeeded", attempt: attempt(deleting), target }).effects,
  ).toEqual([{ type: "session.removed", sessionID: "ses_a", target }])
})

test("confirming a session that is already gone closes the dialog", () => {
  const next = transitionSessionDelete(createSessionDeleteState("ses_a"), { type: "confirm.requested", target: undefined })

  expect(next.state.status).toBe("closed")
  expect(next.effects).toEqual([{ type: "dialog.close" }])
})
