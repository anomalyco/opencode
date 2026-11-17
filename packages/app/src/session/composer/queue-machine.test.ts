import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/composer/state"
import {
  createQueueState,
  movedTarget,
  selectQueueRows,
  transitionQueue,
  viewQueue,
  type EditStash,
  type QueueEffect,
  type QueueEvent,
  type QueueState,
  type QueuedPrompt,
} from "./queue-machine"

const item = (id: string, text = `${id} text`): QueuedPrompt => ({
  id,
  sessionID: "ses_1",
  time: { created: 1 },
  type: "user",
  delivery: "queue",
  payload: { text },
})

const prompt = (content: string): Prompt => [{ type: "text", content, start: 0, end: content.length }]

const draft = (content: string): EditStash => ({
  prompt: prompt(content),
  cursor: content.length,
  mode: "normal",
  retry: undefined,
})

const ids = ["new_1", "new_2", "new_3", "new_4"]

// Replays events through the pure transition, collecting every effect in order.
function replay(state: QueueState, events: QueueEvent[]) {
  const effects: QueueEffect[] = []

  const final = events.reduce((current, event) => {
    const next = transitionQueue(current, event)
    effects.push(...next.effects)

    return next.state
  }, state)

  return { state: final, effects }
}

const runs = (effects: readonly QueueEffect[]) =>
  effects.flatMap((effect) => (effect.type === "mutation.run" ? [effect.operation] : []))

const restores = (effects: readonly QueueEffect[]) => effects.filter((effect) => effect.type === "draft.restore")

const rowIDs = (state: QueueState) => selectQueueRows(state).map((row) => row.id)

const [one, two, three] = ["inb_1", "inb_2", "inb_3"].map((id) => item(id))

describe("queue first shares the serialized reorder", () => {
  test("a waiting request follows rewritten inbox IDs instead of resurrecting an original", () => {
    const result = replay(createQueueState([one, two, three]), [
      { type: "reorder.requested", inboxIDs: [two.id, one.id, three.id], reverted: false },
      { type: "first.requested", id: three.id, reverted: false },
      { type: "mutation.moved", attempt: 1, moved: { [one.id]: "new_1", [two.id]: "new_2", [three.id]: "new_3" } },
      { type: "inbox.synced", items: [item("new_2"), item("new_1"), item("new_3")] },
      { type: "mutation.succeeded", attempt: 1 },
    ])

    expect(runs(result.effects)).toMatchObject([
      { type: "reorder", inboxIDs: [two.id, one.id, three.id] },
      { type: "reorder", inboxIDs: ["new_3", "new_2", "new_1"] },
    ])
    expect(rowIDs(result.state)).toEqual(["new_3", "new_2", "new_1"])

    const stale = transitionQueue(result.state, { type: "mutation.failed", attempt: 1, hidden: [] })

    expect(stale.state).toBe(result.state)
    expect(stale.effects).toEqual([])
  })

  test.each([one.id, "delivered"])("%s needs no reorder", (id) => {
    const state = createQueueState([one, two])

    expect(transitionQueue(state, { type: "first.requested", id, reverted: false })).toEqual({ state, effects: [] })
  })

  test.each(["mutation.succeeded", "mutation.failed", "mutation.timed-out", "dispose"] as const)(
    "%s settles a queue-first reorder through the existing lifecycle",
    (type) => {
      const started = transitionQueue(createQueueState([one, two]), {
        type: "first.requested",
        id: two.id,
        reverted: false,
      })

      const result = transitionQueue(
        started.state,
        type === "dispose" ? { type } : { type, attempt: 1, hidden: [], stage: "running" },
      )

      expect(result.state.status).toBe(type === "dispose" ? "disposed" : "idle")
      expect(
        result.effects.some((effect) => effect.type === "mutation.timer.clear" || effect.type === "timer.clearAll"),
      ).toBe(true)
    },
  )
})

