import { describe, expect, test, beforeEach } from "bun:test"
import {
  registerLoop,
  cancelLoop,
  isLoopActive,
  getLoopState,
  RalphLoop,
  clearRalphLoop,
  parseRalphLoopArgs,
} from "../src/ralph-loop"

describe("RalphLoop", () => {
  beforeEach(() => {
    clearRalphLoop()
  })

  describe("registerLoop", () => {
    test("creates new loop state with default max iterations", () => {
      const state = registerLoop("session-1", "read the todo file and execute it")

      expect(state.sessionID).toBe("session-1")
      expect(state.prompt).toBe("read the todo file and execute it")
      expect(state.maxIterations).toBe(20)
      expect(state.iterationCount).toBe(0)
      expect(state.cancelled).toBe(false)
    })

    test("creates new loop state with custom max iterations", () => {
      const state = registerLoop("session-1", "test", 5)

      expect(state.maxIterations).toBe(5)
    })

    test("caps custom max at absolute maximum of 100", () => {
      const state = registerLoop("session-1", "test", 200)

      expect(state.maxIterations).toBe(100)
    })

    test("creates loop with completion promise using options object", () => {
      const state = registerLoop("session-1", {
        prompt: "read the todo file",
        completionPromise: "DONE",
        maxIterations: 5,
      })

      expect(state.prompt).toBe("read the todo file")
      expect(state.completionPromise).toBe("DONE")
      expect(state.maxIterations).toBe(5)
    })

    test("overwrites existing state if session already registered", () => {
      const first = registerLoop("session-1", "test")
      const second = registerLoop("session-1", "different prompt")

      expect(second).not.toBe(first)
      expect(second.prompt).toBe("different prompt")
      expect(first.sessionID).toBe(second.sessionID)
    })
  })

  describe("cancelLoop", () => {
    test("returns false if session not found", () => {
      const result = cancelLoop("nonexistent")

      expect(result).toBe(false)
    })

    test("cancels and removes state", () => {
      registerLoop("session-1", "test")
      const result = cancelLoop("session-1")

      expect(result).toBe(true)
      expect(isLoopActive("session-1")).toBe(false)
      expect(getLoopState("session-1")).toBeUndefined()
    })
  })

  describe("isLoopActive", () => {
    test("returns false if session not registered", () => {
      expect(isLoopActive("nonexistent")).toBe(false)
    })

    test("returns true if session registered", () => {
      registerLoop("session-1", "test")

      expect(isLoopActive("session-1")).toBe(true)
    })

    test("returns false after cancellation", () => {
      registerLoop("session-1", "test")
      cancelLoop("session-1")

      expect(isLoopActive("session-1")).toBe(false)
    })
  })

  describe("getLoopState", () => {
    test("returns undefined if session not found", () => {
      expect(getLoopState("nonexistent")).toBeUndefined()
    })

    test("returns state if session exists", () => {
      const state = registerLoop("session-1", "test")

      expect(getLoopState("session-1")).toBe(state)
    })
  })

  describe("parseRalphLoopArgs", () => {
    test("parses prompt without options", () => {
      const result = parseRalphLoopArgs(["read", "the", "todo", "file", "and", "execute", "it"])

      expect(result.prompt).toBe("read the todo file and execute it")
      expect(result.completionPromise).toBeUndefined()
      expect(result.maxIterations).toBeUndefined()
    })

    test("parses prompt with completion promise", () => {
      const result = parseRalphLoopArgs(["--completion-promise", "DONE", "read", "the", "todo", "file"])

      expect(result.prompt).toBe("read the todo file")
      expect(result.completionPromise).toBe("DONE")
    })

    test("parses prompt with max iterations", () => {
      const result = parseRalphLoopArgs(["read", "the", "todo", "file", "--max-iterations", "10"])

      expect(result.prompt).toBe("read the todo file")
      expect(result.maxIterations).toBe(10)
    })

    test("parses all options", () => {
      const result = parseRalphLoopArgs([
        "--max-iterations",
        "10",
        "read",
        "the",
        "todo",
        "file",
        "--completion-promise",
        "DONE",
      ])

      expect(result.prompt).toBe("read the todo file")
      expect(result.completionPromise).toBe("DONE")
      expect(result.maxIterations).toBe(10)
    })

    test("parses short option aliases", () => {
      const result = parseRalphLoopArgs(["test", "-p", "DONE", "-m", "10"])

      expect(result.prompt).toBe("test")
      expect(result.completionPromise).toBe("DONE")
      expect(result.maxIterations).toBe(10)
    })

    test("treats tokens after -- as prompt", () => {
      const result = parseRalphLoopArgs(["read", "this", "--", "--max-iterations", "not", "a", "flag"])

      expect(result.prompt).toBe("read this --max-iterations not a flag")
      expect(result.maxIterations).toBeUndefined()
      expect(result.completionPromise).toBeUndefined()
    })

    test("rejects invalid max iterations", () => {
      expect(() => parseRalphLoopArgs(["--max-iterations", "nope", "read", "the", "todo"])).toThrow(
        /Invalid max iterations/,
      )
      expect(() => parseRalphLoopArgs(["--max-iterations"])).toThrow(/Invalid max iterations/)
      expect(() => parseRalphLoopArgs(["--max-iterations", "0", "read", "the", "todo"])).toThrow(
        /Invalid max iterations/,
      )
    })
  })

  describe("RalphLoop hook", () => {
    test("returns early if session not registered", async () => {
      const output = { injectedTexts: [] as string[] }

      await RalphLoop["chat.waiting"]!(
        {
          sessionID: "nonexistent",
          assistantText: "hello",
          iterationCount: 0,
          assistant: {} as any,
          lastUserID: "user-1",
        },
        output,
      )

      expect(output.injectedTexts.length).toBe(0)
    })

    test("injects prompt on first call", async () => {
      registerLoop("session-1", "read the todo file and execute it")

      const output = { injectedTexts: [] as string[] }

      await RalphLoop["chat.waiting"]!(
        {
          sessionID: "session-1",
          assistantText: "hello",
          iterationCount: 0,
          assistant: {} as any,
          lastUserID: "user-1",
        },
        output,
      )

      expect(output.injectedTexts.length).toBeGreaterThan(0)
      expect(output.injectedTexts[0]).toContain("Ralph Loop 1/20")
      expect(output.injectedTexts[0]).toContain("read the todo file and execute it")
    })

    test("increments count on subsequent calls", async () => {
      registerLoop("session-1", "read the todo file and execute it")
      let state = getLoopState("session-1")!
      state.iterationCount = 0
      state.lastUserID = "user-1"

      const output = { injectedTexts: [] as string[] }

      await RalphLoop["chat.waiting"]!(
        {
          sessionID: "session-1",
          assistantText: "hello",
          iterationCount: 0,
          assistant: {} as any,
          lastUserID: "user-1",
        },
        output,
      )

      state = getLoopState("session-1")!
      expect(state.iterationCount).toBe(1)
      expect(output.injectedTexts.length).toBeGreaterThan(0)
    })

    test("stops when completion promise with XML tags is found", async () => {
      registerLoop("session-1", {
        prompt: "read the todo file and execute it",
        completionPromise: "DONE",
      })

      const output = { injectedTexts: [] as string[] }

      await RalphLoop["chat.waiting"]!(
        {
          sessionID: "session-1",
          assistantText: "I checked and <promise>DONE</promise>",
          iterationCount: 0,
          assistant: {} as any,
          lastUserID: "user-1",
        },
        output,
      )

      expect(output.injectedTexts.length).toBe(0)
      expect(isLoopActive("session-1")).toBe(false)
    })

    test("case insensitive XML tag matching", async () => {
      registerLoop("session-1", {
        prompt: "read the todo file and execute it",
        completionPromise: "DONE",
      })

      const output = { injectedTexts: [] as string[] }

      await RalphLoop["chat.waiting"]!(
        {
          sessionID: "session-1",
          assistantText: "I checked and <PROMISE>done</PROMISE>",
          iterationCount: 0,
          assistant: {} as any,
          lastUserID: "user-1",
        },
        output,
      )

      expect(output.injectedTexts.length).toBe(0)
      expect(isLoopActive("session-1")).toBe(false)
    })

    test("continues when assistant text doesn't contain completion tag", async () => {
      registerLoop("session-1", {
        prompt: "read the todo file and execute it",
        completionPromise: "DONE",
      })

      const output = { injectedTexts: [] as string[] }

      await RalphLoop["chat.waiting"]!(
        {
          sessionID: "session-1",
          assistantText: "I'm still working on it...",
          iterationCount: 0,
          assistant: {} as any,
          lastUserID: "user-1",
        },
        output,
      )

      expect(output.injectedTexts.length).toBeGreaterThan(0)
      expect(output.injectedTexts[0]).toContain("read the todo file and execute it")
      expect(output.injectedTexts[0]).toContain("<promise>DONE</promise>")
    })

    test("stops without injection when max iterations reached", async () => {
      registerLoop("session-1", "continue task")
      let state = getLoopState("session-1")!
      state.iterationCount = state.maxIterations

      const output = { injectedTexts: [] as string[] }

      await RalphLoop["chat.waiting"]!(
        {
          sessionID: "session-1",
          assistantText: "hello",
          iterationCount: 0,
          assistant: {} as any,
          lastUserID: "user-1",
        },
        output,
      )

      expect(output.injectedTexts.length).toBe(0)
      expect(isLoopActive("session-1")).toBe(false)
    })

    test("stops without injection when absolute limit reached", async () => {
      registerLoop("session-1", "continue task")
      let state = getLoopState("session-1")!
      state.iterationCount = 100
      state.maxIterations = 200 // Override to test ABSOLUTE_MAX check

      const output = { injectedTexts: [] as string[] }

      await RalphLoop["chat.waiting"]!(
        {
          sessionID: "session-1",
          assistantText: "hello",
          iterationCount: 0,
          assistant: {} as any,
          lastUserID: "user-1",
        },
        output,
      )

      expect(output.injectedTexts.length).toBe(0)
      expect(isLoopActive("session-1")).toBe(false)
    })

    test("continues loop when cancelled flag is set", async () => {
      registerLoop("session-1", "continue task")
      let state = getLoopState("session-1")!
      state.iterationCount = 0
      state.cancelled = true

      const output = { injectedTexts: [] as string[] }

      await RalphLoop["chat.waiting"]!(
        {
          sessionID: "session-1",
          assistantText: "hello",
          iterationCount: 0,
          assistant: {} as any,
          lastUserID: "user-1",
        },
        output,
      )

      expect(output.injectedTexts.length).toBe(0)
      expect(isLoopActive("session-1")).toBe(false)
    })

    test("isolates state between multiple concurrent sessions", () => {
      registerLoop("session-1", "prompt-1")
      registerLoop("session-2", "prompt-2")

      let state1 = getLoopState("session-1")!
      let state2 = getLoopState("session-2")!

      expect(state1.prompt).toBe("prompt-1")
      expect(state2.prompt).toBe("prompt-2")
      expect(state1).not.toBe(state2)

      state1.iterationCount = 5
      expect(getLoopState("session-1")!.iterationCount).toBe(5)
      expect(getLoopState("session-2")!.iterationCount).toBe(0)
    })

    test("handles empty prompt gracefully", () => {
      const state = registerLoop("session-1", "")

      expect(state.prompt).toBe("")
    })

    test("handles whitespace-only prompt", () => {
      const state = registerLoop("session-1", "   \t\n  ")

      expect(state.prompt).toBe("   \t\n  ")
    })

    test("cancelLoop returns false when no active loop exists", () => {
      const result = cancelLoop("nonexistent-session")

      expect(result).toBe(false)
      expect(isLoopActive("nonexistent-session")).toBe(false)
    })

    test("cancelLoop removes session from state", () => {
      registerLoop("session-1", "test")
      cancelLoop("session-1")

      expect(getLoopState("session-1")).toBeUndefined()
      expect(isLoopActive("session-1")).toBe(false)
    })
  })
})
