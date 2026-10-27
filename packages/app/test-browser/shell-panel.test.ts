import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { SessionActivityItem } from "@/session/composer/activity-chips"
import type { ShellOutputInput, ShellOutputOutput } from "@opencode/client/promise"
import { createShellPanel, createShellTail } from "@/session/composer/shell-panel"

const server: SessionActivityItem = {
  key: "sh_dev",
  type: "shell",
  label: "bun run dev",
  target: "sh_dev",
  started: 1_000,
}
const watcher: SessionActivityItem = {
  key: "sh_test",
  type: "shell",
  label: "bun test --watch",
  target: "sh_test",
  started: 2_000,
}

type Ended = Awaited<ReturnType<Parameters<typeof createShellPanel>[0]["ended"]>>

function deferred<T>() {
  let resolve = (_: T) => {}
  const promise = new Promise<T>((done) => (resolve = done))

  return { promise, resolve }
}

function setup() {
  const [shells, setShells] = createSignal<readonly SessionActivityItem[]>([server, watcher])
  const stops: { item: SessionActivityItem; result: ReturnType<typeof deferred<boolean>> }[] = []
  const ends: { id: string; result: ReturnType<typeof deferred<Ended>> }[] = []

  return createRoot((dispose) => ({
    dispose,
    setShells,
    stops,
    ends,
    panel: createShellPanel({
      shells,
      stop: (item) => {
        const result = deferred<boolean>()
        stops.push({ item, result })

        return result.promise
      },
      ended: (id) => {
        const result = deferred<Ended>()
        ends.push({ id, result })

        return result.promise
      },
    }),
  }))
}

afterEach(() => {
  setSystemTime()
})

describe("createShellPanel", () => {
  test("opens one shell from the list and goes back", () => {
    const view = setup()

    expect(view.panel.state.shell).toBeUndefined()
    view.panel.open(watcher)
    expect(view.panel.state.shell?.key).toBe("sh_test")
    expect(view.panel.state.end).toBeUndefined()

    view.panel.back()
    expect(view.panel.state.shell).toBeUndefined()
    view.dispose()
  })

  test("Stop ends the shell as stopped without asking the server how it ended", async () => {
    const view = setup()
    view.panel.open(server)
    view.panel.stop()
    view.panel.stop()

    expect(view.stops.map((stop) => stop.item.key)).toEqual(["sh_dev"])
    expect(view.panel.state.stopping).toBe(true)

    // The removal reaches the running list before the request settles.
    view.setShells([watcher])
    setSystemTime(new Date(9_000))
    view.stops[0].result.resolve(true)
    await Promise.resolve()

    expect(view.ends).toEqual([])
    expect(view.panel.state.stopping).toBe(false)
    expect(view.panel.state.end).toEqual({ status: "killed", completed: 9_000 })
    expect(view.panel.state.shell?.key).toBe("sh_dev")
    view.dispose()
  })

  test("a failed Stop leaves the shell running", async () => {
    const view = setup()
    view.panel.open(server)
    view.panel.stop()
    view.stops[0].result.resolve(false)
    await Promise.resolve()

    expect(view.panel.state.stopping).toBe(false)
    expect(view.panel.state.end).toBeUndefined()
    view.dispose()
  })

  test("a shell that exits while shown keeps its panel with how it ended", async () => {
    const view = setup()
    view.panel.open(watcher)
    view.setShells([server])

    expect(view.ends.map((end) => end.id)).toEqual(["sh_test"])
    view.ends[0].result.resolve({ status: "exited", exit: 1, completed: 7_000 })
    await Promise.resolve()

    expect(view.panel.state.shell?.key).toBe("sh_test")
    expect(view.panel.state.end).toEqual({ status: "exited", exit: 1, completed: 7_000 })
    view.dispose()
  })

  test("a shell the server no longer knows ended as stopped", async () => {
    const view = setup()
    view.panel.open(watcher)
    setSystemTime(new Date(8_000))
    view.setShells([server])
    view.ends[0].result.resolve(undefined)
    await Promise.resolve()

    expect(view.panel.state.end).toEqual({ status: "killed", exit: undefined, completed: 8_000 })
    view.dispose()
  })

  test("an exit that settles after going back does not reopen the panel", async () => {
    const view = setup()
    view.panel.open(watcher)
    view.setShells([server])
    view.panel.back()
    view.ends[0].result.resolve({ status: "exited", exit: 0, completed: 7_000 })
    await Promise.resolve()

    expect(view.panel.state.shell).toBeUndefined()
    expect(view.panel.state.end).toBeUndefined()
    view.dispose()
  })

  test("a shell that left the list asks once how it ended while the list keeps changing", () => {
    const view = setup()
    view.panel.open(watcher)
    view.setShells([server])
    view.setShells([])
    view.setShells([server])

    expect(view.ends.map((end) => end.id)).toEqual(["sh_test"])
    expect(view.panel.state.ending).toBe(true)
    view.dispose()
  })

  test("Stop does nothing once the shell has left the list, so its real exit shows", async () => {
    const view = setup()
    view.panel.open(watcher)
    view.setShells([server])
    view.panel.stop()

    expect(view.stops).toEqual([])
    view.ends[0].result.resolve({ status: "exited", exit: 1, completed: 7_000 })
    await Promise.resolve()

    expect(view.panel.state.end).toEqual({ status: "exited", exit: 1, completed: 7_000 })
    expect(view.panel.state.ending).toBe(false)
    view.dispose()
  })
})

describe("createShellTail", () => {
  test("a first read still in flight when the shell ends still lands", async () => {
    const [running, setRunning] = createSignal(true)
    const reads: { input: ShellOutputInput; result: ReturnType<typeof deferred<ShellOutputOutput>> }[] = []
    const view = createRoot((dispose) => ({
      dispose,
      output: createShellTail({
        id: () => "sh_tail_inflight",
        directory: () => "/repo",
        running,
        load: (input) => {
          const result = deferred<ShellOutputOutput>()
          reads.push({ input, result })

          return result.promise
        },
      }),
    }))

    expect(reads.map((read) => read.input.cursor)).toEqual([0])
    setRunning(false)
    // The final snapshot starts over, but Stop already deleted the output.
    expect(reads.map((read) => read.input.cursor)).toEqual([0, 0])
    reads[0].result.resolve({
      location: { directory: "/repo" },
      data: { output: "$ bun test\nReady.\n", cursor: 18, size: 18, truncated: false },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(view.output()).toBe("$ bun test\nReady.\n")
    view.dispose()
  })
})
