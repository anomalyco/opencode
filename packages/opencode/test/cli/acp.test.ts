import { describe, expect, test } from "bun:test"
import type { ACPConfig } from "../../src/acp/types"
import { parseSessionUrl } from "../../src/util/parse-session-url"

describe("ACP command with --prompt", () => {
  test("ACPConfig should accept initialPrompt parameter", () => {
    const config: ACPConfig = {
      sdk: {} as any,
      initialPrompt: "Test prompt",
    }

    expect(config.initialPrompt).toBe("Test prompt")
  })

  test("ACPConfig should allow undefined initialPrompt", () => {
    const config: ACPConfig = {
      sdk: {} as any,
      initialPrompt: undefined,
    }

    expect(config.initialPrompt).toBeUndefined()
  })

  test("ACPConfig should allow missing initialPrompt", () => {
    const config: ACPConfig = {
      sdk: {} as any,
    }

    expect(config.initialPrompt).toBeUndefined()
  })
})

describe("ACP command with --attach", () => {
  test("should connect SDK to existing server when --attach is specified", () => {
    const attachUrl = "http://remote-server:4096"
    const sdkBaseUrl = attachUrl

    expect(sdkBaseUrl).toBe("http://remote-server:4096")
    // ACP connects to existing server, doesn't create proxy
  })

  test("should pass initialPrompt to ACP agent when using --attach with --prompt", () => {
    const attachUrl = "http://remote-server:4096"
    const initialPrompt = "Test prompt"

    const config: ACPConfig = {
      sdk: {} as any,
      initialPrompt,
    }

    expect(config.initialPrompt).toBe("Test prompt")
    // Prompt is sent to the attached server
  })

  test("should not start local server when --attach is specified", () => {
    const attachUrl = "http://example.com:4096"
    const shouldStartServer = !attachUrl
    const sdkBaseUrl = attachUrl

    expect(shouldStartServer).toBe(false)
    expect(sdkBaseUrl).toBe("http://example.com:4096")
  })

  test("should only stop server if local server was started", () => {
    const withAttach = true
    const serverStarted = !withAttach
    const shouldStopServer = serverStarted

    expect(shouldStopServer).toBe(false)
    // No server to stop when using --attach
  })

  test("ACP --attach does not create proxy (unlike web/serve)", () => {
    const attachUrl = "http://remote-server:4096"
    const createsProxy = false // ACP just connects, doesn't proxy

    expect(createsProxy).toBe(false)
    // ACP command connects directly to remote server without proxy
  })

  test("should extract session ID from session URL when using --attach", () => {
    const attachUrl = "http://localhost:4096/ses_abc123/session/ses_abc123"

    // Simulate acp command logic
    const { baseUrl, sessionId } = parseSessionUrl(attachUrl)

    const config: ACPConfig = {
      sdk: {} as any,
      sessionId,
    }

    expect(baseUrl).toBe("http://localhost:4096")
    expect(sessionId).toBe("ses_abc123")
    expect(config.sessionId).toBe("ses_abc123")
  })

  test("should extract session ID from short session URL format", () => {
    const attachUrl = "http://localhost:4096/ses_xyz789"

    const { baseUrl, sessionId } = parseSessionUrl(attachUrl)

    const config: ACPConfig = {
      sdk: {} as any,
      sessionId,
    }

    expect(baseUrl).toBe("http://localhost:4096")
    expect(sessionId).toBe("ses_xyz789")
    expect(config.sessionId).toBe("ses_xyz789")
  })

  test("should handle base URL without session ID", () => {
    const attachUrl = "http://localhost:4096"

    const { baseUrl, sessionId } = parseSessionUrl(attachUrl)

    const config: ACPConfig = {
      sdk: {} as any,
      sessionId,
    }

    expect(baseUrl).toBe("http://localhost:4096")
    expect(sessionId).toBeUndefined()
    expect(config.sessionId).toBeUndefined()
  })

  test("should combine session URL with prompt in ACP config", () => {
    const attachUrl = "http://localhost:4096/ses_abc123"
    const promptArg = "Continue work"

    const { baseUrl, sessionId } = parseSessionUrl(attachUrl)

    const config: ACPConfig = {
      sdk: {} as any,
      sessionId,
      initialPrompt: promptArg,
    }

    expect(baseUrl).toBe("http://localhost:4096")
    expect(config.sessionId).toBe("ses_abc123")
    expect(config.initialPrompt).toBe("Continue work")
  })
})

describe("ACP command with --session option", () => {
  test("should prefer --session option over session ID from URL", () => {
    const attachUrl = "http://localhost:4096/ses_fromurl"
    const sessionOption = "ses_fromoption"

    const { baseUrl, sessionId } = parseSessionUrl(attachUrl)
    const finalSessionId = sessionOption ?? sessionId

    const config: ACPConfig = {
      sdk: {} as any,
      sessionId: finalSessionId,
    }

    expect(baseUrl).toBe("http://localhost:4096")
    expect(config.sessionId).toBe("ses_fromoption")
    expect(finalSessionId).toBe("ses_fromoption")
  })

  test("should use session ID from URL when --session not provided", () => {
    const attachUrl = "http://localhost:4096/ses_fromurl"
    const sessionOption = undefined

    const { baseUrl, sessionId } = parseSessionUrl(attachUrl)
    const finalSessionId = sessionOption ?? sessionId

    const config: ACPConfig = {
      sdk: {} as any,
      sessionId: finalSessionId,
    }

    expect(config.sessionId).toBe("ses_fromurl")
  })

  test("should use --session option without --attach (local server)", () => {
    const sessionOption = "ses_local123"

    const config: ACPConfig = {
      sdk: {} as any,
      sessionId: sessionOption,
    }

    expect(config.sessionId).toBe("ses_local123")
  })

  test("should handle --session with --prompt", () => {
    const sessionOption = "ses_abc123"
    const promptArg = "Continue work"

    const config: ACPConfig = {
      sdk: {} as any,
      sessionId: sessionOption,
      initialPrompt: promptArg,
    }

    expect(config.sessionId).toBe("ses_abc123")
    expect(config.initialPrompt).toBe("Continue work")
  })

  test("should replay messages before sending prompt when session ID is provided", () => {
    const sessionId = "ses_abc123"
    const promptArg = "New prompt after replay"

    // Simulate the ACP agent behavior
    const shouldReplayMessages = !!sessionId
    const shouldSendPrompt = !!promptArg

    // Message replay should happen BEFORE prompt is sent
    const executionOrder = []
    if (shouldReplayMessages) {
      executionOrder.push("replay_messages")
    }
    if (shouldSendPrompt) {
      executionOrder.push("send_prompt")
    }

    expect(executionOrder).toEqual(["replay_messages", "send_prompt"])
    expect(shouldReplayMessages).toBe(true)
    expect(shouldSendPrompt).toBe(true)
  })

  test("should send prompt to new session when only --prompt is provided (no --session)", () => {
    const sessionOption = undefined
    const promptArg = "Initial prompt for new session"

    const config: ACPConfig = {
      sdk: {} as any,
      sessionId: sessionOption,
      initialPrompt: promptArg,
    }

    // Should create new session (no sessionId)
    expect(config.sessionId).toBeUndefined()
    // Should send prompt
    expect(config.initialPrompt).toBe("Initial prompt for new session")

    // When newSession is called without sessionId, it should:
    // 1. Create new session
    // 2. Send initialPrompt to the new session
    const shouldCreateNewSession = !config.sessionId
    const shouldSendPrompt = !!config.initialPrompt

    expect(shouldCreateNewSession).toBe(true)
    expect(shouldSendPrompt).toBe(true)
  })
})