test("steer-first ignores an open edit and a disposed or empty queue", () => {
  const editing = transitionQueue(createQueueState([one, two]), {
    type: "edit.start",
    id: one.id,
    reverted: false,
    draft: draft("my draft"),
  }).state

  const disposed = transitionQueue(createQueueState([one, two]), { type: "dispose" }).state

  for (const state of [editing, disposed, createQueueState([])]) {
    const result = transitionQueue(state, { type: "steer-first.requested" })

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([])
  }
})

describe("an edit always returns the draft it replaced", () => {
  test("when the server delivers the prompt being edited", () => {
    const result = replay(createQueueState([one, two]), [
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("my unsent draft") },
      { type: "inbox.synced", items: [two] },
    ])

    expect(result.state.status).toBe("idle")
    expect(restores(result.effects)).toEqual([
      { type: "draft.restore", stash: draft("my unsent draft"), focus: true, keep: one },
    ])
  })

  test("when the server delivers it while another row's edit is in flight", () => {
    const result = replay(createQueueState([one, two]), [
      { type: "edit.start", id: "inb_2", reverted: false, draft: draft("") },
      { type: "edit.confirm", delivery: "queue", reverted: false, prompt: prompt("inb_2 edited"), ids },
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("my unsent draft") },
    ])

    expect(result.state.status).toBe("editing-while-mutating")
    const delivered = transitionQueue(result.state, { type: "inbox.synced", items: [two] })

    expect(delivered.state).toMatchObject({ status: "mutating", active: { type: "edit", original: "inb_2" } })
    expect(restores(delivered.effects)).toEqual([
      { type: "draft.restore", stash: draft("my unsent draft"), focus: true, keep: one },
    ])
  })

  test("switching rows keeps the draft from before the first edit", () => {
    const result = replay(createQueueState([one, two]), [
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("original draft") },
      { type: "edit.start", id: "inb_2", reverted: false, draft: draft("inb_1 text") },
      { type: "edit.cancel" },
    ])

    expect(result.state.status).toBe("idle")
    expect(restores(result.effects)).toEqual([{ type: "draft.restore", stash: draft("original draft"), focus: true }])
  })

  test("a failed edit that never reached the server returns to the composer", () => {
    const sent = replay(createQueueState([one, two]), [
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("") },
      { type: "edit.confirm", delivery: "queue", reverted: false, prompt: prompt("inb_1 edited"), ids },
    ])

    const attempt = runs(sent.effects)[0].attempt
    const failed = transitionQueue(sent.state, { type: "mutation.failed", attempt, hidden: [] })

    expect(failed.state.status).toBe("idle")
    expect(failed.effects).toContainEqual({ type: "draft.merge", prompt: prompt("inb_1 edited"), context: [] })
    expect(rowIDs(failed.state)).toEqual(["inb_1", "inb_2"])

    // Once every replacement is admitted, a failure leaves the edit with the server.
    const admitted = transitionQueue(sent.state, { type: "mutation.admitted", attempt })
    const late = transitionQueue(admitted.state, { type: "mutation.failed", attempt, hidden: [] })

    expect(late.effects.some((effect) => effect.type === "draft.merge")).toBe(false)
  })
})

