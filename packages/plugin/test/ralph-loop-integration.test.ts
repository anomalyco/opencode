import { describe, expect, test, beforeEach } from "bun:test"
import { registerLoop, RalphLoop, clearRalphLoop, getLoopState } from "../src/ralph-loop"

async function triggerHook(input: {
  sessionID: string
  assistant: any
  assistantText: string
  iterationCount: number
  lastUserID: string
}): Promise<{ injectedTexts: string[] }> {
  const output = { injectedTexts: [] as string[] }

  await RalphLoop["chat.waiting"]!(
    {
      sessionID: input.sessionID,
      assistant: input.assistant,
      assistantText: input.assistantText,
      iterationCount: input.iterationCount,
      lastUserID: input.lastUserID,
    },
    output,
  )

  return output
}

describe("RalphLoop integration", () => {
  beforeEach(() => {
    clearRalphLoop()
  })

  describe("full flow: register → hook trigger → injected texts", () => {
    test("first call continues loop, second call continues", async () => {
      registerLoop("session-1", {
        prompt: "read the todo file and execute it",
        completionPromise: "DONE",
      })

      const result1 = await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-1", role: "assistant" } as any,
        assistantText: "let me check the code",
        iterationCount: 0,
        lastUserID: "user-1",
      })

      expect(result1.injectedTexts.length).toBeGreaterThan(0)
      expect(result1.injectedTexts[0]).toContain("read the todo file and execute it")
      expect(result1.injectedTexts[0]).toContain("<promise>DONE</promise>")
      expect(result1.injectedTexts[0]).toContain("If you didn't manage to change or improve anything say")

      const result2 = await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-2", role: "assistant" } as any,
        assistantText: "still checking...",
        iterationCount: 1,
        lastUserID: "user-1",
      })

      expect(result2.injectedTexts.length).toBeGreaterThan(0)
      expect(result2.injectedTexts[0]).toContain("read the todo file and execute it")
      expect(result2.injectedTexts[0]).toContain("<promise>DONE</promise>")
    })

    test("promise match with XML tags stops loop on second call", async () => {
      const promise = "I_DIDNT_FIND_ANYTHING_TO_CHANGE_OR_IMPROVE"
      registerLoop("session-1", {
        prompt: "read the todo file and execute it",
        completionPromise: promise,
      })

      await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-1", role: "assistant" } as any,
        assistantText: "checking files...",
        iterationCount: 0,
        lastUserID: "user-1",
      })

      const result2 = await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-2", role: "assistant" } as any,
        assistantText: `<promise>${promise}</promise>`,
        iterationCount: 1,
        lastUserID: "user-1",
      })

      expect(result2.injectedTexts.length).toBe(0)
      expect(getLoopState("session-1")).toBeUndefined()
    })

    test("multiple continuations increment count", async () => {
      registerLoop("session-1", {
        prompt: "read the todo file and execute it",
        completionPromise: "DONE",
      })

      let state = getLoopState("session-1")!
      state.lastUserID = "user-1"

      await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-0", role: "assistant" } as any,
        assistantText: "checking files...",
        iterationCount: 0,
        lastUserID: "user-1",
      })

      for (let i = 1; i < 3; i++) {
        const result = await triggerHook({
          sessionID: "session-1",
          assistant: { id: `msg-${i}`, role: "assistant" } as any,
          assistantText: "still working...",
          iterationCount: i,
          lastUserID: "user-1",
        })

        expect(result.injectedTexts.length).toBeGreaterThan(0)
        expect(result.injectedTexts[0]).toContain("read the todo file and execute it")
        expect(result.injectedTexts[0]).toContain("<promise>DONE</promise>")
      }

      state = getLoopState("session-1")!
      expect(state.iterationCount).toBe(3)
    })

    test("max iterations triggers stop", async () => {
      registerLoop("session-1", {
        prompt: "read the todo file and execute it",
        completionPromise: "DONE",
        maxIterations: 3,
      })

      let state = getLoopState("session-1")!
      state.lastUserID = "user-1"

      await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-0", role: "assistant" } as any,
        assistantText: "still working...",
        iterationCount: 0,
        lastUserID: "user-1",
      })

      for (let i = 1; i < 2; i++) {
        const result = await triggerHook({
          sessionID: "session-1",
          assistant: { id: `msg-${i}`, role: "assistant" } as any,
          assistantText: "still working...",
          iterationCount: i,
          lastUserID: "user-1",
        })

        expect(result.injectedTexts.length).toBeGreaterThan(0)
        expect(result.injectedTexts[0]).toContain("read the todo file and execute it")
      }

      const result = await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-3", role: "assistant" } as any,
        assistantText: "still working...",
        iterationCount: 3,
        lastUserID: "user-1",
      })

      expect(result.injectedTexts.length).toBeGreaterThan(0)

      const resultStop = await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-4", role: "assistant" } as any,
        assistantText: "still working...",
        iterationCount: 4,
        lastUserID: "user-1",
      })

      expect(resultStop.injectedTexts.length).toBe(0)
      expect(getLoopState("session-1")).toBeUndefined()
    })
  })

  describe("edge cases", () => {
    test("unregistered session returns empty", async () => {
      const result = await triggerHook({
        sessionID: "nonexistent",
        assistant: { id: "msg-1", role: "assistant" } as any,
        assistantText: "hello",
        iterationCount: 0,
        lastUserID: "user-1",
      })

      expect(result.injectedTexts.length).toBe(0)
    })

    test("case insensitive XML tag matching", async () => {
      registerLoop("session-1", {
        prompt: "read the todo file and execute it",
        completionPromise: "I_DIDNT_FIND_ANYTHING",
      })

      await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-1", role: "assistant" } as any,
        assistantText: "working on it...",
        iterationCount: 0,
        lastUserID: "user-1",
      })

      const result = await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-2", role: "assistant" } as any,
        assistantText: "<promise>I_DIDNT_FIND_ANYTHING</promise>",
        iterationCount: 1,
        lastUserID: "user-1",
      })

      expect(result.injectedTexts.length).toBe(0)
      expect(getLoopState("session-1")).toBeUndefined()
    })

    test("prompt without completion promise continues indefinitely until limit", async () => {
      registerLoop("session-1", {
        prompt: "read the todo file and execute it",
        maxIterations: 3,
      })

      let state = getLoopState("session-1")!
      state.lastUserID = "user-1"

      for (let i = 0; i < 2; i++) {
        const result = await triggerHook({
          sessionID: "session-1",
          assistant: { id: `msg-${i}`, role: "assistant" } as any,
          assistantText: "working...",
          iterationCount: i,
          lastUserID: "user-1",
        })

        expect(result.injectedTexts.length).toBeGreaterThan(0)
        expect(result.injectedTexts[0]).toContain("Ralph Loop")
        expect(result.injectedTexts[0]).toContain("read the todo file and execute it")
      }

      const result = await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-3", role: "assistant" } as any,
        assistantText: "working...",
        iterationCount: 3,
        lastUserID: "user-1",
      })

      expect(result.injectedTexts.length).toBeGreaterThan(0)

      const resultStop = await triggerHook({
        sessionID: "session-1",
        assistant: { id: "msg-4", role: "assistant" } as any,
        assistantText: "working...",
        iterationCount: 4,
        lastUserID: "user-1",
      })

      expect(resultStop.injectedTexts.length).toBe(0)
    })
  })
})
