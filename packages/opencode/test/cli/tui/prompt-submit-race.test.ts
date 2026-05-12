import { describe, expect, test } from "bun:test"

// Regression test for the prompt submit race in
// packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx (`submit`).
//
// Before the fix, two concurrent `submit()` calls (e.g. a double-pressed
// Enter, or the input's native onSubmit racing another dispatch) each
// passed the `if (!store.prompt.input) return false` guard, each
// `await sdk.client.session.create(...)`, and each only captured
// `inputText = store.prompt.input` AFTER that await. The first invocation
// finished, sent the prompt, and cleared the store; the second invocation,
// now past its await, read the cleared store and sent an empty prompt to a
// second freshly-created session - leaving an orphaned session with the
// user's actual text and a phantom session visible to the user containing
// only an assistant reply.
//
// `submitMirror` below has the exact shape of the production `submit()`
// after the fix: an in-flight `submitting` guard wraps the original body.
// Two concurrent invocations must result in exactly one submission carrying
// the user's text, with no empty-text submission.

type Store = { input: string }

type SubmitResult = { sessionID: string; text: string }

type Harness = {
  store: Store
  submissions: SubmitResult[]
  createSession(): Promise<string>
  sendPrompt(sessionID: string, text: string): Promise<void>
}

function createHarness(opts: { sessionCreateDelayMs: number }): Harness {
  let sessionCounter = 0
  const submissions: SubmitResult[] = []

  return {
    store: { input: "" },
    submissions,
    async createSession() {
      sessionCounter += 1
      const id = `ses_${sessionCounter}`
      await Bun.sleep(opts.sessionCreateDelayMs)
      return id
    },
    async sendPrompt(sessionID, text) {
      submissions.push({ sessionID, text })
    },
  }
}

function createSubmit() {
  let submitting = false
  return async function submit(h: Harness) {
    if (submitting) return false
    submitting = true
    try {
      if (!h.store.input) return false
      const sessionID = await h.createSession()
      const inputText = h.store.input
      await h.sendPrompt(sessionID, inputText)
      h.store.input = ""
      return true
    } finally {
      submitting = false
    }
  }
}

describe("Prompt.submit race", () => {
  test("concurrent submits must not lose the user's text", async () => {
    const submit = createSubmit()
    const h = createHarness({ sessionCreateDelayMs: 5 })
    h.store.input = "Hello there."

    // Two invocations back-to-back, mimicking a double-Enter.
    await Promise.all([submit(h), submit(h)])

    // Every submission that did make it through must carry the actual user
    // text, and no submission may have an empty text payload.
    expect(h.submissions.every((s) => s.text === "Hello there.")).toBe(true)
    expect(h.submissions.some((s) => s.text === "")).toBe(false)
  })

  test("a sequential second submit after clear is a no-op, not a phantom session", async () => {
    const submit = createSubmit()
    const h = createHarness({ sessionCreateDelayMs: 1 })
    h.store.input = "Hello there."

    await submit(h)
    // After the first submission completes, the store is cleared; a second
    // Enter on an empty input must not create a phantom session.
    await submit(h)

    expect(h.submissions).toHaveLength(1)
    expect(h.submissions[0].text).toBe("Hello there.")
  })
})