describe("queue changes run one at a time", () => {
  test("a steer requested during a reorder waits and targets the re-admitted prompt", () => {
    const reordering = replay(createQueueState([one, two, three]), [
      { type: "reorder.requested", inboxIDs: ["inb_2", "inb_1", "inb_3"], reverted: false },
      { type: "steer.requested", id: "inb_1" },
      { type: "remove.requested", id: "inb_3" },
    ])

    const reorder = runs(reordering.effects)

    expect(reorder.map((operation) => operation.type)).toEqual(["reorder"])
    expect(viewQueue(reordering.state, { working: true, behavior: "queue" })).toMatchObject({ busy: true })
    // The waiting steer and removal hide their rows at once.
    expect(rowIDs(reordering.state)).toEqual(["inb_2"])

    const settled = replay(reordering.state, [
      {
        type: "mutation.moved",
        attempt: reorder[0].attempt,
        moved: { inb_1: "msg_1", inb_2: "msg_2", inb_3: "msg_3" },
      },
      { type: "inbox.synced", items: [item("msg_2"), item("msg_1"), item("msg_3")] },
      { type: "mutation.succeeded", attempt: reorder[0].attempt },
    ])

    expect(runs(settled.effects)).toMatchObject([{ type: "steer", id: "msg_1" }])
    expect(settled.state).toMatchObject({ status: "mutating", pending: [{ type: "remove", id: "msg_3" }] })
    expect(rowIDs(settled.state)).toEqual(["msg_2"])
  })

  test("a reorder requested during a steer is refused", () => {
    const result = replay(createQueueState([one, two]), [
      { type: "steer.requested", id: "inb_1" },
      { type: "reorder.requested", inboxIDs: ["inb_2"], reverted: false },
    ])

    expect(runs(result.effects).map((operation) => operation.type)).toEqual(["steer"])
  })

  test("confirming an unchanged edit as a steer waits behind the edit in flight", () => {
    const result = replay(createQueueState([one, two]), [
      { type: "edit.start", id: "inb_2", reverted: false, draft: draft("") },
      { type: "edit.confirm", delivery: "queue", reverted: false, prompt: prompt("inb_2 edited"), ids },
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("my draft") },
      { type: "edit.confirm", delivery: "steer", reverted: false, prompt: prompt("inb_1 text"), ids },
    ])

    expect(result.state).toMatchObject({ status: "mutating", pending: [{ type: "steer", id: "inb_1" }] })
    expect(runs(result.effects).map((operation) => operation.type)).toEqual(["edit"])
    expect(restores(result.effects).at(-1)).toEqual({ type: "draft.restore", stash: draft("my draft"), focus: true })
  })
})

describe("replaced inbox IDs", () => {
  const moved = (state: QueueState) => viewQueue(state, { working: true, behavior: "queue" }).moved

  // Edits `id` as a queued prompt; its replacement and the prompts after it take `next`.
  function edit(state: QueueState, id: string, next: string[]) {
    const confirmed = replay(state, [
      { type: "edit.start", id, reverted: false, draft: draft("") },
      { type: "edit.confirm", delivery: "queue", reverted: false, prompt: prompt(`${id} edited`), ids: next },
    ])

    return { state: confirmed.state, attempt: runs(confirmed.effects)[0].attempt }
  }

  test("an edit's replacements chain across later edits until their prompts leave the queue", () => {
    const first = edit(createQueueState([one]), "inb_1", ["msg_1"])
    // In flight, the panel already sees the replacement it may swap in.
    expect(moved(first.state)).toEqual({ inb_1: "msg_1" })

    const settled = replay(first.state, [
      { type: "inbox.synced", items: [item("msg_1")] },
      { type: "mutation.succeeded", attempt: first.attempt },
    ]).state

    expect(settled.status).toBe("idle")
    expect(moved(settled)).toEqual({ inb_1: "msg_1" })

    const second = edit(settled, "msg_1", ["msg_2"])

    const chained = replay(second.state, [
      { type: "inbox.synced", items: [item("msg_2")] },
      { type: "mutation.succeeded", attempt: second.attempt },
    ]).state

    expect(movedTarget(moved(chained), "inb_1", new Set(["msg_2"]))).toBe("msg_2")
    expect(movedTarget(moved(chained), "inb_1", new Set(["msg_1", "msg_2"]))).toBe("msg_1")

    // Once the last replacement is delivered, nothing it maps is queued.
    expect(moved(transitionQueue(chained, { type: "inbox.synced", items: [] }).state)).toEqual({})
  })

  test("a failed edit leaves no replacement behind", () => {
    const sent = edit(createQueueState([one, two]), "inb_1", ["msg_1", "msg_2"])
    expect(moved(sent.state)).toEqual({ inb_1: "msg_1", inb_2: "msg_2" })

    const failed = transitionQueue(sent.state, { type: "mutation.failed", attempt: sent.attempt, hidden: [] })
    expect(moved(failed.state)).toEqual({})
  })
})

