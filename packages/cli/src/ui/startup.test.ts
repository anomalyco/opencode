import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber } from "effect"
import { withStartupProgress } from "./startup"

describe("startup progress", () => {
  test("fast startup releases without creating a progress host", async () => {
    const timer = manualTimer()
    const progress = progressHost()
    const events: string[] = []
    let created = 0

    await Effect.runPromise(
      withStartupProgress(
        (startup) =>
          attempt(async () => {
            events.push("preflight")
            await startup.releaseTerminal()
            events.push("renderer")
          }),
        interactive(timer, async () => {
          created++
          return progress.host
        }),
      ),
    )

    expect(await timer.scheduled).toBe(500)
    expect(timer.cancelled()).toBe(true)
    expect(created).toBe(0)
    expect(progress.closed()).toBe(0)
    expect(events).toEqual(["preflight", "renderer"])
  })

  test("delayed startup stays visible through preflight", async () => {
    const timer = manualTimer()
    const events: string[] = []
    const progress = progressHost({ events })
    const preflight = Promise.withResolvers<void>()
    const running = Effect.runPromise(
      withStartupProgress(
        (startup) =>
          attempt(async () => {
            events.push("server")
            await preflight.promise
            events.push("preflight")
            await startup.releaseTerminal()
            events.push("renderer")
          }),
        interactive(timer, async () => {
          events.push("create")
          return progress.host
        }),
      ),
    )

    await timer.scheduled
    timer.fire()
    expect(await progress.shown).toBe("Starting OpenCode...")
    expect(progress.closed()).toBe(0)

    preflight.resolve()
    await running
    expect(events).toEqual(["server", "create", "pending", "preflight", "close", "renderer"])
  })

  test("close settles an active pending write before renderer handoff", async () => {
    const timer = manualTimer()
    const events: string[] = []
    const pending = Promise.withResolvers<void>()
    const progress = progressHost({
      events,
      pending: () => pending.promise,
      close: async () => pending.resolve(),
    })
    const preflight = Promise.withResolvers<void>()
    const running = Effect.runPromise(
      withStartupProgress(
        (startup) =>
          attempt(async () => {
            await preflight.promise
            await startup.releaseTerminal()
            events.push("renderer")
          }),
        interactive(timer, async () => progress.host),
      ),
    )

    await timer.scheduled
    timer.fire()
    await progress.shown
    preflight.resolve()
    await running

    expect(events).toEqual(["pending", "close", "renderer"])
  })

  test("caller interruption closes visible progress", async () => {
    const timer = manualTimer()
    const progress = progressHost()
    const fiber = Effect.runFork(
      withStartupProgress(
        () => Effect.never,
        interactive(timer, async () => progress.host),
      ),
    )

    await timer.scheduled
    timer.fire()
    await progress.shown
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(progress.closed()).toBe(1)
  })

  test("host abort interrupts startup instead of failing it", async () => {
    const timer = manualTimer()
    const progress = progressHost()
    const running = Effect.runPromiseExit(
      withStartupProgress(
        () => Effect.never,
        interactive(timer, async () => progress.host),
      ),
    )

    await timer.scheduled
    timer.fire()
    await progress.shown
    progress.controller.abort()

    const exit = await running
    if (Exit.isSuccess(exit)) throw new Error("Expected startup interruption")
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(progress.closed()).toBe(1)
  })

  test("handoff waits for in-flight host creation and closes the late host", async () => {
    const timer = manualTimer()
    const events: string[] = []
    const progress = progressHost({ events })
    const created = Promise.withResolvers<typeof progress.host>()
    const creating = Promise.withResolvers<AbortSignal>()
    const preflight = Promise.withResolvers<void>()
    const running = Effect.runPromise(
      withStartupProgress(
        (startup) =>
          attempt(async () => {
            await preflight.promise
            await startup.releaseTerminal()
            events.push("renderer")
          }),
        interactive(timer, async (signal) => {
          events.push("create")
          creating.resolve(signal)
          return created.promise
        }),
      ),
    )

    await timer.scheduled
    timer.fire()
    const signal = await creating.promise
    preflight.resolve()
    await Promise.resolve()
    expect(signal.aborted).toBe(true)
    expect(events).toEqual(["create"])

    created.resolve(progress.host)
    await running
    expect(events).toEqual(["create", "close", "renderer"])
  })

  test("handoff timeout prevents the main renderer and closes a later host", async () => {
    const timer = manualTimer()
    const progress = progressHost()
    const created = Promise.withResolvers<typeof progress.host>()
    const creating = Promise.withResolvers<void>()
    const preflight = Promise.withResolvers<void>()
    let rendered = false
    const running = Effect.runPromise(
      withStartupProgress(
        (startup) =>
          attempt(async () => {
            await preflight.promise
            await startup.releaseTerminal()
            rendered = true
          }),
        {
          ...interactive(timer, async () => {
            creating.resolve()
            return created.promise
          }),
          handoffTimeout: 1,
        },
      ),
    )

    await timer.scheduled
    timer.fire()
    await creating.promise
    preflight.resolve()
    await expectFailure(running, "Timed out stopping startup progress")
    expect(rendered).toBe(false)

    created.resolve(progress.host)
    await waitFor(() => progress.closed() === 1)
  })

  test("close failure prevents a second renderer", async () => {
    const timer = manualTimer()
    const error = new Error("progress teardown failed")
    const progress = progressHost({ close: async () => Promise.reject(error) })
    const preflight = Promise.withResolvers<void>()
    let rendered = false
    const running = Effect.runPromise(
      withStartupProgress(
        (startup) =>
          attempt(async () => {
            await preflight.promise
            await startup.releaseTerminal()
            rendered = true
          }),
        interactive(timer, async () => progress.host),
      ),
    )

    await timer.scheduled
    timer.fire()
    await progress.shown
    preflight.resolve()

    await expectFailure(running, error.message)
    expect(rendered).toBe(false)
  })

  test("startup and teardown errors are both preserved", async () => {
    const timer = manualTimer()
    const startupError = new Error("server failed")
    const closeError = new Error("progress teardown failed")
    const progress = progressHost({ close: async () => Promise.reject(closeError) })
    const fail = Promise.withResolvers<void>()
    const running = Effect.runPromiseExit(
      withStartupProgress(
        () => Effect.promise(() => fail.promise).pipe(Effect.andThen(Effect.fail(startupError))),
        interactive(timer, async () => progress.host),
      ),
    )

    await timer.scheduled
    timer.fire()
    await progress.shown
    fail.resolve()

    const exit = await running
    if (Exit.isSuccess(exit)) throw new Error("Expected startup failure")
    const message = Cause.pretty(exit.cause)
    expect(message).toContain(startupError.message)
    expect(message).toContain(closeError.message)
  })

  test("a stale timer cannot create a host after handoff", async () => {
    const timer = manualTimer()
    let created = 0
    await Effect.runPromise(
      withStartupProgress(
        (startup) => Effect.promise(() => startup.releaseTerminal()),
        interactive(timer, async () => {
          created++
          return progressHost().host
        }),
      ),
    )

    await timer.scheduled
    timer.fire(true)
    await Promise.resolve()
    expect(created).toBe(0)
  })

  test("only two TTY streams use renderer progress; other combinations write plain diagnostics", async () => {
    const combinations = [
      { stdin: true, stdout: true, renderer: true },
      { stdin: true, stdout: false, renderer: false },
      { stdin: false, stdout: true, renderer: false },
      { stdin: false, stdout: false, renderer: false },
    ]

    for (const combination of combinations) {
      const timer = manualTimer()
      const writes: string[] = []
      let created = 0
      await Effect.runPromise(
        withStartupProgress(
          (startup) =>
            attempt(async () => {
              startup.onServerStart("missing")
              await startup.releaseTerminal()
            }),
          {
            terminal: combination,
            schedule: timer.schedule,
            write: (text) => writes.push(text),
            create: async () => {
              created++
              return progressHost().host
            },
          },
        ),
      )

      expect(timer.delays()).toEqual(combination.renderer ? [500] : [])
      expect(writes).toEqual(combination.renderer ? [] : ["Starting background server...\n"])
      expect(created).toBe(0)
    }
  })

  test("disabled explicit-server mode never takes terminal ownership", async () => {
    const timer = manualTimer()
    const writes: string[] = []
    let created = 0
    await Effect.runPromise(
      withStartupProgress((startup) => Effect.promise(() => startup.releaseTerminal()), {
        enabled: false,
        terminal: { stdin: true, stdout: true },
        schedule: timer.schedule,
        write: (text) => writes.push(text),
        create: async () => {
          created++
          return progressHost().host
        },
      }),
    )

    expect(timer.delays()).toEqual([])
    expect(writes).toEqual([])
    expect(created).toBe(0)
  })
})

