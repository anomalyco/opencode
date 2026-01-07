import { describe, expect, test } from "bun:test"
import fuzzysort from "fuzzysort"
import { Locale } from "../../../src/util/locale"
import type { AutocompleteOption } from "../../../src/cli/cmd/tui/component/prompt/autocomplete"

/**
 * Tests for the autocomplete fuzzy filtering logic.
 *
 * The autocomplete component uses fuzzysort to filter options by multiple keys:
 * - `value` (or `display` as fallback) for the primary match
 * - `description` for secondary matching
 * - `aliases` for alternative names
 *
 * The `value` field allows matching against a different string than what
 * is displayed (e.g., full file paths when display is truncated).
 */

/**
 * Replicates the fuzzy filtering logic from autocomplete.tsx
 */
function filterOptions(query: string, options: AutocompleteOption[]): AutocompleteOption[] {
  if (!query) return options

  const result = fuzzysort.go(query, options, {
    keys: [(obj) => obj.value ?? obj.display.trimEnd(), "description", (obj) => obj.aliases?.join(" ") ?? ""],
    limit: 10,
  })

  return result.map((arr) => arr.obj)
}

describe("autocomplete filter", () => {
  describe("value usage", () => {
    test("uses value for fuzzy matching when available", () => {
      const options: AutocompleteOption[] = [
        {
          display: "src/comp…vice.ts", // truncated
          value: "src/components/authentication/AuthService.ts", // full path
        },
        {
          display: "README.md",
          value: "README.md",
        },
      ]

      // Search for "authentication" which only exists in value
      const results = filterOptions("authentication", options)

      expect(results).toHaveLength(1)
      expect(results[0].value).toBe("src/components/authentication/AuthService.ts")
    })

    test("falls back to display when value is undefined", () => {
      const options: AutocompleteOption[] = [
        {
          display: "package.json",
          // no value
        },
        {
          display: "tsconfig.json",
          // no value
        },
      ]

      const results = filterOptions("package", options)

      expect(results).toHaveLength(1)
      expect(results[0].display).toBe("package.json")
    })

    test("matches on description as secondary key", () => {
      const options: AutocompleteOption[] = [
        {
          display: "/help",
          description: "show help information",
        },
        {
          display: "/exit",
          description: "quit the application",
        },
      ]

      const results = filterOptions("information", options)

      expect(results).toHaveLength(1)
      expect(results[0].display).toBe("/help")
    })

    test("matches on aliases as tertiary key", () => {
      const options: AutocompleteOption[] = [
        {
          display: "/new",
          aliases: ["/clear"],
        },
        {
          display: "/exit",
          aliases: ["/quit", "/q"],
        },
      ]

      const results = filterOptions("clear", options)

      expect(results).toHaveLength(1)
      expect(results[0].display).toBe("/new")
    })
  })

  describe("truncated display with value", () => {
    test("matches text hidden by truncation when value contains full path", () => {
      const fullPath = "src/components/features/authentication/UserAuthenticationService.ts"
      const truncatedDisplay = Locale.truncateMiddle(fullPath, 35)

      // Verify the display is truncated and search term is not visible
      expect(truncatedDisplay).toContain("…")
      expect(truncatedDisplay).not.toContain("authentication")

      const options: AutocompleteOption[] = [
        {
          display: truncatedDisplay,
          value: fullPath,
        },
      ]

      const results = filterOptions("authentication", options)

      expect(results).toHaveLength(1)
      expect(results[0].value).toBe(fullPath)
    })

    test("does not match text hidden by truncation when value is not set", () => {
      const fullPath = "src/components/features/authentication/UserAuthenticationService.ts"
      const truncatedDisplay = Locale.truncateMiddle(fullPath, 35)

      // Verify search term is not visible in truncated display
      expect(truncatedDisplay).not.toContain("authentication")

      const options: AutocompleteOption[] = [
        {
          display: truncatedDisplay,
          // value not set - only display is used for matching
        },
      ]

      const results = filterOptions("authentication", options)

      expect(results).toHaveLength(0)
    })

    test("matches across files with various path lengths", () => {
      const files = [
        "src/index.ts",
        "src/components/ui/buttons/PrimaryButton.tsx",
        "src/features/dashboard/analytics/charts/LineChartComponent.tsx",
      ]

      const options: AutocompleteOption[] = files.map((path) => ({
        display: Locale.truncateMiddle(path, 35),
        value: path,
      }))

      const results = filterOptions("analytics", options)

      expect(results).toHaveLength(1)
      expect(results[0].value).toBe("src/features/dashboard/analytics/charts/LineChartComponent.tsx")
    })

    test("returns all matching files when multiple match", () => {
      const options: AutocompleteOption[] = [
        {
          display: Locale.truncateMiddle("src/utils/helpers/auth.ts", 35),
          value: "src/utils/helpers/auth.ts",
        },
        {
          display: Locale.truncateMiddle("src/components/authentication/AuthProvider.tsx", 35),
          value: "src/components/authentication/AuthProvider.tsx",
        },
        {
          display: Locale.truncateMiddle("src/services/auth/authService.ts", 35),
          value: "src/services/auth/authService.ts",
        },
      ]

      const results = filterOptions("auth", options)

      expect(results).toHaveLength(3)
      const targets = results.map((r) => r.value)
      expect(targets).toContain("src/utils/helpers/auth.ts")
      expect(targets).toContain("src/components/authentication/AuthProvider.tsx")
      expect(targets).toContain("src/services/auth/authService.ts")
    })
  })

  describe("MCP resources", () => {
    test("matches text hidden by truncation in MCP resource name", () => {
      const fullText = "database-connection-manager (mcp://localhost:3000/resources/db)"
      const truncatedDisplay = Locale.truncateMiddle(fullText, 30)

      // Verify the display is truncated and search term is not visible
      expect(truncatedDisplay).toContain("…")
      expect(truncatedDisplay).not.toContain("manager")

      const options: AutocompleteOption[] = [
        {
          display: truncatedDisplay,
          value: fullText,
          description: "Manages database connections",
        },
      ]

      const results = filterOptions("manager", options)

      expect(results).toHaveLength(1)
      expect(results[0].value).toBe(fullText)
    })

    test("matches MCP resource by URI when truncated", () => {
      const fullText = "config (mcp://production-server.example.com/config)"
      const truncatedDisplay = Locale.truncateMiddle(fullText, 35)

      expect(truncatedDisplay).not.toContain("production")

      const options: AutocompleteOption[] = [
        {
          display: truncatedDisplay,
          value: fullText,
        },
      ]

      const results = filterOptions("production", options)

      expect(results).toHaveLength(1)
      expect(results[0].value).toBe(fullText)
    })

    test("matches multiple MCP resources", () => {
      const resources = [
        "auth-service (mcp://auth.local/api)",
        "user-database (mcp://db.local/users)",
        "auth-tokens (mcp://auth.local/tokens)",
      ]

      const options: AutocompleteOption[] = resources.map((r) => ({
        display: Locale.truncateMiddle(r, 30),
        value: r,
      }))

      const results = filterOptions("auth", options)

      expect(results).toHaveLength(2)
      const values = results.map((r) => r.value)
      expect(values).toContain("auth-service (mcp://auth.local/api)")
      expect(values).toContain("auth-tokens (mcp://auth.local/tokens)")
    })
  })

  describe("edge cases", () => {
    test("handles empty query", () => {
      const options: AutocompleteOption[] = [
        { display: "file1.ts", value: "file1.ts" },
        { display: "file2.ts", value: "file2.ts" },
      ]

      const results = filterOptions("", options)

      // Empty query returns all options
      expect(results).toHaveLength(2)
    })

    test("handles empty options", () => {
      const results = filterOptions("test", [])

      expect(results).toHaveLength(0)
    })

    test("handles value with line range suffix", () => {
      // The autocomplete supports file#lineStart-lineEnd syntax
      const options: AutocompleteOption[] = [
        {
          display: Locale.truncateMiddle("src/components/Button.tsx#10-50", 35),
          value: "src/components/Button.tsx#10-50",
        },
      ]

      const results = filterOptions("Button", options)

      expect(results).toHaveLength(1)
    })

    test("handles special characters in paths", () => {
      const options: AutocompleteOption[] = [
        {
          display: Locale.truncateMiddle("src/components/[slug]/page.tsx", 35),
          value: "src/components/[slug]/page.tsx",
        },
        {
          display: Locale.truncateMiddle("src/app/(auth)/login/page.tsx", 35),
          value: "src/app/(auth)/login/page.tsx",
        },
      ]

      const results = filterOptions("slug", options)
      expect(results).toHaveLength(1)
      expect(results[0].value).toBe("src/components/[slug]/page.tsx")

      const authResults = filterOptions("auth", options)
      expect(authResults).toHaveLength(1)
      expect(authResults[0].value).toBe("src/app/(auth)/login/page.tsx")
    })
  })
})
