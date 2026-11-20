import { expect, test } from "bun:test"
import { Session } from "@opencode/schema/session"
import {
  NEW_SESSION_CREATE_TIMEOUT_MS,
  NEW_SESSION_WORKTREE_TIMEOUT_MS,
  createNewSessionStartState,
  transitionNewSessionStart,
  viewNewSessionStart,
  type NewSessionStartEffect,
  type NewSessionStartEvent,
  type NewSessionStartState,
  type NewSessionWorkspace,
} from "./machine"

const sessionID = Session.ID.make("ses_0123456789abcdefghijklmnop")

const main: NewSessionWorkspace = { type: "existing", directory: "/repo" }

const fresh: NewSessionWorkspace = { type: "new", projectDirectory: "/repo", branch: "dev" }

function start(workspace: NewSessionWorkspace, mcp: Record<string, boolean> = {}, toggling = false) {
  return { type: "start", sessionID, workspace, mcp, toggling } satisfies NewSessionStartEvent
}

type Replay = {
  state: NewSessionStartState
  steps: { state: NewSessionStartState["type"]; effects: string[] }[]
  effects: NewSessionStartEffect[]
}

// Folds events through the machine and records each step's state and effect types.
function replay(events: NewSessionStartEvent[], from = createNewSessionStartState()) {
  const initial: Replay = { state: from, steps: [], effects: [] }

  return events.reduce((acc, event) => {
    const result = transitionNewSessionStart(acc.state, event)

    return {
      state: result.state,
      steps: [...acc.steps, { state: result.state.type, effects: result.effects.map((effect) => effect.type) }],
      effects: [...acc.effects, ...result.effects],
    }
  }, initial)
}

test("a failed session create on an existing checkout rolls back to the draft instead of promoting", () => {
  const result = replay([start(main), { type: "session.failed", attempt: 1, message: "Session creation failed" }])

  expect(result.steps).toEqual([
    { state: "session", effects: ["session.create"] },
    { state: "idle", effects: ["toast", "tab.rollback"] },
  ])
  expect(result.effects.slice(1)).toEqual([
    { type: "toast", attempt: 1, title: "prompt.toast.sessionCreateFailed.title", message: "Session creation failed" },
    { type: "tab.rollback", attempt: 1, worktree: undefined },
  ])

  // The retry is a new attempt, and only a created Session is promoted.
  expect(replay([start(main), { type: "session.created", attempt: 2 }], result.state).steps).toEqual([
    { state: "session", effects: ["session.create"] },
    { state: "started", effects: ["session.promote"] },
  ])
})

test.each<{
  name: string
  events: NewSessionStartEvent[]
  steps: { state: NewSessionStartState["type"]; effects: string[] }[]
}>([
  {
    name: "an existing checkout",
    events: [start(main), { type: "session.created", attempt: 1 }],
    steps: [
      { state: "session", effects: ["session.create"] },
      { state: "started", effects: ["session.promote"] },
    ],
  },
  {
    name: "an existing checkout with MCP choices",
    events: [
      start(main, { figma: true }),
      { type: "mcp.prepared", attempt: 1 },
      { type: "session.created", attempt: 1 },
    ],
    steps: [
      { state: "mcp", effects: ["mcp.prepare"] },
      { state: "session", effects: ["session.create"] },
      { state: "started", effects: ["session.promote"] },
    ],
  },
  {
    name: "an existing checkout with an MCP toggle in flight",
    events: [start(main, {}, true), { type: "mcp.prepared", attempt: 1 }, { type: "session.created", attempt: 1 }],
    steps: [
      { state: "mcp", effects: ["mcp.prepare"] },
      { state: "session", effects: ["session.create"] },
      { state: "started", effects: ["session.promote"] },
    ],
  },
  {
    name: "a new worktree",
    events: [
      start(fresh),
      { type: "worktree.created", attempt: 1, directory: "/wt" },
      { type: "session.created", attempt: 1 },
    ],
    steps: [
      { state: "worktree", effects: ["worktree.create"] },
      { state: "session", effects: ["session.create"] },
      { state: "started", effects: ["session.promote"] },
    ],
  },
  {
    name: "a new worktree with MCP choices",
    events: [
      start(fresh, { figma: true }),
      { type: "worktree.created", attempt: 1, directory: "/wt" },
      { type: "mcp.prepared", attempt: 1 },
      { type: "session.created", attempt: 1 },
    ],
    steps: [
      { state: "worktree", effects: ["worktree.create"] },
      { state: "mcp", effects: ["mcp.prepare"] },
      { state: "session", effects: ["session.create"] },
      { state: "started", effects: ["session.promote"] },
    ],
  },
])("starts a Session in $name", (row) => {
  expect(replay(row.events).steps).toEqual(row.steps)
})