function interactive(
  timer: ReturnType<typeof manualTimer>,
  create: (signal: AbortSignal) => Promise<ReturnType<typeof progressHost>["host"]>,
) {
  return {
    terminal: { stdin: true, stdout: true },
    schedule: timer.schedule,
    create,
  }
}

function manualTimer() {
  const scheduled = Promise.withResolvers<number>()
  const delays: number[] = []
  let callback: (() => void) | undefined
  let cancelled = false
  const schedule = (next: () => void, delay: number) => {
    callback = next
    delays.push(delay)
    scheduled.resolve(delay)
    return () => {
      cancelled = true
    }
  }
  return {
    scheduled: scheduled.promise,
    schedule,
    fire(stale = false) {
      if (stale || !cancelled) callback?.()
    },
    cancelled() {
      return cancelled
    },
    delays() {
      return delays
    },
  }
}

function progressHost(
  input: {
    readonly events?: string[]
    readonly pending?: () => Promise<void>
    readonly close?: () => Promise<void>
  } = {},
) {
  const shown = Promise.withResolvers<string>()
  const controller = new AbortController()
  const events = input.events ?? []
  let closed = 0
  return {
    shown: shown.promise,
    controller,
    host: {
      signal: controller.signal,
      async pending(text: string) {
        events.push("pending")
        shown.resolve(text)
        await input.pending?.()
      },
      async close() {
        closed++
        events.push("close")
        await input.close?.()
      },
    },
    closed() {
      return closed
    },
  }
}

function attempt(task: () => Promise<void>) {
  return Effect.tryPromise({ try: task, catch: toError })
}

async function expectFailure(task: Promise<unknown>, message: string) {
  const error = await task.then(
    () => undefined,
    (cause: unknown) => cause,
  )
  expect(error).toBeInstanceOf(Error)
  expect(String(error)).toContain(message)
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await Bun.sleep(1)
  }
  throw new Error("Condition was not met")
}

function toError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}
