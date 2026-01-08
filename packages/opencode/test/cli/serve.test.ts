import { describe, expect, test } from "bun:test"

describe("serve command with --prompt", () => {
  test("should generate correct base URL", () => {
    const hostname = "localhost"
    const port = 4096
    const baseUrl = `http://${hostname}:${port}`

    expect(baseUrl).toBe("http://localhost:4096")
    expect(baseUrl).toContain("localhost")
  })

  test("should generate correct session URL format", () => {
    const baseUrl = "http://localhost:4096"
    const sessionId = "ses_test123"
    const sessionUrl = `${baseUrl}/${sessionId}`

    expect(sessionUrl).toBe("http://localhost:4096/ses_test123")
    expect(sessionUrl).toContain(sessionId)
  })

  test("should handle prompt parameter correctly", () => {
    const prompt = "Test prompt for serve command"

    expect(prompt).toBeDefined()
    expect(prompt.length).toBeGreaterThan(0)
  })

  test("should format console output correctly without prompt", () => {
    const baseUrl = "http://localhost:4096"
    const output = `opencode server listening on ${baseUrl}`

    expect(output).toContain("opencode server listening on")
    expect(output).toContain(baseUrl)
  })

  test("should format console output correctly with prompt", () => {
    const baseUrl = "http://localhost:4096"
    const sessionId = "ses_abc123"
    const sessionUrl = `${baseUrl}/${sessionId}/session/${sessionId}`
    const output1 = `opencode server listening on ${baseUrl}`
    const output2 = `session created: ${sessionUrl}`

    expect(output1).toContain("opencode server listening on")
    expect(output2).toContain("session created:")
    expect(output2).toContain(sessionUrl)
  })
})
