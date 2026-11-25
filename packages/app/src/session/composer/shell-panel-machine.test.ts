import { expect, test } from "bun:test"
import type { SessionActivityItem } from "./activity-chips"
import {
  createShellPanelState,
  selectShellPanelView,
  transitionShellPanel,
  type ShellPanelEffect,
  type ShellPanelEvent,
  type ShellPanelState,
  type ShellPanelWork,
} from "./shell-panel-machine"

const server: SessionActivityItem = { key: "sh_dev", type: "shell", label: "bun run dev", target: "sh_dev", started: 1 }

const watcher: SessionActivityItem = {
  key: "sh_test",
  type: "shell",
  label: "bun test --watch",
  target: "sh_test",
  started: 2,
}

const work = (
  shells: readonly SessionActivityItem[],
  subagents: readonly SessionActivityItem[] = [],
): ShellPanelWork => ({
  enabled: true,
  subagents,
  shells,
})

const both = work([server, watcher])

function replay(events: ShellPanelEvent[], from = createShellPanelState({ active: true })) {
  return events.reduce<{ state: ShellPanelState; effects: readonly ShellPanelEffect[] }>(
    (current, event) => transitionShellPanel(current.state, event),
    { state: from, effects: [] },
  )
}

// The attempt of the Stop in flight for `item`, or of the shown shell's end lookup.
const stopOf = (state: ShellPanelState, item: SessionActivityItem) =>
  state.status === "disposed" ? -1 : (state.stopping[item.key] ?? -1)

const endingOf = (state: ShellPanelState) =>
  state.status === "shell" && state.phase.status === "ending" ? state.phase.attempt : -1

test("a row's Stop sends once until it settles, and a stop that never settles gives the row back", () => {
  const listed = replay([{ type: "menu.toggled", open: true, work: both }]).state
  const first = transitionShellPanel(listed, { type: "stop.requested", item: server, work: both })
  const attempt = stopOf(first.state, server)

  expect(first.effects).toEqual([
    { type: "stop.run", attempt, item: server },
    { type: "timer.start", attempt, phase: "stopping" },
  ])
  expect(selectShellPanelView(first.state, both).stoppingKeys).toEqual({ sh_dev: attempt })
  // A double click or a second Delete.
  expect(transitionShellPanel(first.state, { type: "stop.requested", item: server, work: both }).state).toBe(
    first.state,
  )

  const timedOut = transitionShellPanel(first.state, { type: "stop.timed-out", attempt, work: both })

  expect(timedOut.effects).toEqual([{ type: "timer.cancel", attempt }])
  expect(selectShellPanelView(timedOut.state, both).stoppingKeys).toEqual({})
  expect(
    transitionShellPanel(timedOut.state, { type: "stop.requested", item: server, work: both }).effects,
  ).toContainEqual(expect.objectContaining({ type: "stop.run", item: server }))
})

test("a subagent row can stop its child while it is listed", () => {
  const child: SessionActivityItem = {
    key: "ses_child",
    type: "subagent",
    target: "ses_child",
    sessionID: "ses_child",
    started: 1,
  }

  const running = work([], [child])
  const listed = replay([{ type: "menu.toggled", open: true, work: running }]).state

  expect(transitionShellPanel(listed, { type: "stop.requested", item: child, work: work([]) }).state).toBe(listed)
  expect(transitionShellPanel(listed, { type: "stop.requested", item: child, work: running }).effects).toContainEqual(
    expect.objectContaining({ type: "stop.run", item: child }),
  )
})

test("a shell stopped from its row opens stopping, and the row's Stop settles the panel", () => {
  const stopping = replay([
    { type: "menu.toggled", open: true, work: both },
    { type: "stop.requested", item: server, work: both },
    { type: "shell.selected", item: server, work: both },
  ]).state

  expect(selectShellPanelView(stopping, both)).toMatchObject({ stopping: true, stopDisabled: true })
  expect(transitionShellPanel(stopping, { type: "stop.requested", work: both }).state).toBe(stopping)

  const ended = transitionShellPanel(stopping, {
    type: "stop.settled",
    attempt: stopOf(stopping, server),
    stopped: true,
    work: work([watcher]),
    now: 5,
  })

  expect(selectShellPanelView(ended.state, work([watcher])).end).toEqual({ status: "killed", completed: 5 })
})

test("going back keeps a Stop in flight, so reopening the shell shows it stopping and a late answer settles it", () => {
  const first = replay([
    { type: "menu.toggled", open: true, work: both },
    { type: "shell.selected", item: server, work: both },
    { type: "stop.requested", work: both },
  ]).state

  const attempt = stopOf(first, server)
  const listed = transitionShellPanel(first, { type: "back.requested", work: both })

  expect(listed.effects).not.toContainEqual(expect.objectContaining({ type: "timer.cancel" }))
  expect(selectShellPanelView(listed.state, both).stoppingKeys).toEqual({ sh_dev: attempt })
  expect(transitionShellPanel(listed.state, { type: "stop.requested", item: server, work: both }).state).toBe(
    listed.state,
  )

  const reopened = transitionShellPanel(listed.state, { type: "shell.selected", item: server, work: both }).state

  expect(selectShellPanelView(reopened, both).stopDisabled).toBe(true)

  // The first Stop times out, so a second one starts; the first one's late answer cannot settle it.
  const retried = replay(
    [
      { type: "stop.timed-out", attempt, work: both },
      { type: "stop.requested", work: both },
    ],
    reopened,
  ).state

  const stale = transitionShellPanel(retried, { type: "stop.settled", attempt, stopped: false, work: both, now: 5 })

  expect(stale.state).toBe(retried)
  expect(selectShellPanelView(stale.state, both).stopDisabled).toBe(true)
})

