import { describe, expect, test } from "bun:test"
import type { SessionMessageUser } from "@opencode/client/promise"
import {
  createSessionRevertState,
  selectCursorAfterRevert,
  transitionSessionRevert,
  viewSessionRevert,
  type RevertDraftSnapshot,
  type SessionRevertEvent,
  type SessionRevertState,
  type SessionRevertTransition,
} from "./revert-machine"

const user = (id: string): SessionMessageUser => ({ id, type: "user", text: id, time: { created: 1 } })

const m2 = user("msg_2")

const m3 = user("msg_3")

const messages = [user("msg_1"), m2, m3]

const delivered = { messages, inboxIDs: new Set<string>() }

const draft = (text: string): RevertDraftSnapshot => ({
  prompt: [{ type: "text", content: text, start: 0, end: text.length }],
  cursor: text.length,
  context: [],
})

const undo = (revertMessageID?: string, inboxIDs = new Set<string>()): SessionRevertEvent => ({
  type: "undo.requested",
  revertMessageID,
  messages,
  inboxIDs,
})

const rewindTo = (messageID: string, revertMessageID?: string, inboxIDs = new Set<string>()): SessionRevertEvent => ({
  type: "rewind.to",
  messageID,
  revertMessageID,
  messages,
  inboxIDs,
})

const rewound = (attempt: number, text: string): SessionRevertEvent => ({
  type: "rewind.succeeded",
  attempt,
  draft: draft(text),
  ...delivered,
})

