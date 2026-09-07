import { describe, expect, test } from "bun:test"
import { CodeModeCatalog } from "@opencode-ai/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"

const entry = (path: string, description: string, signature?: string, pinned = false): CodeModeCatalog.Tool => ({
  type: "tool",
  name: path,
  description,
  signature: signature ?? `tools.${path}(input: {\n  q: string,\n}): Promise<string>`,
  pinned,
})

const lookup = entry(
  "orders.lookup",
  "Look up an order by ID",
  "tools.orders.lookup(input: {\n  id: string,\n}): Promise<{\n  id: string,\n  status: string,\n}>",
)

const render = (tools: CodeModeCatalog.Inventory["tools"], budget?: number) =>
  CodeModeInstructions.render(CodeModeCatalog.summarize({ tools }, budget === undefined ? {} : { budget }))

const update = (
  previous: CodeModeCatalog.Inventory["tools"],
  current: CodeModeCatalog.Inventory["tools"],
  budget?: number,
) =>
  CodeModeInstructions.update(
    CodeModeCatalog.summarize({ tools: previous }, budget === undefined ? {} : { budget }),
    CodeModeCatalog.summarize({ tools: current }, budget === undefined ? {} : { budget }),
  )

describe("CodeModeCatalog.summarize", () => {
  test("retains namespace inventory without retaining tools outside the inline budget", () => {
    const catalog = CodeModeCatalog.summarize(
      { tools: Array.from({ length: 10_000 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`)) },
      { budget: 0 },
    )
    expect(catalog).toEqual({
      total: 10_000,
      shown: 0,
      namespaces: [{ name: "bulk", count: 10_000, entries: [] }],
    })
  })

  test("retains every namespace when no full tool listing fits", () => {
    const catalog = CodeModeCatalog.summarize(
      { tools: [entry("alpha.one", "One"), entry("beta.two", "Two"), entry("gamma.three", "Three")] },
      { budget: 0 },
    )
    expect(catalog.namespaces.map((namespace) => namespace.name)).toEqual(["alpha", "beta", "gamma"])
    expect(catalog.namespaces.every((namespace) => namespace.entries.length === 0)).toBe(true)
  })

  test("always retains pinned tools beyond the inline budget", () => {
    const pinned = [entry("alpha.first", "First", undefined, true), entry("beta.second", "Second", undefined, true)]
    const catalog = CodeModeCatalog.summarize(
      { tools: [...pinned, entry("alpha.unpinned", "Unpinned")] },
      { budget: 0 },
    )

    expect(catalog.shown).toBe(2)
    expect(catalog.namespaces.flatMap((namespace) => namespace.entries.map((item) => item.path))).toEqual([
      "alpha.first",
      "beta.second",
    ])
  })

  test("spends the budget remaining after pinned tools on unpinned tools", () => {
    const pinned = entry("alpha.pinned", "Pinned", undefined, true)
    const unpinned = entry("beta.unpinned", "Unpinned")
    const pinCost = Math.round(`  - ${pinned.signature} // Pinned`.length / 4)
    const unpinnedCost = Math.round(`  - ${unpinned.signature} // Unpinned`.length / 4)
    const namespaceCost = [
      { name: "alpha", count: 1, entries: [] },
      { name: "beta", count: 1, entries: [] },
    ].reduce((total, namespace) => total + Math.round(CodeModeCatalog.namespaceLine(namespace).length / 4), 0)

    expect(
      CodeModeCatalog.summarize({ tools: [pinned, unpinned] }, { budget: namespaceCost + pinCost + unpinnedCost })
        .shown,
    ).toBe(2)
    expect(
      CodeModeCatalog.summarize({ tools: [pinned, unpinned] }, { budget: namespaceCost + pinCost + unpinnedCost - 1 })
        .shown,
    ).toBe(1)
  })

  test("retains only the rendered portion of inline descriptions", () => {
    const catalog = CodeModeCatalog.summarize({
      tools: [entry("alpha.one", `Summary\n${"detail".repeat(10_000)}`)],
    })
    expect(catalog.namespaces[0]?.entries[0]?.line).toEndWith("// Summary")
  })

  test("limits inline descriptions to 120 characters", () => {
    const catalog = CodeModeCatalog.summarize({ tools: [entry("alpha.one", "x".repeat(121))] })
    const description = catalog.namespaces[0]?.entries[0]?.line.split(" // ")[1]
    expect(description).toHaveLength(120)
    expect(description).toEndWith("...")
  })

  test("always retains namespace descriptions and charges them before tool listings", () => {
    const tool = entry("alpha.one", "One")
    const listingCost = Math.round(`  - ${tool.signature} // One`.length / 4)
    const namespaceCost = Math.round(CodeModeCatalog.namespaceLine({ name: "alpha", count: 1, entries: [] }).length / 4)
    const description = "A namespace description that stays visible beyond the available tool budget"
    const namespace = { type: "namespace" as const, name: "alpha", description, tools: [tool] }

    expect(CodeModeCatalog.summarize({ tools: [tool] }, { budget: namespaceCost + listingCost }).shown).toBe(1)
    const catalog = CodeModeCatalog.summarize({ tools: [namespace] }, { budget: namespaceCost + listingCost })
    expect(catalog.shown).toBe(0)
    expect(catalog.namespaces[0]?.description).toBe(description)
    expect(CodeModeInstructions.render(catalog)).toContain(`- alpha (1 tool, none shown) // ${description}`)
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
    expect(instructions).toContain("This catalog is the complete set of tools callable inside `execute`.")
    expect(instructions).toContain("It does not affect tools exposed directly outside Code Mode.")
  })

  test("adds search guidance when the catalog exceeds the budget", () => {
    const partial = render([lookup], 0)
    expect(partial).toContain("## Available tools")
    expect(partial).toContain("- orders (1 tool, none shown)")
    expect(partial).toContain("## Search")
    expect(partial).toContain("Call `search(...)` to discover exact paths and signatures for additional tools:")
    expect(partial).toContain("The Code Mode tool catalog below is partial.")
    expect(partial).toContain(
      "The Code Mode catalog and `search` results are the complete set of tools callable inside `execute`.",
    )
    expect(partial).toContain("It does not affect tools exposed directly outside Code Mode.")
    expect(partial).toContain("- search(input: {")
    expect(partial).toContain("  /** @integer @exclusiveMinimum 0 */\n  limit?: number,")
    expect(partial).toContain("  /** @integer @minimum 0 */\n  offset?: number,")
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
    const namespaceCost = [
      { name: "alpha", count: 2, entries: [] },
      { name: "beta", count: 1, entries: [] },
    ].reduce((total, namespace) => total + Math.round(CodeModeCatalog.namespaceLine(namespace).length / 4), 0)
    const instructions = render([cheapAlpha, expensive, cheapBeta], 40 + namespaceCost)
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

  test("restates namespace descriptions when they change", () => {
    const previous = CodeModeCatalog.summarize({
      tools: [{ type: "namespace", name: "notes", description: "Old description", tools: [echo] }],
    })
    const current = CodeModeCatalog.summarize({
      tools: [{ type: "namespace", name: "notes", description: "New description", tools: [echo] }],
    })
    const text = CodeModeInstructions.update(previous, current)
    expect(text).toContain("This catalog supersedes the previous Code Mode tool catalog.")
    expect(text).toContain("- notes (1 tool) // New description")
    expect(text).not.toContain("Old description")
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
