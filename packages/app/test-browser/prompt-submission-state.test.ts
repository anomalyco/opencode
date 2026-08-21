import { describe, expect, test } from "bun:test"
import { createMemoryComposerState } from "@/composer/state"
import { createComposerSubmission } from "@/composer/submission-state"

describe("prompt submission state", () => {
  test("keeps failed submission restoration with the prompt where it started", () => {
    const target = createMemoryComposerState()
    const submission = createComposerSubmission({
      target,
      prompt: [{ type: "text", content: "prompt-A", start: 0, end: 8 }],
      context: [{ key: "file:src/index.ts:undefined:undefined", type: "file", path: "src/index.ts" }],
    })

    expect(submission.restore()).toEqual({
      target,
      prompt: [{ type: "text", content: "prompt-A", start: 0, end: 8 }],
      context: [{ key: "file:src/index.ts:undefined:undefined", type: "file", path: "src/index.ts" }],
    })
  })

  test("moves first-submit restoration and context to the promoted session", () => {
    const draft = createMemoryComposerState()
    const session = createMemoryComposerState()
    const submission = createComposerSubmission({
      target: draft,
      prompt: [{ type: "text", content: "first prompt", start: 0, end: 12 }],
      context: [{ key: "file:src/index.ts:undefined:undefined", type: "file", path: "src/index.ts" }],
    })

    submission.retarget(session)

    expect(submission.restore()).toEqual({
      target: session,
      prompt: [{ type: "text", content: "first prompt", start: 0, end: 12 }],
      context: [{ key: "file:src/index.ts:undefined:undefined", type: "file", path: "src/index.ts" }],
    })
    expect(session.context.items()).toHaveLength(1)
    expect(session.context.items()[0]).toMatchObject({ type: "file", path: "src/index.ts" })
  })

  test("clears the original first-submit prompt after retargeting", () => {
    const workspace = createMemoryComposerState()
    const session = createMemoryComposerState()
    workspace.set([{ type: "text", content: "first prompt", start: 0, end: 12 }])
    const submission = createComposerSubmission({
      target: workspace,
      prompt: workspace.current(),
      context: [],
    })

    submission.retarget(session)
    submission.clear()

    expect(workspace.current()[0]).toMatchObject({ type: "text", content: "" })
    expect(session.current()[0]).toMatchObject({ type: "text", content: "" })
  })

  test("does not restore over a prompt edited after submission", () => {
    const target = createMemoryComposerState()
    target.set([{ type: "text", content: "submitted", start: 0, end: 9 }])
    const submission = createComposerSubmission({
      target,
      prompt: target.current(),
      context: [],
    })

    submission.clear()
    target.set([{ type: "text", content: "new draft", start: 0, end: 9 }])

    expect(submission.restore()).toBeUndefined()
    expect(target.current()[0]).toMatchObject({ type: "text", content: "new draft" })
  })
})
