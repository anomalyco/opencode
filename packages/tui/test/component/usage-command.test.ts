import { describe, expect, test } from "bun:test"
import { parseUsageCommand, resolveUsageProvider } from "../../src/component/usage-command"

describe("usage command", () => {
  test("uses configured display mode when flags are omitted", () => {
    const result = parseUsageCommand("/usage", {
      show_usage_value_mode: "remaining",
    })
    if ("error" in result) throw new Error(result.error)
    expect(result).toEqual({
      mode: "remaining",
      background: false,
    })
  })

  test("parses mode override", () => {
    const result = parseUsageCommand("/usage --used", {
      show_usage_value_mode: "remaining",
    })
    if ("error" in result) throw new Error(result.error)
    expect(result).toEqual({
      mode: "used",
      background: false,
    })
  })

  test("parses background mode", () => {
    const result = parseUsageCommand("/usage --background")
    if ("error" in result) throw new Error(result.error)
    expect(result).toEqual({
      mode: "used",
      background: true,
    })
  })

  test("rejects conflicting mode flags", () => {
    expect(parseUsageCommand("/usage --used --remaining")).toEqual({
      error: "Choose only one of --used or --remaining.",
    })
  })

  test("rejects background with display mode", () => {
    expect(parseUsageCommand("/usage --background --remaining")).toEqual({
      error: "--background cannot be combined with --used or --remaining.",
    })
  })

  test("resolves Google provider for current-provider usage", () => {
    expect(
      resolveUsageProvider({
        scope: "current",
        modelProviderID: "google",
      }),
    ).toBe("google")
  })

  test("forwards unsupported current providers to server", () => {
    expect(
      resolveUsageProvider({
        scope: "current",
        modelProviderID: "moonshot",
      }),
    ).toBe("moonshot")
  })
})
