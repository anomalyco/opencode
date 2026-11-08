import { describe, expect, test } from "bun:test"
import { searchSignature } from "@opencode/codemode"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode/core/codemode/instructions"

const CHANGED = "The Code Mode tool catalog has changed."

const entry = (
  path: string,
  description = path,
  options: { readonly pinned?: boolean; readonly signature?: string } = {},
): CodeModeCatalog.Tool => ({
  type: "tool",
  name: path,
  description,
  signature: options.signature ?? `tools.${path}({\n  /** The id. */\n  id: string,\n}): Promise<string>`,
  ...(options.pinned === undefined ? {} : { pinned: options.pinned }),
})

const tools = (group: string, count: number) =>
  Array.from({ length: count }, (_, index) => entry(`${group}.tool${String(index).padStart(3, "0")}`))

const inventory = (entries: CodeModeCatalog.Inventory["tools"]) => ({ tools: entries })

const summarize = (entries: CodeModeCatalog.Inventory["tools"], budget?: number) =>
  CodeModeCatalog.summarize(inventory(entries), budget === undefined ? {} : { budget })

const update = (
  previous: CodeModeCatalog.Inventory["tools"],
  current: CodeModeCatalog.Inventory["tools"],
  budget?: number,
) =>
  CodeModeInstructions.update(
    summarize(previous, budget),
    summarize(current, budget),
    CodeModeCatalog.lookup(inventory(current)),
  )

const shown = (summary: CodeModeCatalog.Summary, name: string) =>
  summary.namespaces.find((section) => section.name === name)?.listings.map((item) => item.path) ?? []

const counted = (path: string, rendered: Set<string>): CodeModeCatalog.Tool => ({
  type: "tool",
  name: path,
  description: path,
  get signature(): string {
    rendered.add(path)
    return `tools.${path}({ id: string }): Promise<string>`
  },
})

describe("CodeModeCatalog.summarize", () => {
  test("shows every tool with its full signature when the catalog fits", () => {
    expect(summarize(tools("orders", 2)).namespaces).toEqual([
      {
        name: "orders",
        tools: ["orders.tool000", "orders.tool001"],
        listings: [
          {
            path: "orders.tool000",
            line: "  - tools.orders.tool000({\n  /** The id. */\n  id: string,\n}): Promise<string> // orders.tool000",
          },
          {
            path: "orders.tool001",
            line: "  - tools.orders.tool001({\n  /** The id. */\n  id: string,\n}): Promise<string> // orders.tool001",
          },
        ],
      },
    ])
  })

  test("groups take turns showing their tools in path order while they fit", () => {
    const summary = summarize([...tools("alpha", 50), ...tools("beta", 50)], 200)
    const alpha = shown(summary, "alpha")
    const beta = shown(summary, "beta")
    expect(alpha.length).toBeGreaterThan(0)
    expect(Math.abs(alpha.length - beta.length)).toBeLessThanOrEqual(1)
    expect(alpha).toEqual(tools("alpha", alpha.length).map((tool) => tool.name))
  })

  test("gives space a small group does not need to the others", () => {
    const summary = summarize([...tools("big", 100), ...tools("small", 1)], 400)
    expect(shown(summary, "small")).toHaveLength(1)
    expect(shown(summary, "big").length).toBeGreaterThan(
      summarize([...tools("big", 100), ...tools("other", 100)], 400).namespaces[0]!.listings.length,
    )
  })

  test("always shows pinned tools first, even past the budget", () => {
    const summary = summarize([entry("big.zz_pinned", "Pinned", { pinned: true }), ...tools("big", 100)], 1)
    expect(shown(summary, "big")).toEqual(["big.zz_pinned"])
  })

  test("renders only the signatures it shows, and the next one it tried", () => {
    const rendered = new Set<string>()
    const summary = summarize(
      Array.from({ length: 500 }, (_, i) => counted(`huge.z${String(i).padStart(3, "0")}`, rendered)),
      100,
    )
    expect(rendered.size).toBe(shown(summary, "huge").length + 1)
  })

  test("depends only on the tools", () => {
    const entries = [...tools("alpha", 40), ...tools("beta", 40)]
    expect(summarize(entries.toReversed())).toEqual(summarize(entries))
  })

  test("limits inline descriptions to 120 characters", () => {
    const line = summarize([entry("notes.echo", "x".repeat(200))]).namespaces[0]?.listings[0]?.line
    expect(line?.split(" // ")[1]).toBe("x".repeat(117) + "...")
  })

  test("headers say how many tools a group shows when it shows only some", () => {
    const summary = summarize(tools("big", 100), 100)
    const section = summary.namespaces[0]!
    expect(CodeModeCatalog.namespaceLine(section)).toBe(`- big (100 tools, ${section.listings.length} shown)`)
    expect(CodeModeCatalog.namespaceLine(summarize(tools("one", 1)).namespaces[0]!)).toBe("- one (1 tool)")
  })
})

