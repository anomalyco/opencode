import type { ShellOutputInput, ShellOutputOutput } from "@opencode/client/promise"
import { createShellFollower } from "@opencode/session-ui/tools/shell-output"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import type { SessionActivityItem } from "./activity-chips"
import {
  createShellPanelState,
  selectShellPanelView,
  SHELL_END_TIMEOUT_MS,
  SHELL_STOP_TIMEOUT_MS,
  transitionShellPanel,
  type ShellEndInfo,
  type ShellPanelEffect,
  type ShellPanelEvent,
} from "./shell-panel-machine"

// Drives the background work menu: the list, one shell's panel, and where focus goes as they change.
export function createShellPanel(input: {
  enabled: () => boolean
  subagents: () => readonly SessionActivityItem[]
  shells: () => readonly SessionActivityItem[]
  stop: (item: SessionActivityItem) => Promise<boolean>
  // How a shell that left the running list ended; undefined once the server no longer knows it.
  ended: (id: string) => Promise<ShellEndInfo | undefined>
  // Focus moves a frame late: the menu refocuses itself when the selected row unmounts.
  focus: {
    back: () => void
    row: (key: string) => void
    empty: () => void
    ended: () => void
  }
}) {
  const work = () => ({ enabled: input.enabled(), subagents: input.subagents().length, shells: input.shells() })
  const initial = untrack(work)

  const [panelState, setPanelState] = createSignal(
    createShellPanelState({ active: initial.enabled && initial.subagents + initial.shells.length > 0 }),
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  let frame = 0

  const dispatch = (event: ShellPanelEvent) => {
    const next = transitionShellPanel(untrack(panelState), event)

    if (next.state !== untrack(panelState)) setPanelState(next.state)
    next.effects.forEach(run)
  }

  const current = (attempt: number) => {
    const state = untrack(panelState)

    return state.status !== "disposed" && state.attempt === attempt
  }

  const later = (move: () => void) => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(move)
  }

  function run(effect: ShellPanelEffect) {
    if (effect.type === "stop.run") {
      void Promise.try(() => input.stop(effect.item)).then(
        (stopped) => settleStop(effect.attempt, stopped),
        () => settleStop(effect.attempt, false),
      )

      return
    }

    if (effect.type === "ended.load") {
      void Promise.try(() => input.ended(effect.id)).then(
        (info) => dispatch({ type: "ended.settled", attempt: effect.attempt, info, now: Date.now() }),
        () => dispatch({ type: "ended.settled", attempt: effect.attempt, info: undefined, now: Date.now() }),
      )

      return
    }

    if (effect.type === "timer.start") {
      clearTimeout(timer)
      timer =
        effect.phase === "stopping"
          ? setTimeout(
              () => dispatch({ type: "stop.timed-out", attempt: effect.attempt, work: untrack(work) }),
              SHELL_STOP_TIMEOUT_MS,
            )
          : setTimeout(
              () => dispatch({ type: "ended.timed-out", attempt: effect.attempt, now: Date.now() }),
              SHELL_END_TIMEOUT_MS,
            )

      return
    }

    if (effect.type === "timer.cancel") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "focus.back") return later(() => current(effect.attempt) && input.focus.back())

    if (effect.type === "focus.row") return later(() => current(effect.attempt) && input.focus.row(effect.key))

    if (effect.type === "focus.empty") return later(input.focus.empty)

    if (effect.type === "focus.ended") return later(input.focus.ended)

    cancelAnimationFrame(frame)
  }

  const settleStop = (attempt: number, stopped: boolean) =>
    dispatch({ type: "stop.settled", attempt, stopped, work: untrack(work), now: Date.now() })

  createEffect(on(work, (value) => dispatch({ type: "work.synced", work: value }), { defer: true }))
  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    view: createMemo(() => selectShellPanelView(panelState(), work())),
    toggle: (open: boolean) => dispatch({ type: "menu.toggled", open, work: untrack(work) }),
    open: (item: SessionActivityItem) => dispatch({ type: "shell.selected", item, work: untrack(work) }),
    back: () => dispatch({ type: "back.requested", work: untrack(work) }),
    stop: () => dispatch({ type: "stop.requested", work: untrack(work) }),
  }
}

// Follows one shell's output. When the shell ends the follower keeps a read still in flight and reads the final
// snapshot from its cursor: a stopped shell's output is deleted, so a fresh read from the start would find nothing.
export function createShellTail(input: {
  id: () => string
  directory: () => string
  running: () => boolean
  load: (input: ShellOutputInput) => Promise<ShellOutputOutput>
}) {
  const [output, setOutput] = createSignal("")

  createEffect(
    on(
      () => [input.id(), input.directory()] as const,
      ([id, directory]) => {
        setOutput("")

        const follower = createShellFollower({
          id,
          directory,
          running: untrack(input.running),
          load: input.load,
          onOutput: setOutput,
        })

        createEffect(on(input.running, follower.setRunning, { defer: true }))
        onCleanup(follower.dispose)
      },
    ),
  )

  return output
}
