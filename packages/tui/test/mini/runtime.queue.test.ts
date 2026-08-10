import { describe, expect, test } from "bun:test"
import { runPromptQueue as runPromptQueueBase, type QueueInput } from "../../src/mini/runtime.queue"
import type { RunPrompt } from "../../src/mini/types"
import { createFooterApiFixture } from "./fixture/footer-api"

function runPromptQueue(input: Omit<QueueInput, "admit" | "settle"> & Partial<Pick<QueueInput, "admit" | "settle">>) {
  return runPromptQueueBase({
    admit: async () => {},
    settle: async () => {},
    ...input,
  })
}

describe("run runtime queue", () => {
  test("ignores empty prompts", async () => {
    const ui = createFooterApiFixture()
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
    const ui = createFooterApiFixture()
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
    const ui = createFooterApiFixture()
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
        messageID: expect.any(String),
      },
    ])
  })

  test("treats /compact as a local compaction command", async () => {
    const ui = createFooterApiFixture()
    const seen: string[] = []
    let compacted = 0

    const task = runPromptQueue({
      footer: ui.api,
      onCompact: async () => {
        compacted += 1
      },
      run: async (input) => {
        seen.push(input.text)
        ui.api.close()
      },
    })

    ui.submit("/compact")
    ui.submit("hello")
    await task

    expect(compacted).toBe(1)
    expect(seen).toEqual(["hello"])
    expect(ui.commits.map((item) => item.text)).toEqual(["hello"])
  })

  test("keeps prompts submitted after an in-flight /compact behind the compaction barrier", async () => {
    const ui = createFooterApiFixture()
    const active = Promise.withResolvers<void>()
    const order: string[] = []

    const task = runPromptQueue({
      footer: ui.api,
      onCompact: async () => {
        order.push("compact")
      },
      admit: async (prompt) => {
        order.push(`admit:${prompt.text}`)
      },
      run: async (prompt) => {
        order.push(`run:${prompt.text}`)
        if (prompt.text === "first") await active.promise
        if (prompt.text === "later") ui.api.close()
      },
    })

    ui.submit("first")
    await Promise.resolve()
    ui.submit("/compact")
    ui.submit("later")
    await Promise.resolve()
    expect(order).toEqual(["run:first"])

    active.resolve()
    await task
    expect(order).toEqual(["run:first", "compact", "run:later"])
  })

  test("shell mode submits /exit as a shell command", async () => {
    const ui = createFooterApiFixture()
    const seen: RunPrompt[] = []

    const task = runPromptQueue({
      footer: ui.api,
      run: async (input) => {
        seen.push(input)
        ui.api.close()
      },
    })

    ui.submit("/exit", "shell")
    await task

    expect(seen).toEqual([{ text: "/exit", parts: [], mode: "shell" }])
    expect(ui.commits).toEqual([])
  })

  test("shell mode submits /new instead of creating a session", async () => {
    const ui = createFooterApiFixture()
    const seen: RunPrompt[] = []
    let created = 0

    const task = runPromptQueue({
      footer: ui.api,
      onNewSession: async () => {
        created += 1
      },
      run: async (input) => {
        seen.push(input)
        ui.api.close()
      },
    })

    ui.submit("/new", "shell")
    await task

    expect(created).toBe(0)
    expect(seen).toEqual([{ text: "/new", parts: [], mode: "shell" }])
    expect(ui.commits).toEqual([])
  })

  test("shell mode does not append a synthetic user row", async () => {
    const ui = createFooterApiFixture()

    const task = runPromptQueue({
      footer: ui.api,
      run: async () => {
        expect(ui.commits).toEqual([])
        ui.api.close()
      },
    })

    ui.submit("ls", "shell")
    await task
  })

  test("shell mode does not emit a turn duration summary", async () => {
    const ui = createFooterApiFixture()

    const task = runPromptQueue({
      footer: ui.api,
      run: async () => {
        ui.api.close()
      },
    })

    ui.submit("ls", "shell")
    await task

    expect(ui.events.some((event) => event.type === "turn.duration")).toBe(false)
  })

  test("preserves whitespace for initial input", async () => {
    const ui = createFooterApiFixture()
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
        messageID: expect.any(String),
      },
    ])
  })

  test("durably admits in-flight follow-ups in submission order", async () => {
    const ui = createFooterApiFixture()
    const admitted: string[] = []
    const gate = Promise.withResolvers<void>()

    const task = runPromptQueue({
      footer: ui.api,
      run: async (input, _signal, onAdmitted) => {
        admitted.push(`${input.text}:steer`)
        onAdmitted()
        await gate.promise
      },
      admit: async (input) => {
        admitted.push(`${input.text}:queue`)
      },
      settle: async () => ui.api.close(),
    })

    ui.submit("one")
    ui.submit("two")
    ui.submit("three")
    while (admitted.length < 3) await Bun.sleep(0)
    expect(admitted).toEqual(["one:steer", "two:queue", "three:queue"])
    expect(ui.commits.map((item) => item.text)).toEqual(["one"])

    gate.resolve()
    await task
  })

  test("preserves explicit steer and queue delivery for in-flight prompts", async () => {
    const ui = createFooterApiFixture()
    const admitted: string[] = []
    const gate = Promise.withResolvers<void>()

    const task = runPromptQueue({
      footer: ui.api,
      run: async (_input, _signal, onAdmitted) => {
        onAdmitted()
        await gate.promise
      },
      admit: async (input, delivery) => {
        admitted.push(`${input.text}:${delivery}`)
      },
      settle: async () => ui.api.close(),
    })

    ui.submit("one")
    ui.submit("two", undefined, "steer")
    ui.submit("three", undefined, "queue")
    while (admitted.length < 2) await Bun.sleep(0)
    expect(admitted).toEqual(["two:steer", "three:queue"])

    gate.resolve()
    await task
  })

  test("continues durable admission after one fails", async () => {
    const ui = createFooterApiFixture()
    const admitted: string[] = []
    const errors: string[] = []
    const gate = Promise.withResolvers<void>()
    const task = runPromptQueue({
      footer: ui.api,
      run: async (_input, _signal, admitted) => {
        admitted()
        await gate.promise
      },
      admit: async (input) => {
        if (input.text === "two") throw new Error("admission failed")
        admitted.push(input.text)
      },
      onAdmissionError: (_prompt, error) => {
        errors.push(error instanceof Error ? error.message : String(error))
      },
      settle: async () => ui.api.close(),
    })

    ui.submit("one")
    ui.submit("two")
    ui.submit("three")
    while (admitted.length === 0) await Bun.sleep(0)
    gate.resolve()
    await task

    expect(errors).toEqual(["admission failed"])
    expect(admitted).toEqual(["three"])
  })

  test("close aborts an in-flight durable admission", async () => {
    const ui = createFooterApiFixture()
    let admissionHit = false
    const admissionStarted = Promise.withResolvers<void>()

    const task = runPromptQueue({
      footer: ui.api,
      run: async (_input, signal, admitted) => {
        admitted()
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      },
      admit: async (_prompt, _delivery, signal) => {
        admissionStarted.resolve()
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            admissionHit = true
            resolve()
            return
          }
          signal.addEventListener(
            "abort",
            () => {
              admissionHit = true
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
    await admissionStarted.promise
    ui.api.close()
    await task

    expect(admissionHit).toBe(true)
  })

  test.each([
    ["session", undefined, false],
    ["shell", "shell", true],
  ] as const)("close handles an active %s turn", async (_name, mode, aborted) => {
    const ui = createFooterApiFixture()
    const started = Promise.withResolvers<AbortSignal>()
    const active = Promise.withResolvers<void>()
    const task = runPromptQueue({
      footer: ui.api,
      run: async (_input, signal) => {
        started.resolve(signal)
        await active.promise
      },
    })

    ui.submit("one", mode)
    const signal = await started.promise
    ui.api.close()
    await task

    expect(signal.aborted).toBe(aborted)
    active.resolve()
  })

  test("propagates run errors", async () => {
    const ui = createFooterApiFixture()

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