describe("CodeModeInstructions.render", () => {
  test("renders only the no-tools notice for an empty catalog", () => {
    expect(CodeModeInstructions.render(summarize([]))).toBe(
      "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
    )
  })

  test("renders the guidance, search and every group", () => {
    const text = CodeModeInstructions.render(summarize([...tools("notes", 1), ...tools("orders", 1)]))
    expect(text).toContain("they only work as JavaScript inside the `execute` tool")
    expect(text).toContain("A group may show only some of its tools.")
    expect(text).toContain(`- ${searchSignature}`)
    expect(text).toContain(
      "## Code Mode tools (call only inside `execute`)\n\n- notes (1 tool)\n  - tools.notes.tool000(",
    )
    expect(text).toContain("\n- orders (1 tool)\n  - tools.orders.tool000(")
  })
})

describe("CodeModeInstructions.update", () => {
  test("shows a new group's tools", () => {
    expect(update(tools("alpha", 3), [...tools("alpha", 3), entry("beta.go", "Go")])).toBe(
      `${CHANGED}\n\nNew tools are available:\n- beta (1 tool)\n  - tools.beta.go({\n  /** The id. */\n  id: string,\n}): Promise<string> // Go`,
    )
  })

  test("shows a new group's first tools that fit the update budget", () => {
    const text = update(tools("alpha", 1), [...tools("alpha", 1), ...tools("beta", 200)])!
    const count = text.match(/- beta \(200 tools, (\d+) shown\)/)?.[1]
    expect(Number(count)).toBeGreaterThan(0)
    expect(Number(count)).toBeLessThan(200)
    expect(CodeModeCatalog.cost(text.length)).toBeLessThan(1_100)
  })

  test("names a removed group in one line", () => {
    expect(update([...tools("alpha", 3), ...tools("beta", 2)], tools("alpha", 3))).toBe(
      `${CHANGED}\n\nThe \`beta\` tools are no longer available and must not be used.`,
    )
  })

  test("shows a new tool's signature even when the catalog would not", () => {
    expect(update(tools("alpha", 200), [...tools("alpha", 200), entry("alpha.zz_new", "New")], 50)).toBe(
      `${CHANGED}\n\nNew:\n  - tools.alpha.zz_new({\n  /** The id. */\n  id: string,\n}): Promise<string> // New`,
    )
  })

  test("counts new tools past the update budget", () => {
    const text = update(tools("alpha", 1), [...tools("alpha", 1), ...tools("alpha", 300).slice(1)])!
    expect(text).toStartWith(`${CHANGED}\n\nNew:\n`)
    expect(text).toMatch(/ {2}- \d+ more in `alpha`; search for them$/)
  })

  test("shows a changed signature the model was shown", () => {
    const after = [
      entry("ns.tool000", "ns.tool000", { signature: "tools.ns.tool000({\n  key: string,\n}): Promise<string>" }),
      ...tools("ns", 3).slice(1),
    ]
    expect(update(tools("ns", 3), after)).toBe(
      `${CHANGED}\n\nChanged:\n  - tools.ns.tool000({\n  key: string,\n}): Promise<string> // ns.tool000`,
    )
  })

  test("shows a changed signature the model was shown even when the tool is no longer shown", () => {
    const before = tools("ns", 200)
    const last = shown(summarize(before), "ns").at(-1)!
    const signature = `tools.${last}({\n  key: string,\n}): Promise<string>`
    // An arriving group takes the room the tool was shown in, in the same step its signature changes.
    const after = [
      ...tools("aa", 40),
      ...before.map((tool) => (tool.name === last ? entry(last, last, { signature }) : tool)),
    ]
    expect(shown(summarize(after), "ns")).not.toContain(last)
    expect(update(before, after)).toContain(`Changed:\n  - ${signature} // ${last}`)
  })

  test("names removed tools", () => {
    expect(update(tools("alpha", 3), tools("alpha", 3).slice(1))).toBe(
      `${CHANGED}\n\nNo longer available: tools.alpha.tool000`,
    )
  })

  test("says nothing when only what the catalog shows moves", () => {
    const base = [...tools("alpha", 100), ...tools("beta", 100)]
    expect(update(base, [...base, ...tools("gamma", 5)], 300)).not.toContain("alpha")
    const listed = tools("ns", 3)
    expect(update(listed, [entry("ns.tool000", "ns.tool000", { pinned: true }), ...listed.slice(1)])).toBeUndefined()
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
})
