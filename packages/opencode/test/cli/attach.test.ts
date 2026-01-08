import { describe, expect, test } from "bun:test"

describe("attach command with --prompt", () => {
  test("should combine piped input with prompt argument", () => {
    const piped = "piped content"
    const promptArg = "prompt argument"

    // Simulate attach command logic
    const result = piped ? piped + "\n" + promptArg : promptArg

    expect(result).toBe("piped content\nprompt argument")
    expect(result).toContain(piped)
    expect(result).toContain(promptArg)
  })

  test("should use only prompt argument when no piped input", () => {
    const piped = undefined
    const promptArg = "prompt argument"

    // Simulate attach command logic
    const result = piped ? piped + "\n" + promptArg : promptArg

    expect(result).toBe("prompt argument")
    expect(result).not.toContain("\n")
  })

  test("should use only piped input when no prompt argument", () => {
    const piped = "piped content"
    const promptArg = undefined

    // Simulate attach command logic
    const result = promptArg ? (piped ? piped + "\n" + promptArg : promptArg) : piped

    expect(result).toBe("piped content")
  })

  test("should return undefined when neither piped input nor prompt argument", () => {
    const piped = undefined
    const promptArg = undefined

    // Simulate attach command logic
    const result = promptArg ? (piped ? piped + "\n" + promptArg : promptArg) : piped

    expect(result).toBeUndefined()
  })

  test("should construct tui args correctly with prompt", () => {
    const sessionID = "ses_test123"
    const prompt = "test prompt"

    const tuiArgs = {
      sessionID,
      prompt,
    }

    expect(tuiArgs.sessionID).toBe(sessionID)
    expect(tuiArgs.prompt).toBe(prompt)
  })

  test("should construct tui args correctly without prompt", () => {
    const sessionID = "ses_test123"
    const prompt = undefined

    const tuiArgs = {
      sessionID,
      prompt,
    }

    expect(tuiArgs.sessionID).toBe(sessionID)
    expect(tuiArgs.prompt).toBeUndefined()
  })
})