test("a new worktree creates the Session in the created directory", () => {
  const result = replay([start(fresh), { type: "worktree.created", attempt: 1, directory: "/wt" }])

  expect(result.effects).toEqual([
    {
      type: "worktree.create",
      attempt: 1,
      projectDirectory: "/repo",
      branch: "dev",
      timeoutMs: NEW_SESSION_WORKTREE_TIMEOUT_MS,
    },
    { type: "session.create", attempt: 1, sessionID, directory: "/wt", timeoutMs: NEW_SESSION_CREATE_TIMEOUT_MS },
  ])
})

// Before, no phase had a time limit: a create whose response stalled left the pending tab on "Starting session" with
// the prompt locked, for good.
test.each<{ name: string; events: NewSessionStartEvent[]; effects: NewSessionStartEffect[] }>([
  {
    name: "worktree creation",
    events: [start(fresh, { figma: true }), { type: "timed-out", attempt: 1, phase: "worktree" }],
    effects: [
      { type: "toast.timed-out", attempt: 1, title: "prompt.toast.worktreeCreateFailed.title" },
      { type: "tab.rollback", attempt: 1, worktree: undefined },
    ],
  },
  {
    name: "MCP preparation in a created worktree",
    events: [
      start(fresh, { figma: true }),
      { type: "worktree.created", attempt: 1, directory: "/wt" },
      { type: "timed-out", attempt: 1, phase: "mcp" },
    ],
    effects: [
      { type: "toast.timed-out", attempt: 1, title: "session.summary.mcp.prepareFailed" },
      { type: "tab.rollback", attempt: 1, worktree: { directory: "/wt", mcp: { figma: true } } },
    ],
  },
  {
    name: "session creation on an existing checkout",
    events: [start(main), { type: "timed-out", attempt: 1, phase: "session" }],
    effects: [
      { type: "toast.timed-out", attempt: 1, title: "prompt.toast.sessionCreateFailed.title" },
      { type: "tab.rollback", attempt: 1, worktree: undefined },
    ],
  },
])("a stalled $name times out and rolls back to the draft", (row) => {
  const last = replay(row.events.slice(-1), replay(row.events.slice(0, -1)).state)

  expect(last.state).toEqual({ type: "idle", attempt: 1 })
  expect(last.effects).toEqual(row.effects)
  // The draft can send again, as a new attempt.
  expect(replay([start(main)], last.state).state).toMatchObject({ type: "session", attempt: 2 })
})

test("each phase's time limit ends only that phase", () => {
  const mcp = replay([start(fresh, { figma: true }), { type: "worktree.created", attempt: 1, directory: "/wt" }]).state
  const session = replay([{ type: "mcp.prepared", attempt: 1 }], mcp).state

  const stale = transitionNewSessionStart(mcp, { type: "timed-out", attempt: 1, phase: "worktree" })
  expect(stale.state).toBe(mcp)
  expect(stale.effects).toEqual([])
  expect(transitionNewSessionStart(session, { type: "timed-out", attempt: 1, phase: "mcp" }).state).toBe(session)
  expect(transitionNewSessionStart(session, { type: "timed-out", attempt: 2, phase: "session" }).state).toBe(session)
  // A timer that fires after the Session was created changes nothing.
  const started = replay([{ type: "session.created", attempt: 1 }], session).state
  expect(transitionNewSessionStart(started, { type: "timed-out", attempt: 1, phase: "session" }).state).toBe(started)
})

// Before, MCP preparation showed its own error even for an attempt that had already ended.
test("an MCP failure with a reason toasts through the machine, and nothing toasts once disposed", () => {
  const preparing = replay([start(main, { figma: true })]).state

  expect(
    transitionNewSessionStart(preparing, { type: "mcp.failed", attempt: 1, message: "Sign in to figma" }).effects,
  ).toEqual([
    { type: "toast", attempt: 1, title: "session.summary.mcp.prepareFailed", message: "Sign in to figma" },
    { type: "tab.rollback", attempt: 1, worktree: undefined },
  ])

  const disposed = replay([{ type: "dispose" }], preparing)
  expect(disposed.effects).toEqual([{ type: "attempt.abort", attempt: 1 }])

  const late: NewSessionStartEvent[] = [
    { type: "mcp.failed", attempt: 1, message: "Sign in to figma" },
    { type: "timed-out", attempt: 1, phase: "mcp" },
    { type: "session.failed", attempt: 1, message: "late" },
  ]

  late.forEach((event) => expect(transitionNewSessionStart(disposed.state, event).effects).toEqual([]))
})

