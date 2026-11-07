import { describe, expect, test } from "bun:test"
import { searchSignature } from "@opencode/codemode"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode/core/codemode/instructions"

const CHANGED =
  'These namespaces changed. Lines marked "new or changed", "no longer" or "unchanged" are changes to a namespace\'s previous listing; a namespace shown without them is its whole new listing:'

const entry = (
  path: string,
  description: string,
  options: {
    readonly required?: ReadonlyArray<string>
    readonly optional?: ReadonlyArray<string>
    readonly pinned?: boolean
    readonly signature?: string
  } = {},
): CodeModeCatalog.Tool => ({
  type: "tool",
  name: path,
  description,
  signature: options.signature ?? `tools.${path}({\n  /** The id. */\n  id: string,\n}): Promise<string>`,
  compactSignature: `tools.${path}({ id: string }): Promise<string>`,
  ...(options.pinned === undefined ? {} : { pinned: options.pinned }),
  parameters: { required: options.required ?? ["id"], optional: options.optional ?? [] },
})

const tools = (namespace: string, count: number, optional: ReadonlyArray<string> = []) =>
  Array.from({ length: count }, (_, index) => entry(`${namespace}.tool${index}`, `${namespace} ${index}`, { optional }))

const summarize = (inventory: CodeModeCatalog.Inventory["tools"], budget?: number) =>
  CodeModeCatalog.summarize({ tools: inventory }, budget === undefined ? {} : { budget })

const update = (
  previous: CodeModeCatalog.Inventory["tools"],
  current: CodeModeCatalog.Inventory["tools"],
  budget?: number,
) => CodeModeInstructions.update(summarize(previous, budget), summarize(current, budget))

// The namespace blocks of an update, after its heading.
const changed = (text: string) => text.slice(text.indexOf(CHANGED) + CHANGED.length)

const unread = (path: string): CodeModeCatalog.Tool => ({
  type: "tool",
  name: path,
  description: path,
  get signature(): string {
    throw new Error("signature rendered")
  },
  get compactSignature(): string {
    throw new Error("signature rendered")
  },
  parameters: { required: ["id"], optional: [] },
})

describe("CodeModeCatalog.summarize", () => {
  test("lists a namespace with full signatures when they fit", () => {
    expect(summarize(tools("orders", 2)).namespaces[0]).toEqual({
      name: "orders",
      count: 2,
      listings: [
        {
          path: "orders.tool0",
          line: "  - tools.orders.tool0({\n  /** The id. */\n  id: string,\n}): Promise<string> // orders 0",
        },
        {
          path: "orders.tool1",
          line: "  - tools.orders.tool1({\n  /** The id. */\n  id: string,\n}): Promise<string> // orders 1",
        },
      ],
      names: [],
    })
  })

  test("falls back to one-line signatures when full ones do not fit", () => {
    const verbose = `tools.orders.tool0({\n  /** ${"x".repeat(400)} */\n  id: string,\n}): Promise<string>`
    const section = summarize([entry("orders.tool0", "x", { signature: verbose }), ...tools("orders", 3).slice(1)], 60)
      .namespaces[0]!
    expect(section.listings.map((item) => item.line)).toEqual([
      "  - tools.orders.tool0({ id: string }): Promise<string> // x",
      "  - tools.orders.tool1({ id: string }): Promise<string> // orders 1",
      "  - tools.orders.tool2({ id: string }): Promise<string> // orders 2",
    ])
  })

  test("lists names with every parameter when no signatures fit", () => {
    const section = summarize(tools("bulk", 40, ["page"]), 300).namespaces[0]!
    expect(section.listings).toEqual([])
    expect(section.names).toHaveLength(40)
    expect(section.names[0]).toBe("tool0(id, page?)")
  })

  test("drops optional parameter names when every parameter does not fit", () => {
    const section = summarize(tools("bulk", 40, ["page_cursor", "filter_expression"]), 300).namespaces[0]!
    expect(section.names).toHaveLength(40)
    expect(section.names[0]).toBe("tool0(id, …)")
  })

  test("lists as many bare names as fit, in path order, when nothing else does", () => {
    const section = summarize(tools("bulk", 1_000), 50).namespaces[0]!
    expect(section.names.length).toBeGreaterThan(0)
    expect(section.names.length).toBeLessThan(1_000)
    expect(section.names).toEqual(section.names.toSorted())
    expect(section.names.every((name) => !name.includes("("))).toBe(true)
    expect(CodeModeCatalog.namespaceLine(section)).toBe(
      `- bulk (1000 tools, ${section.names.length} listed; search for the rest)`,
    )
  })

  test("never renders signatures for a namespace too large to list them", () => {
    const section = summarize(Array.from({ length: 200 }, (_, index) => unread(`big.tool${index}`))).namespaces[0]!
    expect(section.names[0]).toBe("tool0(id)")
  })

  test("always lists pinned tools with their full signature", () => {
    const section = summarize([entry("big.pinned", "Pinned", { pinned: true }), ...tools("big", 200)]).namespaces[0]!
    expect(section.listings).toEqual([
      {
        path: "big.pinned",
        line: "  - tools.big.pinned({\n  /** The id. */\n  id: string,\n}): Promise<string> // Pinned",
      },
    ])
    expect(section.names).toHaveLength(200)
  })

  test("names a tool that sits at its namespace's own path in full", () => {
    const section = summarize([entry("deploy", "Deploy", { required: ["target"] }), ...tools("deploy", 200)])
      .namespaces[0]!
    expect(section.names[0]).toBe("tools.deploy(target)")
  })

  test("limits inline descriptions to 120 characters", () => {
    const line = summarize([entry("notes.echo", "x".repeat(200))]).namespaces[0]?.listings[0]?.line
    expect(line?.split(" // ")[1]).toBe("x".repeat(117) + "...")
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
    const text = CodeModeInstructions.render(summarize([...tools("notes", 1), ...tools("orders", 200)]))
    expect(text).toContain("they only work as JavaScript inside the `execute` tool")
    expect(text).toContain("Before calling a tool whose signature is not shown, get it with the global `search(...)`")
    expect(text).toContain(`- ${searchSignature}`)
    expect(text).toContain(
      "## Code Mode tools (call only inside `execute`)\n\n- notes (1 tool)\n  - tools.notes.tool0({\n  /** The id. */\n  id: string,\n}): Promise<string> // notes 0\n- orders (200 tools)\n  - tool0(id), tool1(id),",
    )
  })
})

