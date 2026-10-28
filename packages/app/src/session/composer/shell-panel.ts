import type { ShellOutputInput, ShellOutputOutput } from "@opencode/client/promise"
import { followShellOutput } from "@opencode/session-ui/tools/shell-output"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionActivityItem } from "./activity-chips"

export type ShellEnd = {
  status: "exited" | "timeout" | "killed"
  exit?: number
  // When the shell stopped, so its run time freezes there.
  completed: number
}

// The background work menu shows either the list or one shell. A shell that ends while it is shown keeps its panel,
// with how it ended, until the user goes back or closes the menu.
export function createShellPanel(input: {
  shells: () => readonly SessionActivityItem[]
  stop: (item: SessionActivityItem) => Promise<boolean>
  // How a shell that left the running list ended; undefined once the server no longer knows it.
  ended: (id: string) => Promise<(Omit<ShellEnd, "completed"> & { completed?: number }) | undefined>
}) {
  // `ending` covers the wait for how a shell that left the list ended.
  const [state, setState] = createStore<{
    shell?: SessionActivityItem
    stopping: boolean
    ending: boolean
    end?: ShellEnd
  }>({ stopping: false, ending: false })

  const shown = (key: string) => state.shell?.key === key

  createEffect(
    on(
      () => [state.shell, state.end, state.stopping, state.ending, input.shells()] as const,
      ([shell, end, stopping, ending, shells]) => {
        if (!shell || end || stopping || ending || shells.some((item) => item.key === shell.key)) return
        const key = shell.key
        setState("ending", true)

        void input.ended(shell.target).then((info) => {
          if (!shown(key) || state.end) return
          // Removing a running shell ends it as killed, and the server forgets it.
          setState({
            ending: false,
            end: {
              status: info?.status ?? "killed",
              exit: info?.exit,
              completed: info?.completed ?? Date.now(),
            },
          })
        })
      },
    ),
  )

  return {
    state,
    open(item: SessionActivityItem) {
      setState({ shell: item, stopping: false, ending: false, end: undefined })
    },
    back() {
      setState({ shell: undefined, stopping: false, ending: false, end: undefined })
    },
    stop() {
      const item = state.shell

      // A shell that already left the list is ending on its own; stopping it now would report it as stopped.
      if (!item || state.end || state.stopping || !input.shells().some((shell) => shell.key === item.key)) return
      setState("stopping", true)
      void input.stop(item).then((stopped) => {
        if (!shown(item.key)) return

        if (stopped && !state.end) setState("end", { status: "killed", completed: Date.now() })
        setState("stopping", false)
      })
    },
  }
}

// Follows one shell's output. When the shell ends the follow restarts for its final snapshot, but a first read still in
// flight is left to land: a stopped shell's output is deleted, so a fresh read from the start would find nothing.
export function createShellTail(input: {
  id: () => string
  directory: () => string
  running: () => boolean
  load: (input: ShellOutputInput) => Promise<ShellOutputOutput>
}) {
  const [output, setOutput] = createSignal("")
  const retiring = new Set<() => void>()

  createEffect(() => {
    const id = input.id()
    let loaded = false
    let retired = false

    const dispose = () => {
      retiring.delete(dispose)
      stop()
    }

    const stop = followShellOutput({
      id,
      directory: input.directory(),
      running: input.running(),
      load: input.load,
      onOutput: (text) => {
        loaded = true

        if (!retired || input.id() === id) setOutput(text)

        if (retired) dispose()
      },
    })

    onCleanup(() => {
      retired = true

      if (loaded) return dispose()
      retiring.add(dispose)
    })
  })

  onCleanup(() => retiring.forEach((dispose) => dispose()))

  return output
}