describe("optimistic rows", () => {
  test("a steer hides its row until the server confirms or refuses it", () => {
    const requested = transitionQueue(createQueueState([one, two]), { type: "steer.requested", id: "inb_1" })
    const attempt = runs(requested.effects)[0].attempt

    expect(rowIDs(requested.state)).toEqual(["inb_2"])

    const refused = transitionQueue(requested.state, { type: "mutation.failed", attempt, hidden: [] })

    expect(refused.effects).toContainEqual({ type: "toast", key: "common.requestFailed" })
    expect(rowIDs(refused.state)).toEqual(["inb_1", "inb_2"])

    // Confirmed, it stays hidden until the server's events catch up, or until its expiry if they never do.
    const confirmed = transitionQueue(requested.state, { type: "mutation.succeeded", attempt })
    const expiry = confirmed.effects.find((effect) => effect.type === "timer.start")

    expect(confirmed.state.status).toBe("idle")
    expect(rowIDs(confirmed.state)).toEqual(["inb_2"])
    expect(expiry).toBeDefined()

    if (expiry?.type !== "timer.start") return
    const caught = transitionQueue(confirmed.state, { type: "inbox.synced", items: [two] })

    expect(caught.effects).toEqual([{ type: "timer.clear", expiry: expiry.expiry }])
    expect(rowIDs(transitionQueue(confirmed.state, { type: "gone.expired", expiry: expiry.expiry }).state)).toEqual([
      "inb_1",
      "inb_2",
    ])
  })

  test("an edit in flight shows on its row as pending", () => {
    const result = replay(createQueueState([one, two]), [
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("") },
      { type: "edit.confirm", delivery: "queue", reverted: false, prompt: prompt("inb_1 edited"), ids },
    ])

    expect(selectQueueRows(result.state)).toEqual([
      { id: "inb_1", text: "inb_1 edited", attachments: 0, pending: true },
      { id: "inb_2", text: "inb_2 text", attachments: 0, pending: true },
    ])
    // A pending row cannot be opened again.
    expect(
      transitionQueue(result.state, { type: "edit.start", id: "inb_1", reverted: false, draft: draft("") }).state,
    ).toBe(result.state)
  })
})

describe("stale results", () => {
  test("a media pin for a row no longer open is ignored", () => {
    const opened = transitionQueue(createQueueState([one, two]), {
      type: "edit.start",
      id: "inb_1",
      reverted: false,
      draft: draft(""),
    })

    if (opened.state.status !== "editing") throw new Error("The row did not open")
    const attempt = opened.state.edit.pin
    const blobs = new Map()

    const switched = replay(opened.state, [
      { type: "edit.start", id: "inb_2", reverted: false, draft: draft("") },
      { type: "edit.mediaPinned", attempt, blobs },
    ])

    expect(switched.effects.some((effect) => effect.type === "draft.pinned")).toBe(false)
    expect(transitionQueue(opened.state, { type: "edit.mediaPinned", attempt, blobs }).effects).toEqual([
      { type: "draft.pinned", blobs },
    ])
  })

  test("after dispose an operation that settles starts no expiry timer, toast or waiting operation", () => {
    const editing = replay(createQueueState([one, two, three]), [
      { type: "steer.requested", id: "inb_2" },
      { type: "remove.requested", id: "inb_3" },
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("my draft") },
    ])

    const attempt = runs(editing.effects)[0].attempt
    const disposed = transitionQueue(editing.state, { type: "dispose" })

    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects).toEqual([
      { type: "draft.restore", stash: draft("my draft"), focus: false },
      { type: "timer.clearAll" },
    ])
    expect(viewQueue(disposed.state, { working: true, behavior: "queue" })).toMatchObject({ rows: [], busy: false })

    for (const event of [
      { type: "mutation.succeeded", attempt },
      { type: "mutation.failed", attempt, hidden: [] },
    ] satisfies QueueEvent[])
      expect(transitionQueue(disposed.state, event)).toEqual({ state: disposed.state, effects: [] })
  })

  test("an edit the server never admitted before dispose returns to the saved draft if it then fails", () => {
    const sent = replay(createQueueState([one]), [
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("") },
      { type: "edit.confirm", delivery: "queue", reverted: false, prompt: prompt("inb_1 edited"), ids },
      { type: "dispose" },
    ])

    const attempt = runs(sent.effects)[0].attempt

    expect(transitionQueue(sent.state, { type: "mutation.failed", attempt, hidden: [] }).effects).toEqual([
      { type: "draft.merge", prompt: prompt("inb_1 edited"), context: [], focus: false },
    ])

    const admitted = transitionQueue(sent.state, { type: "mutation.admitted", attempt }).state

    expect(transitionQueue(admitted, { type: "mutation.failed", attempt, hidden: [] }).effects).toEqual([])
  })

  test("dispose stops an undo before its cancel, and an undo the server applied anyway returns its prompt", () => {
    const undoing = transitionQueue(createQueueState([one]), { type: "undo.requested", id: "inb_1", mode: "normal" })
    const attempt = runs(undoing.effects)[0].attempt
    const disposed = transitionQueue(undoing.state, { type: "dispose" })

    expect(disposed.effects).toEqual([{ type: "mutation.abort", attempt }, { type: "timer.clearAll" }])
    expect(
      transitionQueue(disposed.state, { type: "mutation.undone", attempt, prompt: prompt("inb_1 text"), context: [] })
        .effects,
    ).toEqual([{ type: "draft.merge", prompt: prompt("inb_1 text"), context: [], focus: false }])
  })
})

