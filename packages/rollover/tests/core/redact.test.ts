import { describe, expect, test } from "bun:test"
import { redact, redactRecordFields } from "../../src/core/redact"

describe("REDACTIONS", () => {
  test("strips sk- api keys", () => {
    expect(redact("key=sk-abcdefghijklmnopqrstuvwxyz1234")).toBe("key=[redacted]")
  })
  test("strips ghp tokens", () => {
    expect(redact("ghp_" + "A".repeat(36))).toBe("[redacted]")
  })
  test("strips AKIA aws keys", () => {
    expect(redact("AKIAIOSFODNN7EXAMPLE")).toBe("[redacted]")
  })
  test("strips PEM private keys", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
    expect(redact(pem)).toBe("[redacted]")
  })
  test("strips jwt tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    expect(redact(jwt)).toBe("[redacted]")
  })
  test("strips password/secret/token assignments", () => {
    expect(redact("password: hunter2")).toBe("password: [redacted]")
    expect(redact("api_key=abc123")).toBe("api_key=[redacted]")
    expect(redact("secret = s3cr3t")).toBe("secret = [redacted]")
  })
  test("strips credentials in urls", () => {
    expect(redact("https://user:pass@example.com/x")).toBe("https://[redacted]@example.com/x")
  })
  test("leaves normal text alone", () => {
    expect(redact("hello world")).toBe("hello world")
  })
})

describe("redactRecord", () => {
  test("applies to text, rationale, process fields", () => {
    const out = redactRecordFields({
      kind: "record",
      id: "i1",
      type: "open_item",
      text: "started with token sk-abcdefghijklmnopqrstuvwxyz1234",
      rationale: "password: hunter2",
      process: { command: "curl https://user:pass@example.com", purpose: "test", onResult: "secret: x" },
      epoch: 0,
      userMessageId: "u1",
      turnMessageId: "a1",
      createdAt: 0,
    })
    expect(out.text).toContain("[redacted]")
    expect(out.rationale).toBe("password: [redacted]")
    expect(out.process?.command).toBe("curl https://[redacted]@example.com")
    expect(out.process?.onResult).toBe("secret: [redacted]")
  })
})
