import { describe, test, expect } from "bun:test"
import { parseSessionUrl } from "../../src/util/parse-session-url"

describe("parseSessionUrl", () => {
  test("should parse base URL without session", () => {
    const result = parseSessionUrl("http://localhost:4096")
    expect(result.baseUrl).toBe("http://localhost:4096")
    expect(result.sessionId).toBeUndefined()
  })

  test("should parse base URL with trailing slash", () => {
    const result = parseSessionUrl("http://localhost:4096/")
    expect(result.baseUrl).toBe("http://localhost:4096")
    expect(result.sessionId).toBeUndefined()
  })

  test("should parse session URL with session ID only", () => {
    const result = parseSessionUrl("http://localhost:4096/ses_abc123")
    expect(result.baseUrl).toBe("http://localhost:4096")
    expect(result.sessionId).toBe("ses_abc123")
  })

  test("should parse full session URL format", () => {
    const result = parseSessionUrl("http://localhost:4096/ses_abc123/session/ses_abc123")
    expect(result.baseUrl).toBe("http://localhost:4096")
    expect(result.sessionId).toBe("ses_abc123")
  })

  test("should handle HTTPS URLs", () => {
    const result = parseSessionUrl("https://example.com:8080/ses_xyz789")
    expect(result.baseUrl).toBe("https://example.com:8080")
    expect(result.sessionId).toBe("ses_xyz789")
  })

  test("should handle alphanumeric session IDs", () => {
    const result = parseSessionUrl("http://localhost:4096/ses_4623efa19ffeMSpTJuf6uJ2n1r")
    expect(result.baseUrl).toBe("http://localhost:4096")
    expect(result.sessionId).toBe("ses_4623efa19ffeMSpTJuf6uJ2n1r")
  })

  test("should handle remote server URLs", () => {
    const result = parseSessionUrl("http://remote-server:5096")
    expect(result.baseUrl).toBe("http://remote-server:5096")
    expect(result.sessionId).toBeUndefined()
  })
})
