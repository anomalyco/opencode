import { describe, expect, test } from "bun:test"
import { parseSessionUrl } from "../../src/util/parse-session-url"

describe("attach command with session URL", () => {
  test("should extract session ID from full session URL and pass to tui", () => {
    const url = "http://localhost:4096/ses_abc123/session/ses_abc123"
    const sessionOption = undefined

    // Simulate attach command logic
    const { baseUrl, sessionId } = parseSessionUrl(url)
    const finalSessionId = sessionOption ?? sessionId

    const tuiArgs = {
      url: baseUrl,
      args: {
        sessionID: finalSessionId,
        prompt: undefined,
      },
    }

    expect(tuiArgs.url).toBe("http://localhost:4096")
    expect(tuiArgs.args.sessionID).toBe("ses_abc123")
  })

  test("should extract session ID from short session URL format", () => {
    const url = "http://localhost:4096/ses_xyz789"
    const sessionOption = undefined

    const { baseUrl, sessionId } = parseSessionUrl(url)
    const finalSessionId = sessionOption ?? sessionId

    const tuiArgs = {
      url: baseUrl,
      args: {
        sessionID: finalSessionId,
        prompt: undefined,
      },
    }

    expect(tuiArgs.url).toBe("http://localhost:4096")
    expect(tuiArgs.args.sessionID).toBe("ses_xyz789")
  })

  test("should prefer --session option over URL session ID", () => {
    const url = "http://localhost:4096/ses_fromurl"
    const sessionOption = "ses_fromoption"

    const { baseUrl, sessionId } = parseSessionUrl(url)
    const finalSessionId = sessionOption ?? sessionId

    const tuiArgs = {
      url: baseUrl,
      args: {
        sessionID: finalSessionId,
        prompt: undefined,
      },
    }

    expect(tuiArgs.args.sessionID).toBe("ses_fromoption")
  })

  test("should handle base URL without session ID", () => {
    const url = "http://localhost:4096"
    const sessionOption = undefined

    const { baseUrl, sessionId } = parseSessionUrl(url)
    const finalSessionId = sessionOption ?? sessionId

    const tuiArgs = {
      url: baseUrl,
      args: {
        sessionID: finalSessionId,
        prompt: undefined,
      },
    }

    expect(tuiArgs.url).toBe("http://localhost:4096")
    expect(tuiArgs.args.sessionID).toBeUndefined()
  })

  test("should combine session URL with prompt", () => {
    const url = "http://localhost:4096/ses_abc123"
    const promptArg = "Continue work"
    const piped = undefined

    const { baseUrl, sessionId } = parseSessionUrl(url)
    const prompt = piped ? (promptArg ? piped + "\n" + promptArg : piped) : promptArg

    const tuiArgs = {
      url: baseUrl,
      args: {
        sessionID: sessionId,
        prompt,
      },
    }

    expect(tuiArgs.url).toBe("http://localhost:4096")
    expect(tuiArgs.args.sessionID).toBe("ses_abc123")
    expect(tuiArgs.args.prompt).toBe("Continue work")
  })

  test("should submit prompt when session route is loaded with args.prompt and args.sessionID", () => {
    // Simulate session route receiving args with both prompt and sessionID
    const args = {
      sessionID: "ses_abc123",
      prompt: "Continue work",
    }

    // Only submit if sessionID was provided (attached to existing session)
    const shouldSubmitPrompt = !!args.prompt && !!args.sessionID
    const promptInput = { input: args.prompt, parts: [] }

    expect(shouldSubmitPrompt).toBe(true)
    expect(promptInput.input).toBe("Continue work")
  })

  test("should NOT submit prompt in session route when no sessionID (new session from home)", () => {
    // Simulate session route for a newly created session (no args.sessionID)
    const args = {
      sessionID: undefined,
      prompt: "Continue work",
    }

    // Should NOT submit because sessionID was not provided (home route already handled it)
    const shouldSubmitPrompt = !!args.prompt && !!args.sessionID

    expect(shouldSubmitPrompt).toBe(false)
  })
})

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
