import { describe, expect, test } from "bun:test"
import { AccountTransportError } from "../../src/account/schema"
import { FormatError } from "../../src/cli/error"
import { UI } from "../../src/cli/ui"

describe("cli.error", () => {
  test("formats legacy and tagged config errors the same way", () => {
    const cases = [
      {
        tag: "ConfigJsonError",
        data: { path: "/tmp/opencode.jsonc", message: "Unexpected token" },
        expected: "Config file at /tmp/opencode.jsonc is not valid JSON(C): Unexpected token",
      },
      {
        tag: "ConfigDirectoryTypoError",
        data: { path: "/tmp/opencode.jsonc", dir: ".opencode", suggestion: "opencode" },
        expected:
          'Directory ".opencode" in /tmp/opencode.jsonc is not valid. Rename the directory to "opencode" or remove it. This is a common typo.',
      },
      {
        tag: "ConfigFrontmatterError",
        data: { path: "/tmp/AGENTS.md", message: "failed frontmatter" },
        expected: "failed frontmatter",
      },
      {
        tag: "ConfigInvalidError",
        data: {
          path: "/tmp/opencode.jsonc",
          message: "schema mismatch",
          issues: [{ message: "Expected string", path: ["provider", "id"] }],
        },
        expected: "Configuration is invalid at /tmp/opencode.jsonc: schema mismatch\n↳ Expected string provider.id",
      },
    ]

    for (const item of cases) {
      expect(FormatError({ name: item.tag, data: item.data })).toBe(item.expected)
      expect(FormatError({ _tag: item.tag, ...item.data })).toBe(item.expected)
    }
  })

  test("preserves multiline JSONC diagnostics for tagged config errors", () => {
    const data = {
      path: "/tmp/opencode.jsonc",
      message:
        '\n--- JSONC Input ---\n{\n  "model": \n}\n--- Errors ---\nValueExpected at line 3, column 1\n   Line 3: }\n          ^\n--- End ---',
    }
    const expected = `Config file at ${data.path} is not valid JSON(C): ${data.message}`

    expect(FormatError({ name: "ConfigJsonError", data })).toBe(expected)
    expect(FormatError({ _tag: "ConfigJsonError", ...data })).toBe(expected)
  })

  test("formats account transport errors clearly", () => {
    const error = new AccountTransportError({
      method: "POST",
      url: "https://console.opencode.ai/auth/device/code",
    })

    const formatted = FormatError(error)

    expect(formatted).toContain("Could not reach POST https://console.opencode.ai/auth/device/code.")
    expect(formatted).toContain("This failed before the server returned an HTTP response.")
    expect(formatted).toContain("Check your network, proxy, or VPN configuration and try again.")
  })

  test("formats cancelled UI errors as empty output", () => {
    expect(FormatError(new UI.CancelledError())).toBe("")
  })
})
