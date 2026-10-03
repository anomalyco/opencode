import { Effect, Fiber, Schedule } from "effect"
import { onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createKeyed, type IpcClient } from "../sdk"
import type { Ssh, SshConfig, SshItem } from "./contract"
import { isSshConnecting } from "./name"

export type SshController = ReturnType<typeof createSshController>

export function createSshController(input: {
  items: () => readonly SshItem[]
  /** Undefined while the main side is loading or gone. */
  api: Accessor<IpcClient<(typeof Ssh)["spec"]> | undefined>
  /** Resolves once this window's state includes `revision`. */
  refresh: (revision: number) => Promise<void>
  error: () => void
}) {
  const [attempts, setAttempts] = createStore<
    Record<
      string,
      | {
          active: boolean
          submitting: boolean
          prompted: boolean
          answered?: string
          error: boolean
          onConnected?: (ready: boolean) => void
        }
      | undefined
    >
  >({})

  const tasks = new Map<string, Fiber.Fiber<void>>()
  const item = (id: string) => input.items().find((item) => item.config.id === id)

  const settle = (id: string) => {
    const attempt = attempts[id]

    if (!attempt?.active) return
    const onConnected = attempt.onConnected
    setAttempts(id, { active: false, onConnected: undefined })
    const ready = item(id)?.stage === "ready"

    if (onConnected) queueMicrotask(() => onConnected(ready))
  }

  const run = (id: string, effect: Effect.Effect<unknown, unknown>) => {
    setAttempts(id, { submitting: true, error: false })
    tasks.set(
      id,
      Effect.runFork(
        effect.pipe(
          Effect.asVoid,
          Effect.catch(() =>
            Effect.sync(() => {
              setAttempts(id, "error", true)

              if (!attempts[id]?.prompted) input.error()
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              tasks.delete(id)
              setAttempts(id, "submitting", false)
            }),
          ),
        ),
      ),
    )
  }

  // Without the main side nothing can connect or answer: the attempt fails at once, as one main rejects.
  const unavailable = (id: string, onConnected?: (ready: boolean) => void) => {
    setAttempts(id, { active: false, submitting: false, error: true, onConnected: undefined })
    input.error()

    if (onConnected) queueMicrotask(() => onConnected(false))
  }

  onCleanup(() => {
    Effect.runFork(Effect.forEach([...tasks.values()], Fiber.interrupt, { discard: true }))
  })
  // Attempts whose server reached an outcome in main's state: they settle and tell whoever waits on them.
  createKeyed(
    () => {
      const done = input.items().flatMap((item) => {
        const attempt = attempts[item.config.id]

        if (!attempt?.active || attempt.submitting) return []

        return item.stage === "ready" ||
          item.stage === "failed" ||
          item.stage === "disconnected" ||
          item.authenticatingElsewhere ||
          (attempt.prompted && item.stage === "authentication" && !item.prompt)
          ? [item.config.id]
          : []
      })

      return done.length > 0 ? done : undefined
    },
    (done) => done.forEach(settle),
  )

  return {
    item,
    submitting: (id: string) => !!attempts[id]?.submitting,
    error: (id: string) => !!attempts[id]?.error,
    answered: (id: string) =>
      !!item(id)?.prompt && !attempts[id]?.error && attempts[id]?.answered === item(id)?.prompt?.id,
    pending: (id: string) =>
      !!attempts[id]?.submitting ||
      !!item(id)?.authenticatingElsewhere ||
      isSshConnecting(item(id)?.stage ?? "disconnected"),
    dialog: {
      next: () =>
        input.items().find((item) => {
          const attempt = attempts[item.config.id]

          return (
            attempt?.active &&
            !attempt.submitting &&
            !attempt.prompted &&
            !attempt.error &&
            (item.prompt || item.stage === "incompatible")
          )
        }),
      opened: (id: string) => setAttempts(id, "prompted", true),
    },
    /** `onConnected` runs once the attempt settles, with whether the server is ready. */
    connect: (
      config: SshConfig,
      options?: { dialog?: boolean; replace?: boolean; onConnected?: (ready: boolean) => void },
    ) => {
      const api = input.api()

      if (!api) return unavailable(config.id, options?.onConnected)

      if (item(config.id)?.authenticatingElsewhere) return

      if (
        attempts[config.id]?.submitting ||
        (attempts[config.id]?.active && !attempts[config.id]?.error && !options?.replace)
      )
        return
      setAttempts(config.id, {
        active: true,
        submitting: true,
        prompted: !!options?.dialog,
        answered: undefined,
        error: false,
        onConnected: options?.onConnected ?? (options?.replace ? attempts[config.id]?.onConnected : undefined),
      })
      run(
        config.id,
        Effect.gen(function* () {
          const revision = yield* Effect.tryPromise(() => api.start({ ...config, replace: options?.replace }))
          // Observe admission before treating an older disconnected snapshot as cancellation.
          yield* Effect.tryPromise(() => input.refresh(revision))
        }),
      )
    },
    respond: (id: string, prompt: string, value: string) => {
      const api = input.api()

      if (!api) return unavailable(id)

      if (item(id)?.prompt?.id !== prompt || attempts[id]?.submitting) return

      if (attempts[id]?.answered === prompt && !attempts[id]?.error) return
      setAttempts(id, "answered", prompt)
      run(
        id,
        Effect.tryPromise(() => api.respond({ id, prompt, value })),
      )
    },
    cancel: (id: string) => {
      const task = tasks.get(id)
      const api = input.api()
      Effect.runFork(
        Effect.gen(function* () {
          if (task) yield* Fiber.interrupt(task)
          setAttempts(id, undefined)

          if (!api) return
          yield* Effect.tryPromise(() => api.cancel({ id }))

          if (!item(id)?.saved) yield* Effect.tryPromise(() => api.forget({ id }))
        }).pipe(Effect.ignore),
      )
    },
    restore: (config: SshConfig) => input.api()?.start({ ...config, background: true }),
    /** Waits for a healthy tunnel, starting one in the background when the last one dropped. */
    resolve: (id: string, signal: AbortSignal) =>
      Effect.runPromise(
        Effect.tryPromise((abort) => {
          const api = input.api()

          if (!api) return Promise.resolve(null)

          return api.resolve({ id }, { signal: abort })
        }).pipe(
          Effect.repeat({ until: (http) => http !== null, schedule: Schedule.spaced(3000) }),
          Effect.flatMap((http) => (http === null ? Effect.interrupt : Effect.succeed(http))),
        ),
        { signal },
      ),
  }
}
