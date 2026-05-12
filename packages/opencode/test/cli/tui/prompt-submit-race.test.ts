import { describe, expect, test } from "bun:test"

// Structural reproducer for the prompt submit race observed in
// packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx (`submit`).
//
// The bug: two concurrent `submit()` calls (e.g. a double-pressed Enter, or
// the input's native onSubmit racing another dispatch) each pass the
// `if (!store.prompt.input) return false` guard, each `await
// sdk.client.session.create(...)`, and each only capture
// `inputText = store.prompt.input` AFTER that await.
//
// The first invocation finishes, sends the prompt, then clears the store.
// The second invocation, now past its await, reads the cleared store and
// sends an empty prompt to a second freshly-created session. The user is
// then navigated to whichever session id was assigned last, leaving an
// orphaned session containing their actual text and a phantom session with
// only an assistant reply.
//
// `submitMirror` below has the exact shape of the production `submit()`:
//
//   1. bail if input is empty
//   2. await session.create()
//   3. read inputText from the store
//   4. await sendPrompt(sessionID, inputText)
//   5. clear the store
//
// Running two concurrent invocations against it must not lose the user's
// text. Today it does — this test FAILS until the race is fixed.

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

async function submitMirror(h: Harness) {
  if (!h.store.input) return false
  const sessionID = await h.createSession()
  const inputText = h.store.input
  await h.sendPrompt(sessionID, inputText)
  h.store.input = ""
  return true
}

describe("Prompt.submit race", () => {
  test("concurrent submits must not lose the user's text", async () => {
    const h = createHarness({ sessionCreateDelayMs: 5 })
    h.store.input = "Hello there."

    // Two invocations back-to-back, mimicking a double-Enter.
    await Promise.all([submitMirror(h), submitMirror(h)])

    // Every submission that did make it through must carry the actual user
    // text, and no submission may have an empty text payload.
    expect(h.submissions.every((s) => s.text === "Hello there.")).toBe(true)
    expect(h.submissions.some((s) => s.text === "")).toBe(false)
  })
})
