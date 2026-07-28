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
  CodeModeInstructions.update(CodeModeCatalog.summarize(previous, budget), CodeModeCatalog.summarize(current, budget))

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
  test("inlines complete catalogs without search guidance", () => {
    const instructions = render([lookup])
    expect(instructions).toContain("## Available tools")
    expect(instructions).toContain("- orders (1 tool)")
    expect(instructions).toContain(`  - ${lookup.signature} // Look up an order by ID`)
    expect(instructions).not.toContain("## Search")
    expect(instructions).toContain("The Code Mode tool catalog below is complete.")
    expect(instructions).not.toContain("surrounding top-level agent tools")
  })

  test("adds search guidance when the catalog exceeds the budget", () => {
    const partial = render([lookup], 0)
    expect(partial).toContain("## Available tools")
    expect(partial).toContain("- orders (1 tool, none shown)")
    expect(partial).toContain("## Search")
    expect(partial).toContain("The Code Mode tool catalog below is partial.")
    expect(partial).not.toContain("surrounding top-level agent tools")
    expect(partial).toContain("- search(input: {")
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
    expect(instructions).toContain("## Search")
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
    expect(instructions).toContain("- records (1 tool, none shown)")
    expect(instructions).not.toContain("tools.records.lookup(input:")
  })

  test("renders only the no-tools notice for an empty catalog", () => {
    expect(render([])).toBe(
      "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
    )
  })
})

describe("CodeModeInstructions.update", () => {
  const echo = entry("notes.echo", "Echo text")

  test("renders additions, changes, and removals as a compact semantic delta", () => {
    const changed = { ...echo, signature: "tools.notes.echo(input: {\n  text: string,\n}): Promise<string>" }
    const added = entry("notes.list", "List notes")
    const unchanged = Array.from({ length: 5 }, (_, index) => entry(`stable.tool${index}`, `Stable ${index}`))
    const text = update([echo, lookup, ...unchanged], [changed, added, ...unchanged])
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
    expect(text).toContain("## Search")
    expect(text).toContain("## Available tools")
  })

  test("falls back to full replacement when the delta is larger than the catalog", () => {
    const previous = Array.from({ length: 200 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`))
    const text = update([...previous, echo], [echo])
    expect(text).toContain("This catalog supersedes the previous Code Mode tool catalog.")
    expect(text).toContain("## Available tools")
    expect(text).not.toContain("## Search")
    expect(text).not.toContain("The following tools are no longer available")
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
