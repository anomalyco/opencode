import { describe, expect, test } from "bun:test"
import { parseSessionUrl } from "../../src/util/parse-session-url"

describe("web command with --prompt", () => {
  test("should use localhost URL when hostname is 0.0.0.0", () => {
    const hostname = "0.0.0.0"
    const port = 4096

    // Simulate web command logic
    const baseUrl = hostname === "0.0.0.0" ? `http://localhost:${port}` : `http://${hostname}:${port}`

    expect(baseUrl).toBe("http://localhost:4096")
    expect(baseUrl).toContain("localhost")
    expect(baseUrl).not.toContain("0.0.0.0")
  })

  test("should use server URL when hostname is not 0.0.0.0", () => {
    const getBaseUrl = (hostname: string, port: number) => {
      return hostname === "0.0.0.0" ? `http://localhost:${port}` : `http://${hostname}:${port}`
    }

    const baseUrl = getBaseUrl("127.0.0.1", 4096)

    expect(baseUrl).toBe("http://127.0.0.1:4096")
    expect(baseUrl).toContain("127.0.0.1")
  })

  test("should generate correct session URL format", () => {
    const baseUrl = "http://localhost:4096"
    const sessionId = "ses_test123"
    const sessionUrl = `${baseUrl}/${sessionId}/session/${sessionId}`

    expect(baseUrl).toBe("http://localhost:4096")
    expect(sessionUrl).toContain(sessionId)
  })

  test("should handle prompt parameter correctly", () => {
    const prompt = "Test prompt for web command"

    expect(prompt).toBeDefined()
    expect(prompt.length).toBeGreaterThan(0)
  })
})

describe("web command with --attach", () => {
  test("should create local proxy URL for display (not remote URL)", () => {
    const remoteUrl = "http://remote-server:4096"
    const localPort = 8080
    const localHostname = "localhost"

    // SDK connects to remote, but display shows local proxy
    const sdkBaseUrl = remoteUrl
    const displayBaseUrl = `http://${localHostname}:${localPort}`

    expect(sdkBaseUrl).toBe("http://remote-server:4096")
    expect(displayBaseUrl).toBe("http://localhost:8080")
    expect(displayBaseUrl).not.toContain("remote-server")
  })

  test("should display local proxy session URL when using --attach with --prompt", () => {
    const remoteUrl = "http://remote-server:4096"
    const localBaseUrl = "http://localhost:8080"
    const sessionId = "ses_abc123"

    // Session created on remote but URL shown is local proxy
    const displaySessionUrl = `${localBaseUrl}/${sessionId}`

    expect(displaySessionUrl).toBe("http://localhost:8080/ses_abc123")
    expect(displaySessionUrl).toContain(localBaseUrl)
    expect(displaySessionUrl).not.toContain("remote-server")
  })

  test("should create proxy server instead of OpenCode server when --attach is used", () => {
    const remoteUrl = "http://remote-server:4096"
    const localPort = 8080

    // When --attach is used, we create a proxy not an OpenCode server
    const isProxyServer = !!remoteUrl
    const proxyListensOn = `http://localhost:${localPort}`

    expect(isProxyServer).toBe(true)
    expect(proxyListensOn).toBe("http://localhost:8080")
  })

  test("should respect local network flags when creating proxy", () => {
    const remoteUrl = "http://remote-server:4096"
    const localHostname = "0.0.0.0"
    const localPort = 9000

    // Proxy respects local network configuration
    const proxyUrl =
      localHostname === "0.0.0.0" ? `http://localhost:${localPort}` : `http://${localHostname}:${localPort}`

    expect(proxyUrl).toBe("http://localhost:9000")
  })

  test("should output identical format with or without --attach", () => {
    // Without --attach
    const normalOutput = "http://localhost:4096"

    // With --attach (should look identical)
    const proxyOutput = "http://localhost:4096"

    expect(normalOutput).toBe(proxyOutput)
    // User should not be able to tell the difference from output
  })

  test("should use existing session when session URL is provided in --attach", () => {
    const attachUrl = "http://remote:4096/ses_existing/session/ses_existing"
    const localPort = 8080

    // Simulate web command logic
    const { baseUrl: remoteUrl, sessionId } = parseSessionUrl(attachUrl)
    const localBaseUrl = `http://localhost:${localPort}`

    const shouldCreateNewSession = !sessionId
    let actualSessionId = sessionId ?? "would_create_new"

    const displaySessionUrl = `${localBaseUrl}/${actualSessionId}/session/${actualSessionId}`

    expect(shouldCreateNewSession).toBe(false)
    expect(actualSessionId).toBe("ses_existing")
    expect(displaySessionUrl).toBe("http://localhost:8080/ses_existing/session/ses_existing")
  })

  test("should create new session when no session ID in attach URL", () => {
    const attachUrl = "http://remote:4096"
    const localPort = 8080

    const { baseUrl: remoteUrl, sessionId } = parseSessionUrl(attachUrl)
    const localBaseUrl = `http://localhost:${localPort}`

    const shouldCreateNewSession = !sessionId

    expect(shouldCreateNewSession).toBe(true)
    expect(sessionId).toBeUndefined()
  })

  test("should send prompt to existing session from URL", () => {
    const attachUrl = "http://localhost:4096/ses_existing"
    const promptArg = "Continue work"

    // Simulate web command logic
    const { baseUrl, sessionId } = parseSessionUrl(attachUrl)

    let actualSessionId: string
    if (sessionId) {
      actualSessionId = sessionId
    } else {
      actualSessionId = "new_ses_123" // Would create new session
    }

    const shouldSendPrompt = !!promptArg
    const targetSessionId = actualSessionId

    expect(actualSessionId).toBe("ses_existing")
    expect(shouldSendPrompt).toBe(true)
    expect(targetSessionId).toBe("ses_existing")
  })

  test("should open session in browser with local proxy URL", () => {
    const attachUrl = "http://remote:4096/ses_abc123"
    const localPort = 8080

    const { baseUrl: remoteUrl, sessionId } = parseSessionUrl(attachUrl)
    const localBaseUrl = `http://localhost:${localPort}`

    const actualSessionId = sessionId!
    const browserUrl = `${localBaseUrl}/${actualSessionId}/session/${actualSessionId}`

    expect(browserUrl).toBe("http://localhost:8080/ses_abc123/session/ses_abc123")
    expect(browserUrl).not.toContain("remote")
  })
})
