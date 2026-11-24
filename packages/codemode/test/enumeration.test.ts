import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"

// Key enumeration: Object.keys and for...in share one surface over plain objects, arrays
// (index strings), and tool references (namespace/tool names from the supplied tools), so a
// model can discover what it may call instead of guessing names from the instructions. The
// motivating transcript: `Object.keys(tools)` failed with the generic plain-objects-only
// message and `for (const key in tools)` was unsupported syntax, forcing blind guesses.

const echo = (description: string) =>
  Tool.make({
    description,
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.String,
    execute: ({ value }) => Effect.succeed(value),
  })

const tools = {
  github: { list_issues: echo("List issues"), get_issue: echo("Get one issue") },
  memory: { search: echo("Search memory") },
  playwright: { navigate: echo("Navigate somewhere") },
}

const run = (code: string) => Effect.runPromise(CodeMode.execute({ tools, code }))
const value = async (code: string) => {
  const result = await run(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}
const error = async (code: string) => {
  const result = await run(code)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("Object.keys over tool references", () => {
  test("enumerates top-level namespaces (the transcript program)", async () => {
    expect(
      await value(`
      const namespaces = Object.keys(tools)
      return { namespaces, count: namespaces.length }
    `),
    ).toEqual({ namespaces: ["github", "memory", "playwright"], count: 3 })
  })

  test("enumerates tool names at a nested namespace", async () => {
    expect(await value(`return Object.keys(tools.github)`)).toEqual(["list_issues", "get_issue"])
  })

  test("a callable tool is a leaf and enumerates as []", async () => {
    expect(await value(`return Object.keys(tools.github.list_issues)`)).toEqual([])
  })

  test("search is a global built-in function", async () => {
    expect(await value(`return typeof search`)).toBe("function")
  })

  test("an unknown namespace is an UnknownTool error", async () => {
    const failure = await error(`return Object.keys(tools.nonexistent)`)
    expect(failure.kind).toBe("UnknownTool")
    expect(failure.message).toContain("Unknown tool namespace 'nonexistent'")
  })

  test("Object.values/entries on a tool reference explain the working idioms", async () => {
    for (const method of ["values", "entries"] as const) {
      const failure = await error(`return Object.${method}(tools)`)
      expect(failure.kind).toBe("InvalidDataValue")
      expect(failure.message).toContain(
        `Object.${method}(...) cannot read tools: it is a namespace of host functions, not plain data. Use Object.keys(tools) for its names.`,
      )
    }
    const nested = await error(`return Object.entries(tools.github)`)
    expect(nested.message).toContain("Use Object.keys(tools) for its names")
  })
})
