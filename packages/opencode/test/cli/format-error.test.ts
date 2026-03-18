import { test, expect, describe } from "bun:test"
import { FormatError } from "../../src/cli/error"
import { Config } from "../../src/config/config"
import z from "zod"

function parseOrFail(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input)
  if (!result.success) return result.error
  throw new Error("expected parse to fail")
}

describe("FormatError for ConfigInvalidError", () => {
  test("uses tree to show concrete field errors instead of generic message", () => {
    const McpLocal = z.object({ type: z.literal("local"), command: z.string() }).strict()
    const McpRemote = z.object({ type: z.literal("remote"), url: z.string() }).strict()
    const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
    const schema = z.object({ mcp: z.record(z.string(), Mcp) }).strict()

    const err = parseOrFail(schema, { mcp: { postgres: { type: "local" } } })
    const invalid = new Config.InvalidError({
      path: "/test/opencode.json",
      issues: err.issues,
      tree: z.treeifyError(err),
    })

    const formatted = FormatError(invalid)
    expect(formatted).toContain("Configuration is invalid at /test/opencode.json")
    expect(formatted).toContain("command")
    expect(formatted).not.toContain("Invalid input mcp.postgres")
  })

  test("shows unrecognized keys from tree", () => {
    const schema = z.object({ model: z.string() }).strict()
    const err = parseOrFail(schema, { model: "test", unknown_key: 1 })

    const invalid = new Config.InvalidError({
      path: "/test/opencode.json",
      issues: err.issues,
      tree: z.treeifyError(err),
    })

    const formatted = FormatError(invalid)
    expect(formatted).toContain("unknown_key")
  })

  test("shows type mismatch details from tree", () => {
    const schema = z.object({ provider: z.object({ api_key: z.string() }).strict() }).strict()
    const err = parseOrFail(schema, { provider: { api_key: 123 } })

    const invalid = new Config.InvalidError({
      path: "/test/opencode.json",
      issues: err.issues,
      tree: z.treeifyError(err),
    })

    const formatted = FormatError(invalid)
    expect(formatted).toContain("api_key")
    expect(formatted).toContain("string")
  })

  test("falls back to issues when tree is not provided", () => {
    const invalid = new Config.InvalidError({
      path: "/test/opencode.json",
      issues: [
        {
          code: "invalid_type",
          expected: "string",
          path: ["mcp", "postgres", "command"],
          message: "Required",
        } as any,
      ],
    })

    const formatted = FormatError(invalid)
    expect(formatted).toContain("Configuration is invalid at /test/opencode.json")
    expect(formatted).toContain("mcp.postgres.command")
  })

  test("formats deeply nested errors", () => {
    const schema = z
      .object({
        provider: z
          .object({
            settings: z
              .object({
                timeout: z.number(),
              })
              .strict(),
          })
          .strict(),
      })
      .strict()

    const err = parseOrFail(schema, { provider: { settings: { timeout: "not a number" } } })

    const invalid = new Config.InvalidError({
      path: "/test/opencode.json",
      issues: err.issues,
      tree: z.treeifyError(err),
    })

    const formatted = FormatError(invalid)
    expect(formatted).toContain("provider.settings.timeout")
  })
})
