import { expect, test } from "bun:test"
import {
  createSessionDeleteState,
  selectSessionDeleteView,
  transitionSessionDelete,
  type SessionDeleteEvent,
  type SessionDeleteState,
} from "./delete-machine"

const replay = (events: SessionDeleteEvent[], from = createSessionDeleteState("ses_a")) =>
  events.reduce((state: SessionDeleteState, event) => transitionSessionDelete(state, event).state, from)

// The session header reads where to go next; Home only removes the rows.
const header = { removedIDs: ["ses_a"], nextID: "ses_b" }

const home = { removedIDs: ["ses_a", "ses_a_child"] }

test.each([
  ["session header", header],
  ["Home", home],
])("%s Delete claims the request at once, so a double click or Cancel waits for it", (_name, target) => {
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
  const deleting = replay([{ type: "confirm.requested", target: header }])

  for (const event of [
    { type: "delete.failed", attempt: deleting.attempt, cause: new Error("no") },
    { type: "delete.timed-out", attempt: deleting.attempt },
  ] as const) {
    const next = transitionSessionDelete(deleting, event)

    expect(next.state.status).toBe("confirming")
    expect(selectSessionDeleteView(next.state).busy).toBe(false)
    expect(next.effects).toContainEqual(expect.objectContaining({ type: "toast.delete-failed" }))
  }
})

test("a delete closes the dialog and leaves the session, even when it lands after the dialog went", () => {
  const deleting = replay([{ type: "confirm.requested", target: header }])
  const done = transitionSessionDelete(deleting, { type: "delete.succeeded", attempt: deleting.attempt, target: header })

  expect(done.effects).toEqual([
    { type: "timer.cancel" },
    { type: "dialog.close" },
    { type: "session.removed", sessionID: "ses_a", target: header },
  ])

  const disposed = transitionSessionDelete(deleting, { type: "disposed" })
  expect(
    transitionSessionDelete(disposed.state, { type: "delete.succeeded", attempt: deleting.attempt, target: header })
      .effects,
  ).toEqual([{ type: "session.removed", sessionID: "ses_a", target: header }])
})

test("confirming a session that is already gone closes the dialog", () => {
  const next = transitionSessionDelete(createSessionDeleteState("ses_a"), {
    type: "confirm.requested",
    target: undefined,
  })

  expect(next.state.status).toBe("closed")
  expect(next.effects).toEqual([{ type: "dialog.close" }])
})
