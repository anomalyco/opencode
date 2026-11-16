import { describe, expect, test } from "bun:test"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode/core/codemode/instructions"

const entry = (path: string, description: string, signature?: string, pinned = false): CodeModeCatalog.Tool => ({
  type: "tool",
  name: path,
  description,
  signature: signature ?? `tools.${path}({\n  q: string,\n}): Promise<string>`,
  pinned,
})

const lookup = entry(
  "orders.lookup",
  "Look up an order by ID",
  "tools.orders.lookup({\n  id: string,\n}): Promise<{\n  id: string,\n  status: string,\n}>",
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
    CodeModeCatalog.lookup({ tools: current }),
  )

const shown = (catalog: CodeModeCatalog.Summary) =>
  catalog.namespaces.reduce((total, namespace) => total + namespace.entries.length, 0)

describe("CodeModeCatalog.summarize", () => {
  test("retains namespace inventory without retaining tools outside the inline budget", () => {
    const catalog = CodeModeCatalog.summarize(
      { tools: Array.from({ length: 10_000 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`)) },
      { budget: 0 },
    )
    expect(catalog.total).toBe(10_000)
    expect(catalog.namespaces).toHaveLength(1)
    expect(catalog.namespaces[0]?.tools).toHaveLength(10_000)
    expect(catalog.namespaces[0]?.entries).toEqual([])
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

    expect(shown(catalog)).toBe(2)
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
      { name: "alpha", tools: ["alpha.pinned"], entries: [] },
      { name: "beta", tools: ["beta.unpinned"], entries: [] },
    ].reduce((total, namespace) => total + Math.round(CodeModeCatalog.namespaceLine(namespace).length / 4), 0)

    expect(
      shown(
        CodeModeCatalog.summarize({ tools: [pinned, unpinned] }, { budget: namespaceCost + pinCost + unpinnedCost }),
      ),
    ).toBe(2)
    expect(
      shown(
        CodeModeCatalog.summarize(
          { tools: [pinned, unpinned] },
          { budget: namespaceCost + pinCost + unpinnedCost - 1 },
        ),
      ),
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
    const namespaceCost = Math.round(
      CodeModeCatalog.namespaceLine({ name: "alpha", tools: ["alpha.one"], entries: [] }).length / 4,
    )
    const description = "A namespace description that stays visible beyond the available tool budget"
    const namespace = { type: "namespace" as const, name: "alpha", description, tools: [tool] }

    expect(shown(CodeModeCatalog.summarize({ tools: [tool] }, { budget: namespaceCost + listingCost }))).toBe(1)
    const catalog = CodeModeCatalog.summarize({ tools: [namespace] }, { budget: namespaceCost + listingCost })
    expect(shown(catalog)).toBe(0)
    expect(catalog.namespaces[0]?.description).toBe(description)
    expect(CodeModeInstructions.render(catalog)).toContain(`- alpha (1 tool, none shown) // ${description}`)
  })

  test("selects tools in path order, whatever their cost", () => {
    const costly = entry("alpha.a", "A", `tools.alpha.a({\n  ${"long".repeat(40)}: string,\n}): Promise<string>`)
    const catalog = CodeModeCatalog.summarize({ tools: [entry("alpha.b", "B"), costly] }, { budget: 70 })
    expect(catalog.namespaces[0]?.entries.map((item) => item.path)).toEqual(["alpha.a"])
  })

  test("renders only the signatures it selects, and the next one it tries", () => {
    const rendered = new Set<string>()
    const tools = Array.from({ length: 500 }, (_, index): CodeModeCatalog.Tool => {
      const path = `bulk.tool${String(index).padStart(3, "0")}`
      return {
        type: "tool",
        name: path,
        description: path,
        get signature() {
          rendered.add(path)
          return `tools.${path}({ q: string }): Promise<string>`
        },
      }
    })
    const catalog = CodeModeCatalog.summarize({ tools }, { budget: 100 })
    expect(rendered.size).toBe(shown(catalog) + 1)
  })
})

describe("CodeModeInstructions.render", () => {
  test("inlines complete catalogs without search guidance", () => {
    const instructions = render([lookup])
    expect(instructions).toContain("## Code Mode tools (call only inside `execute`)")
    expect(instructions).toContain("- orders (1 tool)")
    expect(instructions).toContain(`  - ${lookup.signature} // Look up an order by ID`)
    expect(instructions).not.toContain("search")
    expect(instructions).toContain(
      "The tools listed below cannot be called directly: they only work as JavaScript inside the `execute` tool. Every other tool you have is a normal tool call: call it directly, never inside `execute`.",
    )
    expect(instructions).toContain("The catalog is complete. Do not guess tool names.")
  })

  test("adds search guidance when the catalog exceeds the budget", () => {
    const partial = render([lookup], 0)
    expect(partial).toContain("## Code Mode tools (call only inside `execute`)")
    expect(partial).toContain("- orders (1 tool, none shown)")
    expect(partial).toContain(
      "The tools listed below, and `search`, cannot be called directly: they only work as JavaScript inside the `execute` tool.",
    )
    expect(partial).toContain(
      "The catalog is partial. Before calling a tool that is not listed below, find it with the global `search(...)` function. Do not guess tool names.",
    )
    expect(partial).toContain("- search({")
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
      `tools.alpha.expensive({\n  aVeryLongParameterName: string,\n  anotherEvenLongerParameterName: number,\n  yetAnotherExtremelyVerboseParameterName: string,\n}): Promise<string>`,
    )
    // Round 1 places alpha.cheap and beta.cheap; in round 2 alpha.expensive does not fit,
    // which marks only alpha done - it must NOT prevent other namespaces from inlining.
    const namespaceCost = [
      { name: "alpha", tools: ["alpha.cheap", "alpha.expensive"], entries: [] },
      { name: "beta", tools: ["beta.cheap"], entries: [] },
    ].reduce((total, namespace) => total + Math.round(CodeModeCatalog.namespaceLine(namespace).length / 4), 0)
    const instructions = render([cheapAlpha, expensive, cheapBeta], 40 + namespaceCost)
    expect(instructions).toContain("The catalog is partial.")
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
      `tools.records.lookup({\n  /** ${"A detailed identifier description. ".repeat(20).trim()} */\n  id: string,\n}): Promise<string>`,
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
    const changed = { ...echo, signature: "tools.notes.echo({\n  text: string,\n}): Promise<string>" }
    const added = entry("notes.list", "List notes")
    const unchanged = Array.from({ length: 5 }, (_, index) => entry(`stable.tool${index}`, `Stable ${index}`))
    const text = update([echo, lookup, ...unchanged], [changed, added, ...unchanged])
    expect(text).toBe(
      [
        "The Code Mode tool catalog has changed.",
        `New tools are available in addition to those previously listed:\n  - ${added.signature} // List notes`,
        `Changed tool listings supersede the previously listed ones:\n  - ${changed.signature} // Echo text`,
        "The following tool namespaces are no longer available and must not be used: `orders`.",
      ].join("\n\n"),
    )
  })

  test("names removed tools with exact callable expressions including bracket notation", () => {
    const dashed = entry("context7.resolve-library-id", "Resolve a library ID")
    const kept = entry("context7.query-docs", "Query docs")
    expect(update([echo, dashed, kept], [echo, kept])).toContain(
      'The following tools are no longer available and must not be called: tools.context7["resolve-library-id"].',
    )
  })

  test("restates a namespace whose description changed", () => {
    const text = update(
      [{ type: "namespace", name: "notes", description: "Old description", tools: [echo] }],
      [{ type: "namespace", name: "notes", description: "New description", tools: [echo] }],
    )
    expect(text).toContain("New tools are available:\n- notes (1 tool) // New description")
    expect(text).not.toContain("Old description")
  })

  test("says nothing when only which tools are shown changes", () => {
    const alpha = Array.from({ length: 20 }, (_, index) => entry(`alpha.tool${index}`, `Tool ${index}`))
    const text = update(alpha, [...alpha, entry("beta.one", "One")], 120)
    expect(text).toStartWith("The Code Mode tool catalog has changed.\n\nNew tools are available:\n- beta (1 tool")
    expect(text).not.toContain("alpha")
    expect(update([echo], [{ ...echo, pinned: true }])).toBeUndefined()
  })

  test("shows a new tool's signature even when the catalog would not", () => {
    const alpha = Array.from({ length: 10 }, (_, index) => entry(`alpha.tool${index}`, `Tool ${index}`))
    expect(update(alpha, [...alpha, entry("alpha.tool10", "Tool 10")], 0)).toContain(
      "New tools are available in addition to those previously listed:\n  - tools.alpha.tool10({",
    )
  })

  test("counts new tools past the update budget", () => {
    const bulk = Array.from({ length: 300 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`))
    expect(update([bulk[0]!], bulk)).toMatch(/ {2}- \d+ more; search for them\n/)
  })

  test("shows a changed signature the model was shown even when the tool is no longer shown", () => {
    const before = Array.from({ length: 200 }, (_, index) => entry(`ns.tool${String(index).padStart(3, "0")}`, "Tool"))
    const last = CodeModeCatalog.summarize({ tools: before }).namespaces[0]!.entries.at(-1)!.path
    const signature = `tools.${last}({\n  key: string,\n}): Promise<string>`
    // An arriving namespace takes the room the tool was shown in, in the same step its signature changes.
    const arriving = Array.from({ length: 40 }, (_, index) => entry(`aa.tool${index}`, "Tool"))
    const after = [...arriving, ...before.map((tool) => (tool.name === last ? { ...tool, signature } : tool))]
    const current = CodeModeCatalog.summarize({ tools: after }).namespaces.find((namespace) => namespace.name === "ns")
    expect(current?.entries.map((item) => item.path)).not.toContain(last)
    expect(update(before, after)).toContain(
      `Changed tool listings supersede the previously listed ones:\n  - ${signature} // Tool`,
    )
  })

  test("shows every new tool, without pointing to search, while the catalog lists every tool", () => {
    const signature = (name: string) =>
      `tools.wide.${name}({\n  /** ${"A long parameter description. ".repeat(4)} */\n  q: string,\n}): Promise<string>`
    const wide = Array.from({ length: 30 }, (_, index) =>
      entry(`wide.tool${index}`, `Tool ${index}`, signature(`tool${index}`)),
    )
    const text = update([echo], [echo, ...wide])!
    expect(CodeModeCatalog.cost(text)).toBeGreaterThan(1_000)
    expect(text).toContain("- wide (30 tools)\n")
    expect(text).not.toContain("search")
  })

  test("introduces search once, when the catalog stops listing every tool", () => {
    const wide = Array.from({ length: 200 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`))
    const text = update([echo], [echo, ...wide])
    expect(text).toStartWith("The Code Mode tool catalog has changed.\n\nNew tools are available:\n- bulk (200 tools")
    expect(text).toContain("You can also look up tools that aren't listed with the global `search(...)` function")
    expect(text).toContain("- search({")
    expect(update([echo, ...wide], [echo, ...wide, entry("bulk.more", "More")])).not.toContain("search(")
    expect(update([echo, ...wide], [echo])).not.toContain("search(")
  })

  test("falls back to full replacement when the delta is larger than the catalog", () => {
    const removed = Array.from({ length: 200 }, (_, index) => entry(`a_long_removed_namespace_${index}.tool`, "Tool"))
    const text = update([...removed, echo], [echo])
    expect(text).toContain("This catalog supersedes the previous Code Mode tool catalog.")
    expect(text).toContain("## Code Mode tools (call only inside `execute`)")
  })
})
