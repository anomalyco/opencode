import { describe, expect, test } from "bun:test"
import { validateImportMessages } from "@/cli/cmd/import"

describe("validateImportMessages", () => {
  test("should pass for valid assistant message with complete metadata", () => {
    const messages = [
      {
        info: {
          id: "msg1",
          role: "assistant" as const,
          metadata: {
            sessionID: "sess1",
            time: { created: 1000, completed: 2000 },
            assistant: {
              cost: 100,
              path: { cwd: "/home", root: "/home" },
              tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 100, write: 50 } },
              modelID: "claude-3-5-sonnet",
              providerID: "anthropic",
            },
          },
          parts: [],
        },
        parts: [],
      },
    ]

    const result = validateImportMessages(messages)
    expect(result.warnings).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  test("should warn for assistant message missing assistant metadata", () => {
    const messages = [
      {
        info: {
          id: "msg1",
          role: "assistant" as const,
          metadata: {
            sessionID: "sess1",
            time: { created: 1000, completed: 2000 },
          },
          parts: [],
        },
        parts: [],
      },
    ]

    const result = validateImportMessages(messages)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("missing assistant metadata")
    expect(result.errors).toHaveLength(0)
  })

  test("should warn for assistant message with modelID but missing providerID", () => {
    const messages = [
      {
        info: {
          id: "msg1",
          role: "assistant" as const,
          metadata: {
            sessionID: "sess1",
            time: { created: 1000, completed: 2000 },
            assistant: {
              cost: 100,
              modelID: "claude-3-5-sonnet",
              // missing providerID
            },
          },
          parts: [],
        },
        parts: [],
      },
    ]

    const result = validateImportMessages(messages)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("missing providerID")
    expect(result.errors).toHaveLength(0)
  })

  test("should handle messages with unrecognized part types gracefully", () => {
    const messages = [
      {
        info: {
          id: "msg1",
          role: "assistant" as const,
          metadata: {
            sessionID: "sess1",
            time: { created: 1000, completed: 2000 },
            assistant: {
              cost: 10,
              modelID: "claude-3-5-sonnet",
              providerID: "anthropic",
            },
          },
          parts: [
            { type: "text" as const, text: "Hello" },
            { type: "unknown" as any, data: "test" },
          ],
        },
        parts: [],
      },
    ]

    const result = validateImportMessages(messages)
    // Should pass - unrecognized parts are handled gracefully in fromV1
    expect(result.errors).toHaveLength(0)
  })

  test("should error for user message missing sessionID", () => {
    const messages = [
      {
        info: {
          id: "msg1",
          role: "user" as const,
          metadata: {
            time: { created: 1000 },
            // missing sessionID
          },
          parts: [],
        },
        parts: [],
      },
    ]

    const result = validateImportMessages(messages)
    // User message missing sessionID triggers two errors:
    // 1. User message validation
    // 2. General "message missing sessionID" check
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
    expect(result.errors.some((e) => e.includes("missing sessionID"))).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  test("should error for message missing ID", () => {
    const messages = [
      {
        info: {
          // missing id
          role: "user" as const,
          metadata: {
            sessionID: "sess1",
            time: { created: 1000 },
          },
          parts: [],
        },
        parts: [],
      },
    ]

    const result = validateImportMessages(messages)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("missing ID")
    expect(result.warnings).toHaveLength(0)
  })

  test("should pass for valid user message", () => {
    const messages = [
      {
        info: {
          id: "msg1",
          role: "user" as const,
          metadata: {
            sessionID: "sess1",
            time: { created: 1000 },
          },
          parts: [{ type: "text" as const, text: "Hello" }],
        },
        parts: [],
      },
    ]

    const result = validateImportMessages(messages)
    expect(result.warnings).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  test("should handle multiple messages with mixed issues", () => {
    const messages = [
      {
        info: {
          id: "msg1",
          role: "assistant" as const,
          metadata: {
            sessionID: "sess1",
            time: { created: 1000, completed: 2000 },
            // missing assistant metadata
          },
          parts: [],
        },
        parts: [],
      },
      {
        info: {
          id: "msg2",
          role: "user" as const,
          metadata: {
            sessionID: "sess1",
            time: { created: 2000 },
          },
          parts: [],
        },
        parts: [],
      },
    ]

    const result = validateImportMessages(messages)
    expect(result.warnings).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
  })
})