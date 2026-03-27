import { describe, test, expect } from "bun:test"
import { validateProviderURL } from "../ssrf"

describe("SSRF Protection", () => {
  test("allows valid HTTPS URLs", () => {
    expect(validateProviderURL("https://api.openai.com/v1").ok).toBe(true)
  })
  test("allows localhost when explicitly permitted", () => {
    expect(validateProviderURL("http://localhost:20123/v1", { allowLocalhost: true }).ok).toBe(true)
  })
  test("blocks cloud metadata endpoint", () => {
    expect(validateProviderURL("http://169.254.169.254/latest").ok).toBe(false)
  })
  test("blocks private IP range", () => {
    expect(validateProviderURL("http://192.168.1.1/api").ok).toBe(false)
  })
  test("blocks non-http scheme", () => {
    expect(validateProviderURL("ftp://example.com").ok).toBe(false)
  })
  test("blocks localhost without allowLocalhost", () => {
    expect(validateProviderURL("http://localhost:20123/v1").ok).toBe(false)
  })
})
