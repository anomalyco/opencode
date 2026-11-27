import { describe, expect, test, vi } from "bun:test"
import type { ShellOutputInput, ShellOutputOutput } from "@opencode/client/promise"
import { createShellFollower, followShellOutput } from "./shell-output"
import { SHELL_OUTPUT_TAIL_BYTES, SHELL_READ_TIMEOUT_MS } from "./shell-output-machine"

const location = { directory: "/repo", project: { id: "project", directory: "/repo", canonical: "/repo" } }

// Serves the current text from the requested cursor, at most one page per request.
function server(text: () => string, page = Infinity) {
  const cursors: number[] = []

  return {
    cursors,
    load: (input: ShellOutputInput): Promise<ShellOutputOutput> => {
      const cursor = input.cursor ?? 0
      cursors.push(cursor)
      const full = text()
      const output = full.slice(cursor, cursor + page)

      return Promise.resolve({
        location,
        data: { output, cursor: cursor + output.length, size: full.length, truncated: false },
      })
    },
  }
}

// Reads settle within a few microtasks; timers are faked so this never waits on the clock.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

// SAFETY: the promise client rejects with this plain decoded object; session-ui has no tagged error class for it.
// oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- see SAFETY above
const notFound = (id: string) => ({ _tag: "ShellNotFoundError", id, message: "Shell command not found" })

describe("followShellOutput", () => {
  test("stops polling a missing shell and never requests it again", async () => {
    vi.useFakeTimers()

    try {
      const cursors: number[] = []

      const load = (input: ShellOutputInput): Promise<ShellOutputOutput> => {
        cursors.push(input.cursor ?? 0)

        return Promise.reject(notFound(input.id))
      }

      const follow = () =>
        followShellOutput({ id: "shell_missing", directory: "/repo", running: true, load, onOutput() {} })

      const stop = follow()
      await flush()
      expect(cursors).toEqual([0])

      vi.advanceTimersByTime(10_000)
      await flush()
      expect(cursors).toEqual([0])

      stop()
      const remounted = follow()
      await flush()
      vi.advanceTimersByTime(10_000)
      remounted()
      expect(cursors).toEqual([0])
    } finally {
      vi.useRealTimers()
    }
  })

  test("polls a running shell once per second and resumes from the cached cursor after a remount", async () => {
    vi.useFakeTimers()

    try {
      let text = "hello\n"
      const shell = server(() => text)
      const outputs: string[] = []

      const follow = (running: boolean) =>
        followShellOutput({
          id: "shell_live",
          directory: "/repo",
          running,
          load: shell.load,
          onOutput: (output) => outputs.push(output),
        })

      const first = follow(true)
      await flush()
      expect(outputs.at(-1)).toBe("hello\n")

      text += "world\n"
      vi.advanceTimersByTime(1_000)
      await flush()
      expect(shell.cursors).toEqual([0, 6])
      expect(outputs.at(-1)).toBe("hello\nworld\n")

      first()
      text += "done\n"
      const second = follow(true)
      await flush()
      expect(shell.cursors).toEqual([0, 6, 12])
      expect(outputs.at(-1)).toBe("hello\nworld\ndone\n")

      second()
      const exited = follow(false)
      await flush()
      exited()
      expect(shell.cursors).toEqual([0, 6, 12, 17])

      outputs.length = 0
      follow(false)()
      await flush()
      expect(shell.cursors).toEqual([0, 6, 12, 17])
      expect(outputs).toEqual(["hello\nworld\ndone\n"])

      // The running-shell inventory can arrive late; a complete shell believed to be live is re-read from its cursor.
      follow(true)()
      expect(shell.cursors).toEqual([0, 6, 12, 17, 17])
    } finally {
      vi.useRealTimers()
    }
  })

  test("keeps only the most recent tail of a large output", async () => {
    const shell = server(() => "a".repeat(SHELL_OUTPUT_TAIL_BYTES) + "tail", SHELL_OUTPUT_TAIL_BYTES)
    const outputs: string[] = []
    followShellOutput({
      id: "shell_large",
      directory: "/repo",
      running: false,
      load: shell.load,
      onOutput: (output) => outputs.push(output),
    })
    await flush()
    expect(shell.cursors).toEqual([0, SHELL_OUTPUT_TAIL_BYTES])
    expect(outputs.at(-1)?.length).toBe(SHELL_OUTPUT_TAIL_BYTES)
    expect(outputs.at(-1)?.endsWith("a".repeat(8) + "tail")).toBe(true)
  })

  test("retries a transient failure while reading an exited shell", async () => {
    vi.useFakeTimers()

    try {
      const shell = server(() => "done\n")
      let failures = 2
      const outputs: string[] = []

      followShellOutput({
        id: "shell_flaky",
        directory: "/repo",
        running: false,
        load: (input) => (failures-- > 0 ? Promise.reject(new Error("offline")) : shell.load(input)),
        onOutput: (output) => outputs.push(output),
      })

      await flush()
      vi.advanceTimersByTime(1_000)
      await flush()
      vi.advanceTimersByTime(2_000)
      await flush()
      expect(outputs.at(-1)).toBe("done\n")
    } finally {
      vi.useRealTimers()
    }
  })

  test("times out a hung read and reads again", async () => {
    vi.useFakeTimers()

    try {
      const shell = server(() => "alive\n")
      const cursors: number[] = []
      const outputs: string[] = []

      const follower = createShellFollower({
        id: "shell_hung",
        directory: "/repo",
        running: true,
        load: (input) => {
          cursors.push(input.cursor ?? 0)

          return cursors.length === 1 ? new Promise(() => {}) : shell.load(input)
        },
        onOutput: (output) => outputs.push(output),
      })

      vi.advanceTimersByTime(SHELL_READ_TIMEOUT_MS + 1_000)
      await flush()
      follower.dispose()
      expect(cursors).toEqual([0, 0])
      expect(outputs).toEqual(["alive\n"])
    } finally {
      vi.useRealTimers()
    }
  })

  test("never requests a missing shell again after viewing many other shells", async () => {
    let missingReads = 0

    const follow = () =>
      followShellOutput({
        id: "shell_gone",
        directory: "/repo",
        running: false,
        load: (input) => {
          missingReads++

          return Promise.reject(notFound(input.id))
        },
        onOutput() {},
      })

    follow()
    await flush()

    for (let i = 0; i < 40; i++) {
      const shell = server(() => "x".repeat(SHELL_OUTPUT_TAIL_BYTES))
      followShellOutput({ id: `shell_other_${i}`, directory: "/repo", running: false, load: shell.load, onOutput() {} })
    }

    await flush()
    follow()
    expect(missingReads).toBe(1)
  })
})