describe("an operation past its bound", () => {
  test("a stalled undo gives the composer back and ignores its late answer", () => {
    const undoing = transitionQueue(createQueueState([one]), { type: "undo.requested", id: "inb_1", mode: "normal" })
    const attempt = runs(undoing.effects)[0].attempt

    expect(undoing.effects).toContainEqual({ type: "mutation.timer.start", attempt })
    expect(viewQueue(undoing.state, { working: true, behavior: "queue" }).undoing).toBe(true)

    const timedOut = transitionQueue(undoing.state, {
      type: "mutation.timed-out",
      attempt,
      hidden: [],
      stage: "running",
    })

    expect(timedOut.state.status).toBe("idle")
    expect(viewQueue(timedOut.state, { working: true, behavior: "queue" }).undoing).toBe(false)
    expect(timedOut.effects).toEqual([
      { type: "mutation.abort", attempt },
      { type: "toast", key: "common.requestFailed" },
      { type: "mutation.timer.clear" },
    ])
    expect(transitionQueue(timedOut.state, { type: "mutation.failed", attempt, hidden: [] }).state).toBe(timedOut.state)
  })

  test("a steered edit whose admission is in flight keeps the edit until the server answers", () => {
    const sent = replay(createQueueState([one, two]), [
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("") },
      { type: "edit.confirm", delivery: "steer", reverted: false, prompt: prompt("inb_1 edited"), ids },
    ])

    const attempt = runs(sent.effects)[0].attempt
    const waiting = transitionQueue(sent.state, { type: "mutation.timed-out", attempt, hidden: [], stage: "committed" })

    // The replacement may already be delivered: the composer must not get the edit back while it may have gone out.
    expect(waiting.state).toBe(sent.state)
    expect(waiting.effects).toEqual([])

    // Delivered, a later failure of the original's cancel leaves the edit with the server.
    const admitted = transitionQueue(waiting.state, { type: "mutation.admitted", attempt }).state

    expect(
      transitionQueue(admitted, { type: "mutation.failed", attempt, hidden: [] }).effects.some(
        (effect) => effect.type === "draft.merge",
      ),
    ).toBe(false)

    // Refused, it really did not go out, so it returns to the composer.
    expect(transitionQueue(waiting.state, { type: "mutation.failed", attempt, hidden: [] }).effects).toContainEqual({
      type: "draft.merge",
      prompt: prompt("inb_1 edited"),
      context: [],
    })
  })

  test("an undo whose cancel is in flight waits for the server's answer", () => {
    const undoing = transitionQueue(createQueueState([one]), { type: "undo.requested", id: "inb_1", mode: "normal" })
    const attempt = runs(undoing.effects)[0].attempt

    expect(
      transitionQueue(undoing.state, { type: "mutation.timed-out", attempt, hidden: [], stage: "committed" }).state,
    ).toBe(undoing.state)
  })

  test("a stalled reorder hides the copy it withdrew and starts the steer waiting behind it", () => {
    const reordering = replay(createQueueState([one, two, three]), [
      { type: "reorder.requested", inboxIDs: ["inb_2", "inb_1", "inb_3"], reverted: false },
      { type: "steer.requested", id: "inb_3" },
      { type: "inbox.synced", items: [one, two, three, item("msg_2")] },
    ])

    const attempt = runs(reordering.effects)[0].attempt

    const timedOut = transitionQueue(reordering.state, {
      type: "mutation.timed-out",
      attempt,
      hidden: ["msg_2"],
      stage: "running",
    })

    expect(timedOut.effects).toContainEqual({ type: "mutation.abort", attempt })
    expect(timedOut.effects).toContainEqual({ type: "toast", key: "common.requestFailed" })
    expect(timedOut.effects).toContainEqual(expect.objectContaining({ type: "timer.start" }))
    expect(runs(timedOut.effects)).toMatchObject([{ type: "steer", id: "inb_3" }])
    expect(rowIDs(timedOut.state)).toEqual(["inb_1", "inb_2"])
    // A steer is one request the request queue already bounds, so it gets no timer of its own.
    expect(timedOut.effects.filter((effect) => effect.type === "mutation.timer.start")).toEqual([])
  })

  test("an edit the server holds whose queue re-read stalled counts as done", () => {
    const sent = replay(createQueueState([one]), [
      { type: "edit.start", id: "inb_1", reverted: false, draft: draft("") },
      { type: "edit.confirm", delivery: "queue", reverted: false, prompt: prompt("inb_1 edited"), ids },
    ])

    const attempt = runs(sent.effects)[0].attempt

    const timedOut = transitionQueue(sent.state, {
      type: "mutation.timed-out",
      attempt,
      hidden: [],
      stage: "settled",
    })

    expect(timedOut.state.status).toBe("idle")
    expect(timedOut.effects).not.toContainEqual({ type: "toast", key: "common.requestFailed" })
    expect(timedOut.effects.some((effect) => effect.type === "draft.merge")).toBe(false)
  })
})