describe("CodeModeInstructions.update", () => {
  test("adds a new namespace's section and nothing else", () => {
    expect(update(tools("alpha", 3), [...tools("alpha", 3), ...tools("beta", 1)])).toBe(
      "The Code Mode tool catalog has changed.\n\nNew tool namespaces are available:\n- beta (1 tool)\n  - tools.beta.tool0({\n  /** The id. */\n  id: string,\n}): Promise<string> // beta 0",
    )
  })

  test("names a removed namespace in one line", () => {
    expect(update([...tools("alpha", 3), ...tools("beta", 2)], tools("alpha", 3))).toBe(
      "The Code Mode tool catalog has changed.\n\nThe following tool namespaces are no longer available and must not be used: `beta`.",
    )
  })

  test("names the tools that changed in a namespace", () => {
    expect(update(tools("alpha", 200), tools("alpha", 201))).toBe(
      `The Code Mode tool catalog has changed.\n\n${CHANGED}\n- alpha (201 tools)\n  - new or changed: tool200(id)`,
    )
    expect(changed(update(tools("alpha", 200), tools("alpha", 200).slice(1)))).toBe(
      "\n- alpha (199 tools)\n  - no longer available: tool0",
    )
  })

  test("marks a signature change so the rest of the namespace stays listed", () => {
    const before = tools("ns", 3)
    const after = [
      entry("ns.tool0", "ns 0", { signature: "tools.ns.tool0({\n  key: string,\n}): Promise<string>" }),
      ...before.slice(1),
    ]
    expect(changed(update(before, after))).toBe(
      "\n- ns (3 tools)\n  - new or changed signatures:\n  - tools.ns.tool0({\n  key: string,\n}): Promise<string> // ns 0",
    )
  })

  test("says a name is no longer listed when its namespace is too large to list in full", () => {
    const text = update(tools("bulk", 400), [entry("bulk.a_first", "First"), ...tools("bulk", 400)], 40)
    expect(changed(text)).toContain("  - new or changed: a_first")
    expect(changed(text)).toMatch(/ {2}- no longer listed: tool\d+/)
  })

  test("says the listed tools are unchanged when only a namespace's header changed", () => {
    const before = summarize(tools("big", 300), 100)
    const after = summarize(tools("big", 301), 100)
    expect(changed(CodeModeInstructions.update(before, after))).toBe(
      `\n- big (301 tools, ${after.namespaces[0]!.names.length} listed; search for the rest)\n  - listed tools unchanged`,
    )
  })

  test("does not report a tool gone when it is only pinned or unpinned", () => {
    const listed = tools("ns", 200)
    const pinned = [entry("ns.tool0", "ns 0", { pinned: true }), ...listed.slice(1)]
    expect(changed(update(listed, pinned))).not.toContain("no longer")
    expect(changed(update(pinned, listed))).not.toContain("no longer")
  })

  test("restates a namespace's whole listing when that is shorter than its changes", () => {
    expect(changed(update(tools("alpha", 2), [entry("alpha.renamed", "x")]))).toBe(
      "\n- alpha (1 tool)\n  - tools.alpha.renamed({\n  /** The id. */\n  id: string,\n}): Promise<string> // x",
    )
  })

  test("restates a section whose description changed", () => {
    const text = CodeModeInstructions.update(
      summarize([{ type: "namespace", name: "notes", description: "Old", tools: tools("x", 1) }]),
      summarize([{ type: "namespace", name: "notes", description: "New", tools: tools("x", 1) }]),
    )
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
