// Serial prompt queue for direct interactive mode.
//
// Prompts arrive from the footer (user types and hits enter) and queue up
// here. The queue drains one turn at a time: it appends the user row to
// scrollback, calls input.run() to execute the turn through the stream
// transport, and waits for completion before starting the next prompt.
//
// The queue also handles /exit, /quit, and /new commands, empty-prompt rejection,
// and tracks per-turn wall-clock duration for the footer status line.
//
// Resolves when the footer closes and all in-flight work finishes.
import * as Locale from "@/util/locale"
import { isExitCommand, isNewCommand } from "./prompt.shared"
import type { FooterApi, FooterEvent, RunPrompt } from "./types"

type Trace = {
  write(type: string, data?: unknown): void
}

type Deferred<T = void> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (error?: unknown) => void
}

export type QueueInput = {
  footer: FooterApi
  initialInput?: string
  trace?: Trace
  onSend?: (prompt: RunPrompt) => void
  onNewSession?: () => void | Promise<void>
  run: (prompt: RunPrompt, signal: AbortSignal) => Promise<void>
}

type State = {
  queue: RunPrompt[]
  ctrl?: AbortController
  closed: boolean
}

function defer<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })

  return { promise, resolve, reject }
}

// Runs the prompt queue until the footer closes.
//
// Subscribes to footer prompt events, queues them, and drains one at a
// time through input.run(). If the user submits multiple prompts while
// a turn is running, they queue up and execute in order. The footer shows
// the queue depth so the user knows how many are pending.
export async function runPromptQueue(input: QueueInput): Promise<void> {
  const stop = defer<{ type: "closed" }>()
  const done = defer()
  const state: State = {
    queue: [],
    closed: input.footer.isClosed,
  }
  let draining: Promise<void> | undefined

  const emit = (next: FooterEvent, row: Record<string, unknown>) => {
    input.trace?.write("ui.patch", row)
    input.footer.event(next)
  }

  const finish = () => {
    if (!state.closed || draining) {
      return
    }

    done.resolve()
  }

  const close = () => {
    if (state.closed) {
      return
    }

    state.closed = true
    state.queue.length = 0
    state.ctrl?.abort()
    stop.resolve({ type: "closed" })
    finish()
  }

  const drain = () => {
    if (draining || state.closed || state.queue.length === 0) {
      return
    }

    draining = (async () => {
      try {
        while (!state.closed && state.queue.length > 0) {
          const prompt = state.queue.shift()
          if (!prompt) {
            continue
          }

          if (isNewCommand(prompt.text)) {
            emit(
              {
                type: "queue",
                queue: state.queue.length,
              },
              {
                queue: state.queue.length,
              },
            )
            if (!input.onNewSession) {
              emit(
                {
                  type: "stream.patch",
                  patch: {
                    status: "new sessions unavailable",
                  },
                },
                {
                  status: "new sessions unavailable",
                },
              )
              continue
            }

            emit(
              {
                type: "stream.patch",
                patch: {
                  phase: "running",
                  status: "starting new session",
                  queue: state.queue.length,
                },
              },
              {
                phase: "running",
                status: "starting new session",
                queue: state.queue.length,
              },
            )
            await input.onNewSession()
            continue
          }

          emit(
            {
              type: "turn.send",
              queue: state.queue.length,
            },
            {
              phase: "running",
              status: "sending prompt",
              queue: state.queue.length,
            },
          )
          const start = Date.now()
          const ctrl = new AbortController()
          state.ctrl = ctrl

          try {
            await input.footer.idle()
            if (state.closed) {
              break
            }

            const commit = { kind: "user", text: prompt.text, phase: "start", source: "system" } as const
            input.trace?.write("ui.commit", commit)
            input.footer.append(commit)
            input.onSend?.(prompt)

            if (state.closed) {
              break
            }

            const task = input.run(prompt, ctrl.signal).then(
              () => ({ type: "done" as const }),
              (error) => ({ type: "error" as const, error }),
            )

            const next = await Promise.race([task, stop.promise])
            if (next.type === "closed") {
              ctrl.abort()
              break
            }

            if (next.type === "error") {
              throw next.error
            }
          } finally {
            if (state.ctrl === ctrl) {
              state.ctrl = undefined
            }

            const duration = Locale.duration(Math.max(0, Date.now() - start))
            emit(
              {
                type: "turn.duration",
                duration,
              },
              {
                duration,
              },
            )
          }
        }
      } catch (error) {
        done.reject(error)
        return
      } finally {
        draining = undefined
        emit(
          {
            type: "turn.idle",
            queue: state.queue.length,
          },
          {
            phase: "idle",
            status: "",
            queue: state.queue.length,
          },
        )
      }

      finish()
    })()
  }

  const submit = (prompt: RunPrompt) => {
    if (!prompt.text.trim() || state.closed) {
      return
    }

    if (isExitCommand(prompt.text)) {
      input.footer.close()
      return
    }

    state.queue.push(prompt)
    emit(
      {
        type: "queue",
        queue: state.queue.length,
      },
      {
        queue: state.queue.length,
      },
    )
    if (isNewCommand(prompt.text)) {
      drain()
      return
    }

    emit(
      {
        type: "first",
        first: false,
      },
      {
        first: false,
      },
    )
    drain()
  }

  const offPrompt = input.footer.onPrompt((prompt) => {
    submit(prompt)
  })
  const offClose = input.footer.onClose(() => {
    close()
  })

  try {
    if (state.closed) {
      return
    }

    submit({
      text: input.initialInput ?? "",
      parts: [],
    })
    finish()
    await done.promise
  } finally {
    offPrompt()
    offClose()
    close()
    await draining?.catch(() => {})
  }
}
