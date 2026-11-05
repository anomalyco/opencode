import { describe, expect, test } from "bun:test"
import { searchSignature } from "@opencode/codemode"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode/core/codemode/instructions"

const entry = (
  path: string,
  description: string,
  options: { readonly parameters?: ReadonlyArray<string>; readonly pinned?: boolean; readonly signature?: string } = {},
): CodeModeCatalog.Tool => ({
  type: "tool",
  name: path,
  description,
  signature: options.signature ?? `tools.${path}({\n  q: string,\n}): Promise<string>`,
  ...(options.pinned === undefined ? {} : { pinned: options.pinned }),
  ...(options.parameters === undefined ? {} : { parameters: options.parameters }),
})

const tools = (namespace: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    entry(`${namespace}.tool${index}`, `${namespace} ${index}`, { parameters: ["id"] }),
  )

const summarize = (inventory: CodeModeCatalog.Inventory["tools"], budget?: number) =>
  CodeModeCatalog.summarize({ tools: inventory }, budget === undefined ? {} : { budget })

const update = (previous: CodeModeCatalog.Inventory["tools"], current: CodeModeCatalog.Inventory["tools"]) =>
  CodeModeInstructions.update(summarize(previous), summarize(current))

describe("CodeModeCatalog.summarize", () => {
  test("lists every tool by name with its required parameters", () => {
    const catalog = summarize([
      entry("orders.lookup", "Look up an order", { parameters: ["id"] }),
      entry("orders.list", "List orders", { parameters: ["…"] }),
      entry("orders.cancel", "Cancel an order", { parameters: ["id", "…"] }),
      entry("orders.status", "Service status"),
    ])
    expect(catalog).toEqual({
      total: 4,
      namespaces: [
        {
          name: "orders",
          count: 4,
          pinned: [],
          names: ["cancel(id, …)", "list(…)", "lookup(id)", "status"],
        },
      ],
    })
  })

  test("gives pinned tools their full signature and description", () => {
    const catalog = summarize([
      entry("notes.echo", "Echo text\nMore detail", { pinned: true }),
      entry("notes.list", "List notes", { parameters: [] }),
    ])
    expect(catalog.namespaces[0]).toEqual({
      name: "notes",
      count: 2,
      pinned: [{ path: "notes.echo", line: "  - tools.notes.echo({\n  q: string,\n}): Promise<string> // Echo text" }],
      names: ["list()"],
    })
  })

  test("limits inline descriptions to 120 characters", () => {
    const line = summarize([entry("notes.echo", "x".repeat(200), { pinned: true })]).namespaces[0]?.pinned[0]?.line
    expect(line?.split(" // ")[1]).toBe("x".repeat(117) + "...")
  })

  test("never renders the signature of a tool it lists by name", () => {
    const unread: CodeModeCatalog.Tool = {
      type: "tool",
      name: "notes.list",
      description: "List notes",
      get signature(): string {
        throw new Error("signature rendered")
      },
    }
    expect(summarize([unread]).namespaces[0]?.names).toEqual(["list"])
  })

  test("lists the leading names that fit a namespace's budget and keeps its header", () => {
    const catalog = summarize(tools("bulk", 1_000), 50)
    const section = catalog.namespaces[0]!
    expect(section.count).toBe(1_000)
    expect(section.names.length).toBeGreaterThan(0)
    expect(section.names.length).toBeLessThan(1_000)
    expect(section.names).toEqual(section.names.toSorted())
    expect(CodeModeCatalog.namespaceLine(section)).toBe(
      `- bulk (1000 tools, ${section.names.length} listed; search for the rest)`,
    )
  })

  test("keeps every namespace and its description even when nothing else fits", () => {
    const catalog = summarize(
      [{ type: "namespace", name: "docs", description: "Project docs", tools: tools("x", 3) }, ...tools("alpha", 2)],
      0,
    )
    expect(catalog.namespaces.map((section) => CodeModeCatalog.namespaceLine(section))).toEqual([
      "- alpha (2 tools, 0 listed; search for the rest)",
      "- docs (3 tools, 0 listed; search for the rest) // Project docs",
    ])
  })

  test("builds each namespace's section from its own tools alone", () => {
    const alone = summarize([...tools("alpha", 300), ...tools("beta", 5)])
    const crowded = summarize([...tools("alpha", 300), ...tools("beta", 5), ...tools("gamma", 3_000)])
    expect(crowded.namespaces.filter((section) => section.name !== "gamma")).toEqual([...alone.namespaces])
  })
})

describe("CodeModeInstructions.render", () => {
  test("renders only the no-tools notice for an empty catalog", () => {
    expect(CodeModeInstructions.render(summarize([]))).toBe(
      "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
    )
  })

  test("renders the guidance, search and each namespace's section", () => {
    const text = CodeModeInstructions.render(
      summarize([entry("notes.echo", "Echo text", { pinned: true }), ...tools("orders", 2)]),
    )
    expect(text).toContain("they only work as JavaScript inside the `execute` tool")
    expect(text).toContain("Before calling a tool whose signature is not shown, get it with the global `search(...)`")
    expect(text).toContain(`- ${searchSignature}`)
    expect(text).toEndWith(
      [
        "## Code Mode tools (call only inside `execute`)",
        "",
        "- notes (1 tool)",
        "  - tools.notes.echo({\n  q: string,\n}): Promise<string> // Echo text",
        "- orders (2 tools)",
        "  - tool0(id), tool1(id)",
      ].join("\n"),
    )
  })
})

describe("CodeModeInstructions.update", () => {
  test("adds a new namespace's section and nothing else", () => {
    expect(update(tools("alpha", 3), [...tools("alpha", 3), ...tools("beta", 2)])).toBe(
      "The Code Mode tool catalog has changed.\n\nNew tool namespaces are available:\n- beta (2 tools)\n  - tool0(id), tool1(id)",
    )
  })

  test("names a removed namespace in one line", () => {
    expect(update([...tools("alpha", 3), ...tools("beta", 2)], tools("alpha", 3))).toBe(
      "The Code Mode tool catalog has changed.\n\nThe following tool namespaces are no longer available and must not be used: `beta`.",
    )
  })

  test("restates only the sections that changed", () => {
    const text = update([...tools("alpha", 3), ...tools("beta", 2)], [...tools("alpha", 4), ...tools("beta", 2)])
    expect(text).toBe(
      "The Code Mode tool catalog has changed.\n\nThese namespaces changed; their listings supersede the previous ones:\n- alpha (4 tools)\n  - tool0(id), tool1(id), tool2(id), tool3(id)",
    )
  })

  test("restates a section whose description changed", () => {
    const text = CodeModeInstructions.update(
      summarize([{ type: "namespace", name: "notes", description: "Old", tools: tools("x", 1) }]),
      summarize([{ type: "namespace", name: "notes", description: "New", tools: tools("x", 1) }]),
    )
    expect(text).toContain("These namespaces changed")
    expect(text).toContain("- notes (1 tool) // New")
    expect(text).not.toContain("Old")
  })

  test("restates the whole catalog around an empty one", () => {
    expect(update([], tools("alpha", 1))).toStartWith(
      "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\n# Code Mode",
    )
    expect(update(tools("alpha", 1), [])).toBe(
      "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\n" +
        "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
    )
  })

  test("restates the whole catalog when that is shorter than the changes", () => {
    const gone = Array.from({ length: 200 }, (_, index) => tools(`a_long_removed_namespace_${index}`, 1)).flat()
    expect(update([...gone, ...tools("kept", 1)], tools("kept", 1))).toStartWith(
      "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.",
    )
  })
})
