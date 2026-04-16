/**
 * mailbox — pure async-iterator fan-out for `cmd.logs()`.
 *
 * The Vercel sandbox SDK exposes a single `AsyncGenerator` that yields
 * tagged `{ stream: "stdout" | "stderr", data: string }` chunks. Every
 * consumer of the generator must share the same underlying source, but
 * each downstream reader (stdout/stderr/all) wants its own queue with
 * its own backpressure.
 *
 * `createMailboxFanout` solves this with a single driver task that
 * consumes the source iterator once, classifies each chunk by tag, and
 * pushes it into the matching mailboxes. Mailboxes are bounded async
 * iterables backed by arrays + a resolver pair (no Effect dependency,
 * so this file is host-runtime free and trivially unit-testable).
 *
 * The fan-out semantics:
 *   - `stdout` receives every `{ stream: "stdout" }` chunk (decoded → bytes)
 *   - `stderr` receives every `{ stream: "stderr" }` chunk (decoded → bytes)
 *   - `all`    receives both, in driver order
 *   - On driver completion, all three mailboxes finish (return done)
 *   - On driver error, all three mailboxes throw the same error on the
 *     next pull (consumers can decide to ignore via try/catch)
 *
 * The mailbox is intentionally not a Stream/Queue from Effect: that
 * would couple the helper to the runtime and make the unit test require
 * a runtime layer. The Vercel backend wraps each mailbox in
 * `Stream.fromAsyncIterable` at the Backend boundary instead.
 */

export type LogChunk =
  | { readonly stream: "stdout"; readonly data: string }
  | { readonly stream: "stderr"; readonly data: string }

export interface Mailbox<T> {
  readonly iterator: AsyncIterableIterator<T>
}

export interface MailboxFanout {
  readonly stdout: Mailbox<Uint8Array>
  readonly stderr: Mailbox<Uint8Array>
  readonly all: Mailbox<Uint8Array>
  /** Resolves when the driver finishes (success or error). */
  readonly done: Promise<void>
}

interface MailboxState<T> {
  readonly buffer: T[]
  done: boolean
  error: unknown
  resolve: (() => void) | null
}

const newMailbox = <T>(): { mb: Mailbox<T>; state: MailboxState<T> } => {
  const state: MailboxState<T> = {
    buffer: [],
    done: false,
    error: null,
    resolve: null,
  }

  const wake = () => {
    if (state.resolve) {
      const r = state.resolve
      state.resolve = null
      r()
    }
  }

  const iterator: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() {
      return this
    },
    async next(): Promise<IteratorResult<T>> {
      while (true) {
        if (state.buffer.length > 0) {
          const value = state.buffer.shift()!
          return { value, done: false }
        }
        if (state.error !== null) {
          // Re-throw once; subsequent calls return done.
          const err = state.error
          state.error = null
          state.done = true
          throw err
        }
        if (state.done) return { value: undefined, done: true }
        await new Promise<void>((res) => {
          state.resolve = res
        })
      }
    },
    async return(): Promise<IteratorResult<T>> {
      state.done = true
      state.buffer.length = 0
      wake()
      return { value: undefined, done: true }
    },
  }

  // Expose wake via a closure so the driver can push.
  ;(state as any).__wake = wake
  return { mb: { iterator }, state }
}

const push = <T>(state: MailboxState<T>, value: T): void => {
  state.buffer.push(value)
  ;(state as any).__wake?.()
}

const finish = <T>(state: MailboxState<T>, error?: unknown): void => {
  if (error !== undefined) state.error = error
  state.done = true
  ;(state as any).__wake?.()
}

/**
 * Fan-out one driver async-iterator into three mailboxes.
 *
 * The `decode` function is injected so tests can pass an identity
 * decoder when working with strings, while production code passes a
 * real `TextEncoder` to convert string log payloads into bytes.
 */
export const createMailboxFanout = (
  source: AsyncIterable<LogChunk>,
  options?: {
    readonly encode?: (s: string) => Uint8Array
  },
): MailboxFanout => {
  const encode = options?.encode ?? ((s: string) => new TextEncoder().encode(s))
  const stdout = newMailbox<Uint8Array>()
  const stderr = newMailbox<Uint8Array>()
  const all = newMailbox<Uint8Array>()

  const drive = async (): Promise<void> => {
    try {
      for await (const chunk of source) {
        const bytes = encode(chunk.data)
        if (chunk.stream === "stdout") {
          push(stdout.state, bytes)
        } else if (chunk.stream === "stderr") {
          push(stderr.state, bytes)
        }
        push(all.state, bytes)
      }
      finish(stdout.state)
      finish(stderr.state)
      finish(all.state)
    } catch (err) {
      finish(stdout.state, err)
      finish(stderr.state, err)
      finish(all.state, err)
    }
  }

  const done = drive()

  return {
    stdout: stdout.mb,
    stderr: stderr.mb,
    all: all.mb,
    done,
  }
}