function replay(events: SessionRevertEvent[], from = createSessionRevertState()) {
  return events.reduce<SessionRevertTransition[]>((steps, event) => {
    steps.push(transitionSessionRevert(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

const last = (events: SessionRevertEvent[], from?: SessionRevertState) => {
  const steps = replay(events, from)
  const step = steps.at(-1)

  if (!step) throw new Error("no events")

  return step
}

const view = (state: SessionRevertState, revertMessageID?: string) =>
  viewSessionRevert(state, { messages, revertMessageID })

describe("transitionSessionRevert", () => {
  test("refuses every request while an operation runs, so two pipelines never share a Session", () => {
    const running = last([undo()]).state

    expect(running).toMatchObject({ status: "running", operation: { type: "rewind", message: m3 } })

    for (const event of [
      undo(),
      rewindTo("msg_2"),
      { type: "redo.requested", revertMessageID: "msg_3" } as const,
      { type: "toast.undo", attempt: running.attempt } as const,
    ]) {
      const next = transitionSessionRevert(running, event)

      expect(next.state).toBe(running)
      expect(next.effects).toEqual([])
    }

    expect(view(running)).toMatchObject({ busy: true, canUndo: false, canRedo: false })
  })

  test("a second undo before the staged event arrives rewinds the earlier prompt", () => {
    // The server's boundary is still unset: the mock server, or a slow event stream, has not reported the first stage.
    const steps = replay([undo(), rewound(1, "unsent draft"), undo(undefined)])

    expect(steps[1].state).toEqual({
      status: "restored",
      attempt: 1,
      echoes: ["msg_3"],
      boundary: "msg_3",
      prior: undefined,
      draft: draft("unsent draft"),
    })
    expect(steps[2].state).toEqual({
      status: "running",
      attempt: 2,
      echoes: ["msg_3", "msg_2"],
      operation: { type: "rewind", message: m2, prior: "msg_3" },
      known: { boundary: "msg_3" },
    })
    expect(steps[2].effects).toEqual([
      { type: "toast.dismiss" },
      { type: "operation.run", attempt: 2, operation: { type: "rewind", message: m2, prior: "msg_3" } },
    ])
  })

  test("redo right after a rewind clears it before the staged event arrives", () => {
    const restored = last([undo(), rewound(1, "")]).state

    expect(view(restored, undefined).canRedo).toBe(true)

    const redo = transitionSessionRevert(restored, { type: "redo.requested", revertMessageID: undefined })

    expect(redo.effects).toEqual([
      { type: "toast.dismiss" },
      { type: "operation.run", attempt: 2, operation: { type: "redo" } },
    ])

    const done = transitionSessionRevert(redo.state, { type: "redo.succeeded", attempt: 2, ...delivered })

    expect(done.state).toEqual({
      status: "idle",
      attempt: 2,
      echoes: ["msg_3", undefined],
      known: { boundary: undefined },
    })
    expect(done.effects).toEqual([{ type: "cursor.select", messageID: "msg_3" }])
    // The store still reports the boundary until the cleared event arrives.
    expect(view(done.state, "msg_3")).toMatchObject({ canRedo: false, canUndo: true })
  })

  test("a late echo of an earlier rewind neither retires the toast nor repeats a rewind", () => {
    const steps = replay([
      undo(),
      rewound(1, "unsent draft"),
      undo(undefined),
      rewound(2, "msg_3 text"),
      // The echo of the first stage lands after the second rewind; the echo of the second is still due.
      { type: "revert.staged", messageID: "msg_3" },
    ])

    expect(steps[4].state).toEqual({ ...steps[3].state, echoes: ["msg_2"] })
    expect(steps[4].effects).toEqual([])

    // The store now says msg_3, but msg_2 is the boundary, so a third undo moves on to msg_1.
    const third = transitionSessionRevert(steps[4].state, undo("msg_3"))

    expect(third.state).toMatchObject({ operation: { type: "rewind", message: { id: "msg_1" }, prior: "msg_2" } })

    // Its own echo, the last one due, leaves the rewind undoable.
    const echoed = transitionSessionRevert(steps[4].state, { type: "revert.staged", messageID: "msg_2" })

    expect(echoed.state).toEqual({ ...steps[3].state, echoes: [] })
    expect(echoed.effects).toEqual([])
  })

  test("a commit while a rewind is still interrupting keeps that rewind's own echo", () => {
    const steps = replay([
      undo(),
      // A prompt sent while an earlier boundary was staged commits it before this rewind's stage goes out.
      { type: "revert.committed" },
      rewound(1, "unsent draft"),
      { type: "revert.staged", messageID: "msg_3" },
    ])

    expect(steps[1].state).toMatchObject({ status: "running", echoes: ["msg_3"] })
    expect(steps[3].state).toEqual({ ...steps[2].state, echoes: [] })
    expect(steps[3].state.status).toBe("restored")
    expect(steps[3].effects).toEqual([])
  })

  test("a late stage echo after a redo keeps the cleared boundary until the clear echo arrives", () => {
    const steps = replay([
      undo(),
      rewound(1, ""),
      { type: "redo.requested", revertMessageID: undefined },
      { type: "redo.succeeded", attempt: 2, ...delivered },
      { type: "revert.staged", messageID: "msg_3" },
      { type: "revert.cleared" },
    ])

    expect(steps[4].state).toEqual({ status: "idle", attempt: 2, echoes: [undefined], known: { boundary: undefined } })
    // The store reports msg_3 from the late echo, but the Session has nothing to redo.
    expect(view(steps[4].state, "msg_3")).toMatchObject({ canRedo: false })
    expect(steps[5].state).toEqual({ status: "idle", attempt: 2, echoes: [] })
  })

  test("an older toast's Undo is ignored after a newer rewind", () => {
    const steps = replay([rewindTo("msg_3"), rewound(1, "original draft"), rewindTo("msg_2"), rewound(2, "msg_3 text")])

    const restored = steps[3].state
    const stale = transitionSessionRevert(restored, { type: "toast.undo", attempt: 1 })

    expect(stale.state).toBe(restored)
    expect(stale.effects).toEqual([])

    const current = transitionSessionRevert(restored, { type: "toast.undo", attempt: 2 })
    const operation = { type: "undo-rewind", prior: "msg_3", draft: draft("msg_3 text") } as const

    expect(current.state).toEqual({
      status: "running",
      attempt: 3,
      echoes: ["msg_3", "msg_2", "msg_3"],
      operation,
      known: { boundary: "msg_2" },
    })
    expect(current.effects).toEqual([{ type: "toast.dismiss" }, { type: "operation.run", attempt: 3, operation }])

    const done = transitionSessionRevert(current.state, { type: "undo-rewind.succeeded", attempt: 3, ...delivered })

    expect(done.state).toEqual({
      status: "idle",
      attempt: 3,
      echoes: ["msg_3", "msg_2", "msg_3"],
      known: { boundary: "msg_3" },
    })
    expect(done.effects).toEqual([
      { type: "draft.restoreSnapshot", draft: draft("msg_3 text") },
      { type: "cursor.select", messageID: "msg_2" },
    ])
  })

  test("a double-clicked Undo runs once", () => {
    const steps = replay([
      rewindTo("msg_3"),
      rewound(1, "draft"),
      { type: "toast.undo", attempt: 1 },
      { type: "toast.undo", attempt: 1 },
    ])

    expect(steps[2].effects.filter((effect) => effect.type === "operation.run")).toHaveLength(1)
    expect(steps[3].state).toBe(steps[2].state)
    expect(steps[3].effects).toEqual([])
  })

  // A commit lands after every request sent before it, so no echo is still due.
  test.each<{ event: SessionRevertEvent; echoes: string[] }>([
    { event: { type: "revert.staged", messageID: "msg_1" }, echoes: ["msg_3"] },
    { event: { type: "revert.cleared" }, echoes: ["msg_3"] },
    { event: { type: "revert.committed" }, echoes: [] },
  ])("$event.type from elsewhere retires the Rewound toast", ({ event, echoes }) => {
    const restored = last([rewindTo("msg_3"), rewound(1, "draft")]).state
    const next = transitionSessionRevert(restored, event)

    expect(next.state).toEqual({ status: "idle", attempt: 1, echoes })
    expect(next.effects).toEqual([{ type: "toast.dismiss" }])
    expect(transitionSessionRevert(next.state, { type: "toast.undo", attempt: 1 }).effects).toEqual([])
  })

  test("a queued prompt is withdrawn instead of rewound", () => {
    const queued = new Set(["msg_3"])
    const known: SessionRevertState = { status: "idle", attempt: 4, echoes: [], known: { boundary: undefined } }
    const start = transitionSessionRevert(known, undo(undefined, queued))

    expect(start.state).toEqual({
      status: "running",
      attempt: 5,
      echoes: [],
      operation: { type: "withdraw", message: m3 },
      known: { boundary: undefined },
    })

    const prompt = draft("pinned").prompt

    const done = transitionSessionRevert(start.state, {
      type: "withdraw.succeeded",
      attempt: 5,
      prompt,
      messages,
      inboxIDs: queued,
    })

    expect(done.state).toEqual({ ...known, attempt: 5 })
    expect(done.effects).toEqual([
      { type: "draft.restoreMessage", message: m3, prompt },
      { type: "cursor.select", messageID: "msg_2" },
    ])
    expect(transitionSessionRevert(known, rewindTo("msg_3", undefined, queued)).state).toEqual(start.state)
  })

  test("a failure returns to idle and keeps the known boundary", () => {
    const running = last([undo(), rewound(1, ""), undo()]).state
    const failed = transitionSessionRevert(running, { type: "operation.failed", attempt: 2, error: "busy" })

    // The failed stage sends no echo, so only the first one is still due.
    expect(failed.state).toEqual({ status: "idle", attempt: 2, echoes: ["msg_3"], known: { boundary: "msg_3" } })
    expect(failed.effects).toEqual([{ type: "toast.fail", error: "busy" }])
    expect(view(failed.state)).toMatchObject({ busy: false, canUndo: true, canRedo: true })
  })

  test("a timeout aborts the run and ignores its late result", () => {
    const running = last([undo()]).state
    const timedOut = transitionSessionRevert(running, { type: "operation.timed-out", attempt: 1 })

    expect(timedOut.state).toEqual({ status: "idle", attempt: 1, echoes: [] })
    expect(timedOut.effects).toEqual([{ type: "operation.abort" }, { type: "toast.fail" }])

    for (const event of [
      { type: "operation.failed", attempt: 1, error: "aborted" },
      rewound(1, ""),
    ] satisfies SessionRevertEvent[]) {
      const late = transitionSessionRevert(timedOut.state, event)

      expect(late.state).toBe(timedOut.state)
      expect(late.effects).toEqual([])
    }
  })

  test("a result from an earlier attempt or another operation is ignored", () => {
    const running = last([undo(), rewound(1, ""), undo()]).state

    for (const event of [
      rewound(1, ""),
      { type: "redo.succeeded", attempt: 2, ...delivered },
      { type: "operation.failed", attempt: 1 },
      { type: "operation.timed-out", attempt: 1 },
    ] satisfies SessionRevertEvent[]) {
      expect(transitionSessionRevert(running, event).state).toBe(running)
    }
  })

  test("disposal aborts a run and retires a toast", () => {
    const running = last([undo()]).state
    const restored = last([undo(), rewound(1, "")]).state
    const idle = createSessionRevertState()

    expect(transitionSessionRevert(running, { type: "disposed" })).toEqual({
      state: { status: "idle", attempt: 1, echoes: [] },
      effects: [{ type: "operation.abort" }],
    })
    expect(transitionSessionRevert(restored, { type: "disposed" })).toEqual({
      state: { status: "idle", attempt: 1, echoes: [] },
      effects: [{ type: "toast.dismiss" }],
    })
    expect(transitionSessionRevert(idle, { type: "disposed" }).state).toBe(idle)
  })

  test("ignores requests with nothing to act on", () => {
    const idle = createSessionRevertState()

    expect(transitionSessionRevert(idle, undo("msg_1")).state).toBe(idle)
    expect(transitionSessionRevert(idle, rewindTo("msg_missing")).state).toBe(idle)
    expect(transitionSessionRevert(idle, { type: "redo.requested", revertMessageID: undefined }).state).toBe(idle)
    expect(transitionSessionRevert(idle, { type: "toast.undo", attempt: 0 }).state).toBe(idle)
  })
})

describe("selectCursorAfterRevert", () => {
  test("selects the prompt before the boundary, or the latest delivered prompt without one", () => {
    expect(selectCursorAfterRevert(delivered, "msg_3")).toBe("msg_2")
    expect(selectCursorAfterRevert(delivered, "msg_1")).toBeUndefined()
    expect(selectCursorAfterRevert({ messages, inboxIDs: new Set(["msg_3"]) }, undefined)).toBe("msg_2")
  })
})
