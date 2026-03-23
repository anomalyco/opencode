import { describe, expect, test } from "bun:test"
import stripAnsi from "strip-ansi"

import { formatConsoleAccountLabel, formatConsoleOrgLine } from "../../src/cli/cmd/account-display"

describe("console account display", () => {
  test("includes the account url in account labels", () => {
    expect(stripAnsi(formatConsoleAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, false))).toBe(
      "one@example.com https://one.example.com",
    )
  })

  test("includes the active marker in account labels", () => {
    expect(stripAnsi(formatConsoleAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, true))).toBe(
      "one@example.com https://one.example.com (active)",
    )
  })

  test("includes the account url in org rows", () => {
    expect(
      stripAnsi(
        formatConsoleOrgLine(
          {
            id: "org-1",
            name: "One",
            email: "one@example.com",
            url: "https://one.example.com",
          },
          true,
        ),
      ),
    ).toBe("  ● One  one@example.com  https://one.example.com  org-1")
  })
})
