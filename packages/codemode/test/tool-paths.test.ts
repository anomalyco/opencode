import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"

// Dots in supplied tool names are namespace separators: { "issues.list": tool } exposes
// the same canonical path as { issues: { list: tool } }, so every advertised dotted path
// is executable. A canonical path can be both a callable tool and a namespace, and the
// last definition supplied for a canonical path wins.

const echo = (description: string, result: string) =>
  Tool.make({
    description,
    input: Schema.Struct({}),
    output: Schema.String,
    run: () => Effect.succeed(result),
  })

const value = async (runtime: CodeMode.Runtime, code: string) => {
  const result = await Effect.runPromise(runtime.execute(code))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const failure = async (runtime: CodeMode.Runtime, code: string) => {
  const result = await Effect.runPromise(runtime.execute(code))
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("dotted tool names", () => {
  const runtime = CodeMode.make({ tools: { api: { "issues.list": echo("List issues", "listed") } } })

  test("a dotted name becomes nested namespaces in the catalog", () => {
    expect(runtime.catalog()).toHaveLength(1)
    expect(runtime.catalog()[0]?.path).toBe("api.issues.list")
    expect(runtime.catalog()[0]?.signature).toStartWith("tools.api.issues.list(input:")
    expect(runtime.instructions()).toContain("tools.api.issues.list(input:")
  })

  test("the advertised dotted path is executable", async () => {
    expect(await value(runtime, `return await tools.api.issues.list({})`)).toBe("listed")
  })

  test("bracket access with a dotted segment spells the same canonical path", async () => {
    expect(await value(runtime, `return await tools.api["issues.list"]({})`)).toBe("listed")
    expect(await value(runtime, `return await tools["api.issues"].list({})`)).toBe("listed")
  })

  test("intermediate segments enumerate like ordinary namespaces", async () => {
    expect(await value(runtime, `return [Object.keys(tools.api), Object.keys(tools.api.issues)]`)).toEqual([
      ["issues"],
      ["list"],
    ])
  })

  test("a top-level dotted name nests from the root", async () => {
    const flat = CodeMode.make({ tools: { "issues.list": echo("List issues", "flat") } })
    expect(flat.catalog()[0]?.path).toBe("issues.list")
    expect(await value(flat, `return await tools.issues.list({})`)).toBe("flat")
  })
})

describe("callable namespaces", () => {
  const runtime = CodeMode.make({
    tools: { issues: echo("All issues", "all"), "issues.list": echo("List issues", "list") },
  })

  test("a path can hold a tool and child tools at once", async () => {
    expect(await value(runtime, `return await tools.issues({})`)).toBe("all")
    expect(await value(runtime, `return await tools.issues.list({})`)).toBe("list")
    expect(runtime.catalog()?.map((tool) => tool.path)).toEqual(["issues", "issues.list"])
  })

  test("a callable namespace enumerates its children", async () => {
    expect(await value(runtime, `return Object.keys(tools.issues)`)).toEqual(["list"])
  })

  test("search returns executable paths for both", async () => {
    const result = await value(runtime, `return search({ query: "", namespace: "issues" })`)
    expect((result as { items: Array<{ path: string }> }).items.map((item) => item.path)).toEqual([
      "tools.issues",
      "tools.issues.list",
    ])
    const exact = await value(runtime, `return search({ query: "tools.issues.list" })`)
    expect((exact as { items: Array<{ path: string }> }).items.map((item) => item.path)).toEqual(["tools.issues.list"])
  })

  test("an unknown child under a callable tool is an UnknownTool error", async () => {
    const diagnostic = await failure(runtime, `return await tools.issues.missing({})`)
    expect(diagnostic.kind).toBe("UnknownTool")
    expect(diagnostic.message).toContain("Unknown tool 'issues.missing'")
  })

  test("a namespace without its own definition stays non-callable", async () => {
    const nested = CodeMode.make({ tools: { "issues.list": echo("List issues", "list") } })
    const diagnostic = await failure(nested, `return await tools.issues({})`)
    expect(diagnostic.kind).toBe("UnknownTool")
    expect(diagnostic.message).toContain("Tool 'issues' is not callable")
  })
})

describe("canonical path collisions", () => {
  test("the last definition supplied for a canonical path wins", async () => {
    const runtime = CodeMode.make({
      tools: { "issues.list": echo("First", "first"), issues: { list: echo("Second", "second") } },
    })
    expect(await value(runtime, `return await tools.issues.list({})`)).toBe("second")
    expect(runtime.catalog()).toHaveLength(1)
    expect(runtime.catalog()[0]?.description).toBe("Second")
  })

  test("overriding one path keeps sibling tools from both shapes", async () => {
    const runtime = CodeMode.make({
      tools: {
        "issues.list": echo("First list", "first"),
        issues: { list: echo("Second list", "second"), get: echo("Get issue", "got") },
        "issues.close": echo("Close issue", "closed"),
      },
    })
    // Catalog order follows first appearance of each canonical path.
    expect(runtime.catalog()?.map((tool) => tool.path)).toEqual(["issues.list", "issues.get", "issues.close"])
    expect(await value(runtime, `return await tools.issues.list({})`)).toBe("second")
    expect(await value(runtime, `return await tools.issues.get({})`)).toBe("got")
    expect(await value(runtime, `return await tools.issues.close({})`)).toBe("closed")
  })
})
