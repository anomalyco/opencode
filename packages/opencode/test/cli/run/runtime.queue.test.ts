import { describe, expect, test } from "bun:test"
import { runPromptQueue } from "@/cli/cmd/run/runtime.queue"
import type { FooterApi, FooterEvent, RunPrompt, StreamCommit } from "@/cli/cmd/run/types"

function footer() {
  const prompts = new Set<(input: RunPrompt) => void>()
  const closes = new Set<() => void>()
  const events: FooterEvent[] = []
  const commits: StreamCommit[] = []
  let closed = false

  const api: FooterApi = {
    get isClosed() {
      return closed
    },
    onPrompt(fn) {
      prompts.add(fn)
      return () => {
        prompts.delete(fn)
      }
    },
    onClose(fn) {
      if (closed) {
        fn()
        return () => {}
      }

      closes.add(fn)
      return () => {
        closes.delete(fn)
      }
    },
    event(next) {
      events.push(next)
    },
    append(next) {
      commits.push(next)
    },
    idle() {
      return Promise.resolve()
    },
    close() {
      if (closed) {
        return
      }

      closed = true
      for (const fn of [...closes]) {
        fn()
      }
    },
    destroy() {
      api.close()
      prompts.clear()
      closes.clear()
    },
  }

  return {
    api,
    events,
    commits,
    submit(text: string) {
      const next = { text, parts: [] as RunPrompt["parts"] }
      for (const fn of [...prompts]) {
        fn(next)
      }
    },
  }
}

describe("run runtime queue", () => {
  test("ignores empty prompts", async () => {
    const ui = footer()
    let calls = 0

    const task = runPromptQueue({
      footer: ui.api,
      run: async () => {
        calls += 1
      },
    })

    ui.submit("   ")
    ui.api.close()
    await task

    expect(calls).toBe(0)
  })

  test("treats /exit as a close command", async () => {
    const ui = footer()
    let calls = 0

    const task = runPromptQueue({
      footer: ui.api,
      run: async () => {
        calls += 1
      },
    })

    ui.submit("/exit")
    await task

    expect(calls).toBe(0)
  })

  test("treats /new as a local session command", async () => {
    const ui = footer()
    const seen: string[] = []
    let created = 0

    const task = runPromptQueue({
      footer: ui.api,
      onNewSession: async () => {
        created += 1
      },
      run: async (input) => {
        seen.push(input.text)
        ui.api.close()
      },
    })

    ui.submit("/new")
    ui.submit("hello")
    await task

    expect(created).toBe(1)
    expect(seen).toEqual(["hello"])
    expect(ui.commits).toEqual([
      {
        kind: "user",
        text: "hello",
        phase: "start",
        source: "system",
      },
    ])
  })

  test("preserves whitespace for initial input", async () => {
    const ui = footer()
    const seen: string[] = []

    await runPromptQueue({
      footer: ui.api,
      initialInput: "  hello  ",
      run: async (input) => {
        seen.push(input.text)
        ui.api.close()
      },
    })

    expect(seen).toEqual(["  hello  "])
    expect(ui.commits).toEqual([
      {
        kind: "user",
        text: "  hello  ",
        phase: "start",
        source: "system",
      },
    ])
  })

  test("passes prompts to onSend", async () => {
    const ui = footer()
    const seen: string[] = []

    await runPromptQueue({
      footer: ui.api,
      initialInput: "  hello  ",
      onSend: (input) => {
        seen.push(input.text)
      },
      run: async () => {
        ui.api.close()
      },
    })

    expect(seen).toEqual(["  hello  "])
  })

  test("appends the user row before the turn starts", async () => {
    const ui = footer()

    await runPromptQueue({
      footer: ui.api,
      initialInput: "/fmt bash",
      run: async () => {
        expect(ui.commits).toEqual([
          {
            kind: "user",
            text: "/fmt bash",
            phase: "start",
            source: "system",
          },
        ])
        ui.api.close()
      },
    })
  })

  test("runs queued prompts in order", async () => {
    const ui = footer()
    const seen: string[] = []
    let wake: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      wake = resolve
    })

    const task = runPromptQueue({
      footer: ui.api,
      run: async (input) => {
        seen.push(input.text)
        if (seen.length === 1) {
          await gate
          return
        }

        ui.api.close()
      },
    })

    ui.submit("one")
    ui.submit("two")
    await Promise.resolve()
    expect(seen).toEqual(["one"])

    wake?.()
    await task

    expect(seen).toEqual(["one", "two"])
  })

  test("drains a prompt queued during an in-flight turn", async () => {
    const ui = footer()
    const seen: string[] = []
    let wake: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      wake = resolve
    })

    const task = runPromptQueue({
      footer: ui.api,
      run: async (input) => {
        seen.push(input.text)
        if (seen.length === 1) {
          await gate
          return
        }

        ui.api.close()
      },
    })

    ui.submit("one")
    await Promise.resolve()
    expect(seen).toEqual(["one"])

    wake?.()
    await Promise.resolve()
    ui.submit("two")
    await task

    expect(seen).toEqual(["one", "two"])
  })

  test("close aborts the active run and drops pending queued work", async () => {
    const ui = footer()
    const seen: string[] = []
    let hit = false

    const task = runPromptQueue({
      footer: ui.api,
      run: async (input, signal) => {
        seen.push(input.text)
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            hit = true
            resolve()
            return
          }

          signal.addEventListener(
            "abort",
            () => {
              hit = true
              resolve()
            },
            { once: true },
          )
        })
      },
    })

    ui.submit("one")
    await Promise.resolve()
    ui.submit("two")
    ui.api.close()
    await task

    expect(hit).toBe(true)
    expect(seen).toEqual(["one"])
  })

  test("propagates run errors", async () => {
    const ui = footer()

    const task = runPromptQueue({
      footer: ui.api,
      run: async () => {
        throw new Error("boom")
      },
    })

    ui.submit("one")
    await expect(task).rejects.toThrow("boom")
  })
})
