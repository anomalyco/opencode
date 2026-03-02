import { describe, test, expect } from "bun:test"

// Test the header-stripping logic extracted from provider.ts
function stripContext1m(beta: string) {
  return beta
    .split(",")
    .filter((h) => !h.includes("context-1m"))
    .join(",")
}

describe("context-1m header stripping", () => {
  test("strips context-1m from beta header", () => {
    const header =
      "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,adaptive-thinking-2026-01-28,context-1m-2025-08-07"
    expect(stripContext1m(header)).toBe(
      "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,adaptive-thinking-2026-01-28",
    )
  })

  test("preserves other headers when context-1m is not present", () => {
    const header = "claude-code-20250219,interleaved-thinking-2025-05-14"
    expect(stripContext1m(header)).toBe("claude-code-20250219,interleaved-thinking-2025-05-14")
  })

  test("handles context-1m as only header", () => {
    expect(stripContext1m("context-1m-2025-08-07")).toBe("")
  })
})

describe("error detection", () => {
  function matches(body: any) {
    return (
      body?.error?.type === "invalid_request_error" &&
      typeof body?.error?.message === "string" &&
      body.error.message.toLowerCase().includes("long context")
    )
  }

  test("matches the known Anthropic tier error", () => {
    expect(
      matches({
        error: {
          type: "invalid_request_error",
          message: "The long context beta is not yet available for this subscription.",
        },
      }),
    ).toBe(true)
  })

  test("matches variant wording", () => {
    expect(
      matches({
        error: {
          type: "invalid_request_error",
          message: "Extra usage is required for long context requests",
        },
      }),
    ).toBe(true)
  })

  test("does not match unrelated invalid_request_error", () => {
    expect(
      matches({
        error: {
          type: "invalid_request_error",
          message: "max_tokens must be less than 8192",
        },
      }),
    ).toBe(false)
  })

  test("does not match different error type", () => {
    expect(
      matches({
        error: {
          type: "authentication_error",
          message: "long context issue",
        },
      }),
    ).toBe(false)
  })

  test("handles null body", () => {
    expect(matches(null)).toBe(false)
  })

  test("handles missing error field", () => {
    expect(matches({})).toBe(false)
  })
})