test.each<{ name: string; events: NewSessionStartEvent[]; effects: NewSessionStartEffect[] }>([
  {
    name: "worktree creation fails",
    events: [start(fresh, { figma: true }), { type: "worktree.failed", attempt: 1, message: "No space" }],
    effects: [
      { type: "toast", attempt: 1, title: "prompt.toast.worktreeCreateFailed.title", message: "No space" },
      { type: "tab.rollback", attempt: 1, worktree: undefined },
    ],
  },
  {
    // MCP preparation shows its own error, and the draft still holds its MCP choices.
    name: "MCP preparation fails on an existing checkout",
    events: [start(main, { figma: true }), { type: "mcp.failed", attempt: 1 }],
    effects: [{ type: "tab.rollback", attempt: 1, worktree: undefined }],
  },
  {
    name: "MCP preparation fails in a created worktree",
    events: [
      start(fresh, { figma: true }),
      { type: "worktree.created", attempt: 1, directory: "/wt" },
      { type: "mcp.failed", attempt: 1 },
    ],
    effects: [{ type: "tab.rollback", attempt: 1, worktree: { directory: "/wt", mcp: { figma: true } } }],
  },
  {
    name: "session creation fails in a created worktree",
    events: [
      start(fresh, { figma: true }),
      { type: "worktree.created", attempt: 1, directory: "/wt" },
      { type: "mcp.prepared", attempt: 1 },
      { type: "session.failed", attempt: 1, message: "Denied" },
    ],
    effects: [
      { type: "toast", attempt: 1, title: "prompt.toast.sessionCreateFailed.title", message: "Denied" },
      { type: "tab.rollback", attempt: 1, worktree: { directory: "/wt", mcp: { figma: true } } },
    ],
  },
])("rolls back to the draft when $name", (row) => {
  const last = replay(row.events.slice(-1), replay(row.events.slice(0, -1)).state)

  expect(last.state).toEqual({ type: "idle", attempt: 1 })
  expect(last.effects).toEqual(row.effects)
})

test("ignores results from an earlier attempt", () => {
  const state = replay([
    start(fresh),
    { type: "worktree.failed", attempt: 1, message: "No space" },
    start(fresh, { figma: true }),
    { type: "worktree.created", attempt: 2, directory: "/wt" },
  ]).state

  expect(state).toMatchObject({ type: "mcp", attempt: 2 })

  const stale: NewSessionStartEvent[] = [
    { type: "worktree.created", attempt: 1, directory: "/stale" },
    { type: "worktree.failed", attempt: 1, message: "late" },
    { type: "mcp.prepared", attempt: 1 },
    { type: "mcp.failed", attempt: 1 },
    { type: "session.created", attempt: 1 },
    { type: "session.failed", attempt: 1, message: "late" },
  ]

  stale.forEach((event) => {
    const result = transitionNewSessionStart(state, event)
    expect(result.state).toBe(state)
    expect(result.effects).toEqual([])
  })
})

test("accepts a start only while the draft is idle", () => {
  const states = [
    replay([start(fresh)]).state,
    replay([start(main, { figma: true })]).state,
    replay([start(main)]).state,
    replay([start(main), { type: "session.created", attempt: 1 }]).state,
    replay([{ type: "dispose" }]).state,
  ]

  states.forEach((state) => {
    const result = transitionNewSessionStart(state, start(main))
    expect(result.state).toBe(state)
    expect(result.effects).toEqual([])
  })
})

test("disposing aborts only an active attempt and ends the machine", () => {
  expect(replay([start(main), { type: "dispose" }]).effects.at(-1)).toEqual({ type: "attempt.abort", attempt: 1 })
  expect(replay([{ type: "dispose" }]).effects).toEqual([])
  expect(replay([start(main), { type: "session.created", attempt: 1 }, { type: "dispose" }]).steps.at(-1)).toEqual({
    state: "disposed",
    effects: [],
  })

  const disposed = replay([start(main), { type: "dispose" }]).state
  const result = transitionNewSessionStart(disposed, { type: "session.created", attempt: 1 })
  expect(result.state).toBe(disposed)
  expect(result.effects).toEqual([])
})

test("the view names worktree creation and shows MCP preparation only during those phases", () => {
  expect(
    [
      replay([start(fresh, { figma: true })]).state,
      replay([start(fresh, { figma: true }), { type: "worktree.created", attempt: 1, directory: "/wt" }]).state,
      replay([start(main)]).state,
      createNewSessionStartState(),
    ].map(viewNewSessionStart),
  ).toEqual([
    { status: "session.new.worktree.creating", preparingMcp: false },
    { status: "session.new.starting", preparingMcp: true },
    { status: "session.new.starting", preparingMcp: false },
    { status: "session.new.starting", preparingMcp: false },
  ])
})