test("a stop that never settles gives the button back, or ends the shell that left the list meanwhile", () => {
  const stopping = replay([
    { type: "shell.selected", item: server, work: both },
    { type: "stop.requested", work: both },
  ]).state

  const attempt = stopOf(stopping, server)
  const kept = transitionShellPanel(stopping, { type: "stop.timed-out", attempt, work: both })

  expect(kept.state).toMatchObject({ status: "shell", phase: { status: "running" } })
  expect(selectShellPanelView(kept.state, both).stopDisabled).toBe(false)
  expect(kept.effects).toEqual([{ type: "timer.cancel", attempt }])

  const gone = transitionShellPanel(stopping, { type: "stop.timed-out", attempt, work: work([watcher]) })

  expect(gone.state).toMatchObject({ status: "shell", phase: { status: "ending" } })
  expect(gone.effects).toEqual([
    { type: "timer.cancel", attempt },
    { type: "ended.load", attempt: endingOf(gone.state), id: "sh_dev" },
    { type: "timer.start", attempt: endingOf(gone.state), phase: "ending" },
  ])
})

test("a failed Stop after the shell already left the list asks at once how it ended", () => {
  const stopping = replay([
    { type: "shell.selected", item: server, work: both },
    { type: "stop.requested", work: both },
  ]).state

  const next = transitionShellPanel(stopping, {
    type: "stop.settled",
    attempt: stopOf(stopping, server),
    stopped: false,
    work: work([watcher]),
    now: 5,
  })

  expect(next.effects).toContainEqual({ type: "ended.load", attempt: endingOf(next.state), id: "sh_dev" })
})

test("an exit that never arrives settles the panel as stopped and stops the output and clock", () => {
  const ending = replay([
    { type: "shell.selected", item: watcher, work: both },
    { type: "work.synced", work: work([server]) },
  ]).state

  expect(selectShellPanelView(ending, work([server]))).toMatchObject({ stopDisabled: true, tailRunning: false })

  const attempt = endingOf(ending)
  const next = transitionShellPanel(ending, { type: "ended.timed-out", attempt, now: 9 })
  const view = selectShellPanelView(next.state, work([server]))

  expect(view.end).toEqual({ status: "killed", exit: undefined, completed: 9 })
  expect(view.clockRunning).toBe(false)
  expect(next.effects).toEqual([{ type: "timer.cancel", attempt }, { type: "focus.ended" }])
  // The timer and the late answer cannot settle it again.
  expect(
    transitionShellPanel(next.state, {
      type: "ended.settled",
      attempt,
      info: { status: "exited", exit: 0 },
      now: 10,
    }).state,
  ).toBe(next.state)
})

test("an ended shell keeps counting until the menu closes, then the capsule fades in next time", () => {
  const shown = replay([
    { type: "menu.toggled", open: true, work: work([watcher]) },
    { type: "shell.selected", item: watcher, work: work([watcher]) },
    { type: "work.synced", work: work([]) },
  ]).state

  const ended = transitionShellPanel(shown, {
    type: "ended.settled",
    attempt: endingOf(shown),
    info: { status: "exited", exit: 1, completed: 7 },
    now: 8,
  }).state

  expect(selectShellPanelView(ended, work([]))).toMatchObject({ active: true, counts: { shells: 1 } })

  const closed = transitionShellPanel(ended, { type: "menu.toggled", open: false, work: work([]) })
  expect(closed.state).toMatchObject({ status: "closed", enter: true })
  expect(closed.effects).toEqual([{ type: "focus.cancel" }, { type: "focus.empty" }])
  expect(selectShellPanelView(closed.state, work([])).active).toBe(false)
})

test("going back lists the remaining work, or closes the menu when nothing is left", () => {
  const shown = replay([
    { type: "menu.toggled", open: true, work: both },
    { type: "shell.selected", item: watcher, work: both },
  ]).state

  const listed = transitionShellPanel(shown, { type: "back.requested", work: work([server]) })
  expect(listed.state).toMatchObject({ status: "list", enter: false })
  expect(listed.effects).toEqual([
    { type: "focus.cancel" },
    { type: "focus.row", attempt: listed.state.status === "list" ? listed.state.focusAttempt : -1, key: "sh_test" },
  ])

  const closed = transitionShellPanel(shown, { type: "back.requested", work: work([]) })
  expect(closed.state).toMatchObject({ status: "closed", enter: true })
  expect(closed.effects).toContainEqual({ type: "focus.empty" })
})

test("disposing cancels every timer and the pending focus and ignores later results", () => {
  const ending = replay([{ type: "shell.selected", item: watcher, work: work([server]) }]).state
  const disposed = transitionShellPanel(ending, { type: "disposed" })

  expect(disposed.effects).toEqual([{ type: "timer.cancel" }, { type: "focus.cancel" }])
  expect(
    transitionShellPanel(disposed.state, { type: "ended.settled", attempt: endingOf(ending), info: undefined, now: 1 })
      .state,
  ).toBe(disposed.state)
})
