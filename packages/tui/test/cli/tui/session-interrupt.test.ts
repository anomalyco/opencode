import { describe, expect, test } from "bun:test"

// Regression test for session.interrupt in packages/tui/src/component/prompt/index.tsx
//
// Previously, session.interrupt guarded execution with `if (!input.focused) return`.
// When a session was running/busy, the text prompt input was frequently unfocused
// (e.g. while scrolling the scrollback transcript or inspecting tool output).
// As a result, pressing Escape to interrupt had no effect.
//
// With the `!input.focused` check removed from session.interrupt, pressing Escape
// while status is non-idle increments the interrupt counter and aborts the session
// on double-escape regardless of whether the prompt input has focus.

type Status = { type: "idle" | "busy" | "retry" }

type State = {
  interrupt: number
  mode: "normal" | "shell"
  aborted: boolean
}

function createInterruptRunner(opts: {
  status: () => Status
  autoVisible: () => boolean
  inputFocused: () => boolean
  sessionID: string | undefined
  state: State
  abort: (sessionID: string) => void
}) {
  return function run() {
    if (opts.autoVisible()) return
    if (opts.state.mode === "shell") {
      opts.state.mode = "normal"
      return
    }
    if (!opts.sessionID) return

    opts.state.interrupt += 1

    if (opts.state.interrupt >= 2) {
      opts.abort(opts.sessionID)
      opts.state.interrupt = 0
    }
  }
}

describe("session.interrupt execution without prompt focus", () => {
  test("aborts running session on double interrupt even when input is unfocused", () => {
    let abortedSession: string | undefined
    const state: State = { interrupt: 0, mode: "normal", aborted: false }

    const run = createInterruptRunner({
      status: () => ({ type: "busy" }),
      autoVisible: () => false,
      inputFocused: () => false,
      sessionID: "ses_busy_123",
      state,
      abort: (id) => {
        abortedSession = id
        state.aborted = true
      },
    })

    // First Escape press increments counter to 1
    run()
    expect(state.interrupt).toBe(1)
    expect(abortedSession).toBeUndefined()

    // Second Escape press triggers abort
    run()
    expect(abortedSession).toBe("ses_busy_123")
    expect(state.aborted).toBe(true)
    expect(state.interrupt).toBe(0)
  })

  test("does not abort if autocomplete popup is visible", () => {
    let abortedSession: string | undefined
    const state: State = { interrupt: 0, mode: "normal", aborted: false }

    const run = createInterruptRunner({
      status: () => ({ type: "busy" }),
      autoVisible: () => true,
      inputFocused: () => false,
      sessionID: "ses_busy_123",
      state,
      abort: (id) => {
        abortedSession = id
      },
    })

    run()
    run()
    expect(state.interrupt).toBe(0)
    expect(abortedSession).toBeUndefined()
  })

  test("exits shell mode first before interrupting session", () => {
    let abortedSession: string | undefined
    const state: State = { interrupt: 0, mode: "shell", aborted: false }

    const run = createInterruptRunner({
      status: () => ({ type: "busy" }),
      autoVisible: () => false,
      inputFocused: () => false,
      sessionID: "ses_busy_123",
      state,
      abort: (id) => {
        abortedSession = id
      },
    })

    run()
    expect(state.mode).toBe("normal")
    expect(state.interrupt).toBe(0)
    expect(abortedSession).toBeUndefined()
  })
})
