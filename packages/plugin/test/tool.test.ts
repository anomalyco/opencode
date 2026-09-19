import { describe, expect, test } from "bun:test"
import { tool } from "../src/tool"

describe("tool", () => {
  test("rejects plain-object argument definitions with a clear error", () => {
    expect(() =>
      tool({
        description: "invalid tool",
        args: {
          // @ts-expect-error Verify the runtime diagnostic for JavaScript callers.
          foo: "string",
        },
        execute: async () => "ok",
      }),
    ).toThrow('Invalid tool argument "foo": args must contain Zod schemas')
  })

  test("accepts Zod argument definitions", () => {
    expect(
      tool({
        description: "valid tool",
        args: { foo: tool.schema.string() },
        execute: async ({ foo }) => foo,
      }),
    ).toBeDefined()
  })
})