test("a staged revert refuses edits and reorders", () => {
  const state = createQueueState([one, two])

  for (const event of [
    { type: "edit.start", id: "inb_1", reverted: true, draft: draft("") },
    { type: "reorder.requested", inboxIDs: ["inb_2", "inb_1"], reverted: true },
  ] satisfies QueueEvent[]) {
    const result = transitionQueue(state, event)

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([{ type: "toast", key: "session.queue.reverted" }])
  }
})

test("undo waits for an idle queue and refuses shell mode", () => {
  const state = createQueueState([one, two])
  const editing = transitionQueue(state, { type: "edit.start", id: "inb_2", reverted: false, draft: draft("") })

  expect(transitionQueue(editing.state, { type: "undo.requested", id: "inb_1", mode: "normal" }).state).toBe(
    editing.state,
  )
  expect(transitionQueue(state, { type: "undo.requested", id: "inb_1", mode: "shell" }).effects).toEqual([
    { type: "toast", key: "session.queue.undoShell" },
  ])

  const undoing = transitionQueue(state, { type: "undo.requested", id: "inb_1", mode: "normal" })
  const attempt = runs(undoing.effects)[0].attempt

  expect(viewQueue(undoing.state, { working: true, behavior: "queue" })).toMatchObject({ undoing: true, busy: true })

  const undone = transitionQueue(undoing.state, {
    type: "mutation.undone",
    attempt,
    prompt: prompt("inb_1 text"),
    context: [],
  })

  expect(undone.effects).toContainEqual({ type: "draft.merge", prompt: prompt("inb_1 text"), context: [] })
  expect(rowIDs(undone.state)).toEqual(["inb_2"])
})
