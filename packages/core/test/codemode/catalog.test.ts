import { describe, expect, test } from "bun:test"
import { CodeModeCatalog } from "@opencode-ai/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"

const entry = (path: string, description: string, signature?: string): CodeModeCatalog.Entry => ({
  path,
  description,
  signature: signature ?? `tools.${path}(input: {\n  q: string,\n}): Promise<string>`,
})

const lookup = entry(
  "orders.lookup",
  "Look up an order by ID",
  "tools.orders.lookup(input: {\n  id: string,\n}): Promise<{\n  id: string,\n  status: string,\n}>",
)

const render = (entries: ReadonlyArray<CodeModeCatalog.Entry>, budget?: number) =>
  CodeModeInstructions.render(CodeModeCatalog.summarize(entries, budget))

const update = (
  previous: ReadonlyArray<CodeModeCatalog.Entry>,
  current: ReadonlyArray<CodeModeCatalog.Entry>,
  budget?: number,
) =>
  CodeModeInstructions.update(
    CodeModeCatalog.summarize(previous, budget),
    CodeModeCatalog.summarize(current, budget),
  )

describe("CodeModeCatalog.summarize", () => {
  test("retains namespace inventory without retaining tools outside the inline budget", () => {
    const catalog = CodeModeCatalog.summarize(
      Array.from({ length: 10_000 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`)),
      0,
    )
    expect(catalog).toEqual({
      total: 10_000,
      shown: 0,
      namespaces: [{ name: "bulk", count: 10_000, entries: [] }],
    })
  })

  test("retains every namespace when no full tool listing fits", () => {
    const catalog = CodeModeCatalog.summarize(
      [entry("alpha.one", "One"), entry("beta.two", "Two"), entry("gamma.three", "Three")],
      0,
    )
    expect(catalog.namespaces.map((namespace) => namespace.name)).toEqual(["alpha", "beta", "gamma"])
    expect(catalog.namespaces.every((namespace) => namespace.entries.length === 0)).toBe(true)
  })

  test("retains only the rendered portion of inline descriptions", () => {
    const catalog = CodeModeCatalog.summarize([entry("alpha.one", `Summary\n${"detail".repeat(10_000)}`)])
    expect(catalog.namespaces[0]?.entries[0]?.line).toEndWith("// Summary")
  })

  test("limits inline descriptions to 120 characters", () => {
    const catalog = CodeModeCatalog.summarize([entry("alpha.one", "x".repeat(121))])
    const description = catalog.namespaces[0]?.entries[0]?.line.split(" // ")[1]
    expect(description).toHaveLength(120)
    expect(description).toEndWith("...")
  })
})

describe("CodeModeInstructions.render", () => {
  test("inlines complete catalogs with markdown sections and placeholder-only call forms", () => {
    const instructions = render([lookup])
    expect(instructions).toContain("## Available tools (COMPLETE list")
    expect(instructions).toContain("- orders (1 tool)")
    expect(instructions).toContain(`  - ${lookup.signature} // Look up an order by ID`)
    expect(instructions).not.toContain("search(")

    expect(instructions).toContain("## Workflow")
    expect(instructions).toContain("## Rules")
    expect(instructions).toContain("## Language")
    expect(instructions.indexOf("## Workflow")).toBeLessThan(instructions.indexOf("## Rules"))
    expect(instructions.indexOf("## Rules")).toBeLessThan(instructions.indexOf("## Language"))
    expect(instructions.indexOf("## Language")).toBeLessThan(instructions.indexOf("\n## Available tools (COMPLETE"))
    expect(instructions).toContain("Do not infer or normalize tool names")
    expect(instructions).toContain("bracket notation and quotes are part of the path")
    expect(instructions).toContain("surrounding agent tools are not available")
    expect(instructions).toContain("Only tools listed here are available")
    expect(instructions).toContain("`const result = await tools.<namespace>.<tool>(input)`")
    expect(instructions).toContain("check that it is a non-null object and not an array")
    expect(instructions).not.toContain("tools.orders.lookup({")
    expect(instructions).toContain("1. Pick a tool from the list under `## Available tools`")
    expect(instructions).not.toContain("Browse one namespace")
  })

  test("describes the restricted runtime without overclaiming", () => {
    const instructions = render([lookup])
    expect(instructions).toContain("restricted JavaScript language for calling tools")
    expect(instructions).toContain("not a general-purpose runtime")
    for (const missing of ["Modules/imports", "classes", "fetch"]) {
      expect(instructions).toContain(missing)
    }
    // Generators are supported by the interpreter and must not be listed as unavailable.
    expect(instructions).not.toContain("generators")
    expect(instructions).toContain("URL, URLSearchParams, and URI encoding helpers")
    expect(instructions).toContain("Use tools for external operations")
    expect(instructions).toContain(
      "Prefer explicit `return`; otherwise only the final top-level expression becomes the result.",
    )
    expect(instructions).toContain(
      "Dates and URLs serialize to strings at data boundaries; Map/Set/RegExp/URLSearchParams serialize to `{}`.",
    )
  })

  test("switches to search-first guidance when the catalog exceeds the budget", () => {
    const partial = render([lookup], 0)
    expect(partial).toContain("## Available tools (PARTIAL - 0 of 1 shown; find the rest with search(...))")
    expect(partial).toContain("- orders (1 tool, none shown)")
    expect(partial).toContain(
      '1. If needed, discover tools with the built-in search function: `return search({ query: "<intent + key nouns>" })`.',
    )
    expect(partial).toContain("In the next execution, copy a returned path exactly")
    expect(partial).toContain("Only tools listed here or returned by the built-in `search` function")
    expect(partial).toContain('- Browse one namespace: `search({ query: "", namespace: "<name>" })`.')
    expect(partial).toContain("repeat the same search with `offset: next.offset`")
    expect(partial).toContain("Search returns complete callable signatures:\n- search(input: {")
    expect(partial).toContain("  limit?: number,\n  offset?: number,")
    expect(partial).not.toContain("tools.orders.lookup(input:")
  })

  test("budgets signatures round-robin so every namespace remains visible", () => {
    const cheapAlpha = entry("alpha.cheap", "Cheap")
    const cheapBeta = entry("beta.cheap", "Cheap")
    const expensive = entry(
      "alpha.expensive",
      "Expensive",
      `tools.alpha.expensive(input: {\n  aVeryLongParameterName: string,\n  anotherEvenLongerParameterName: number,\n  yetAnotherExtremelyVerboseParameterName: string,\n}): Promise<string>`,
    )
    // Round 1 places alpha.cheap and beta.cheap; in round 2 alpha.expensive does not fit,
    // which marks only alpha done - it must NOT prevent other namespaces from inlining.
    const instructions = render([cheapAlpha, expensive, cheapBeta], 40)
    expect(instructions).toContain("## Available tools (PARTIAL - 2 of 3 shown; find the rest with search(...))")
    expect(instructions).toContain("- alpha (2 tools, 1 shown)")
    expect(instructions).toContain(`  - ${cheapAlpha.signature} // Cheap`)
    expect(instructions).not.toContain("tools.alpha.expensive(")
    expect(instructions).toContain("- beta (1 tool)")
    expect(instructions).toContain(`  - ${cheapBeta.signature} // Cheap`)
  })

  test("charges inline JSDoc in signatures against the catalog token budget", () => {
    const documented = entry(
      "records.lookup",
      "Look up a record",
      `tools.records.lookup(input: {\n  /** ${"A detailed identifier description. ".repeat(20).trim()} */\n  id: string,\n}): Promise<string>`,
    )
    const instructions = render([documented], 40)
    expect(instructions).toContain("## Available tools (PARTIAL - 0 of 1 shown; find the rest with search(...))")
    expect(instructions).not.toContain("tools.records.lookup(input:")
  })

  test("renders the no-tools notice with minimal sections for an empty catalog", () => {
    const instructions = render([])
    expect(instructions).toContain("No tools are currently available.")
    expect(instructions).toContain("## Language")
    expect(instructions).not.toContain("## Available tools")
    expect(instructions).not.toContain("## Workflow")
    expect(instructions).not.toContain("## Rules")
    expect(instructions).not.toContain("search(")
  })
})

describe("CodeModeInstructions.update", () => {
  const echo = entry("notes.echo", "Echo text")

  test("renders additions, changes, and removals as a compact semantic delta", () => {
    const changed = { ...echo, signature: "tools.notes.echo(input: {\n  text: string,\n}): Promise<string>" }
    const added = entry("notes.list", "List notes")
    const text = update([echo, lookup], [changed, added])
    expect(text).toContain("The Code Mode tool catalog has changed.")
    expect(text).toContain(`New tools are available in addition to those previously listed:\n  - ${added.signature}`)
    expect(text).toContain(
      `Changed tool listings supersede the previously listed ones:\n  - ${changed.signature} // Echo text`,
    )
    expect(text).toContain("The following tools are no longer available and must not be called: tools.orders.lookup.")
    expect(text).not.toContain("## Available tools")
  })

  test("names removed tools with exact callable expressions including bracket notation", () => {
    const dashed = entry("context7.resolve-library-id", "Resolve a library ID")
    const text = update([echo, dashed], [echo])
    expect(text).toContain(
      'The following tools are no longer available and must not be called: tools.context7["resolve-library-id"].',
    )
  })

  test("restates the full catalog when the rendering mode crosses full and compact", () => {
    const wide = Array.from({ length: 40 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`))
    const text = update([echo], [echo, ...wide], 30)
    expect(text).toContain(
      "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.",
    )
    expect(text).toContain("## Available tools (PARTIAL")
  })

  test("falls back to full replacement when the delta is larger than the catalog", () => {
    const previous = Array.from({ length: 200 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`))
    const text = update([...previous, echo], [echo])
    expect(text).toContain("This catalog supersedes the previous Code Mode tool catalog.")
    expect(text).toContain("## Available tools (COMPLETE list")
    expect(text).not.toContain("must not be called")
  })

  test("renders namespace-only deltas without persisting hidden tool entries", () => {
    const alpha = Array.from({ length: 10 }, (_, index) => entry(`alpha.tool${index}`, `Tool ${index}`))
    const text = update(alpha, [...alpha, entry("alpha.tool10", "Tool 10")], 0)
    expect(text).toContain("`alpha` now has 11 tools")
    expect(text).toContain("search them again before relying on previous results")
    expect(text).not.toContain("tools.alpha.tool10(input:")
    expect(text).not.toContain("## Available tools")
  })
})
