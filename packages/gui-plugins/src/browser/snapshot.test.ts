import { expect, test } from "bun:test"
import type { Protocol } from "devtools-protocol"
import { accessibilitySnapshot } from "./snapshot"
import { documentRefs } from "./refs"

function node(id: number, role: string, name: string, ...children: number[]): Protocol.Accessibility.AXNode {
  return {
    nodeId: String(id),
    backendDOMNodeId: id,
    ignored: false,
    role: { type: "role", value: role },
    name: { type: "string", value: name },
    childIds: children.map(String),
  }
}

function options() {
  let id = 0

  return { previous: new Map<number, string>(), picked: new Map<number, string>(), ref: () => `e${++id}` }
}

test("interactive find keeps controls and their context, not static text or picked decoration", async () => {
  const tree = [
    node(1, "navigation", "Projects", 2, 3, 9),
    node(2, "StaticText", "intro".repeat(100)),
    node(3, "row", "", 4, 5),
    node(4, "cell", "Atlas"),
    node(5, "button", "Edit"),
    node(9, "link", "Next"),
  ]

  const setup = options()
  setup.picked.set(2, "e42")
  const all = await accessibilitySnapshot(tree, { ...setup, interactive: true, maxLines: 1 })
  expect(all.content).toStartWith('@e1 [button] "Edit" in navigation "Projects" / row "Atlas"')
  expect(all.content).toContain("1 interactive")
  expect(all.content).not.toContain("intro")
  expect(all.truncated).toBe(true)
  expect(all.refs.get("e2")).toBe(1)
  const found = await accessibilitySnapshot(tree, { ...setup, interactive: true, text: "NEXT", maxLines: 1 })
  expect(found.content).toBe('@e3 [link] "Next" in navigation "Projects"')
  expect(found.truncated).toBe(false)
  expect((await accessibilitySnapshot(tree, { ...setup, maxLines: 2 })).content.split("\n")).toHaveLength(2)
})

test("empty wrappers cost neither depth nor indentation; named groups and picked elements survive", async () => {
  const wrappers = Array.from({ length: 80 }, (_, i) => node(i + 1, "generic", "", i + 2))
  const tree = [...wrappers, node(81, "group", "Toolbar", 82), node(82, "button", "Save")]
  const setup = options()
  setup.picked.set(72, "e99")
  const result = await accessibilitySnapshot(tree, setup)
  expect(result.content.split("\n")).toEqual(['@e99 [generic] ""', '  [group] "Toolbar"', '    @e1 [button] "Save"'])
  expect(result.truncated).toBe(false)
  expect((await accessibilitySnapshot(tree, { ...setup, depth: 1 })).truncated).toBe(true)
  expect((await accessibilitySnapshot(tree, { ...setup, root: 82, previous: new Map([[82, "e1"]]) })).content).toBe(
    '@e1 [button] "Save"',
  )
})

test("budgets whole lines, not traversal: find reaches the last item of a truncated snapshot", async () => {
  const buttons = Array.from({ length: 2000 }, (_, i) => node(i + 1, "button", `${"x".repeat(80)} ${i}`))
  const tree = [node(0, "group", "List", ...buttons.map((_, i) => i + 1)), ...buttons]
  const setup = options()
  const page = await accessibilitySnapshot(tree, setup)
  expect(page.truncated).toBe(true)
  expect(page.content.length).toBeLessThanOrEqual(20_000)
  expect(page.content).toEndWith("maxChars/maxLines.")
  expect(page.content).not.toContain(' 1999"')
  const match = await accessibilitySnapshot(tree, { ...setup, text: " 1999" })
  expect(match.truncated).toBe(false)
  expect([...match.refs.values()]).toEqual([2000])
})

test("links that fill the budget leave a quarter for headings, opening text and status, which return unused", async () => {
  const links = Array.from({ length: 1000 }, (_, i) => node(i + 10, "link", `Sidebar entry ${i}`))
  const rows = Array.from({ length: 200 }, (_, i) => node(i + 2000, "row", `Row ${i}`))
  const prose = Array.from({ length: 400 }, (_, i) => node(i + 3000, "StaticText", `Paragraph ${i} explains one more detail of arrays.`))

  const article = [
    node(1, "generic", "", ...links.map((_, i) => i + 10), 2, 3, 4, 5, 6, ...prose.map((_, i) => i + 3000)),
    node(2, "heading", "Array reference"),
    node(3, "StaticText", "The Array object stores a list of values."),
    node(4, "table", "Methods", 7, ...rows.map((_, i) => i + 2000)),
    node(5, "status", "", 8),
    node(6, "StaticText", "Closing remark"),
    node(7, "columnheader", "Method"),
    node(8, "StaticText", "Saved"),
    ...links,
    ...rows,
    ...prose,
  ]

  const page = (await accessibilitySnapshot(article, options())).content

  for (const text of ['[heading] "Array reference"', "The Array object", '[columnheader] "Method"', '"Saved"', '"Paragraph 0 ']) expect(page).toContain(text)

  // Cells and rows do not spend the share on a table's first rows.
  expect(page).not.toContain('"Row 199"')
  const linkChars = page.split("\n").filter((line) => line.includes("[link]")).join("\n").length
  expect(linkChars).toBeGreaterThan(14_000)
  expect(linkChars).toBeLessThan(15_500)
  const controls = (await accessibilitySnapshot([node(1, "generic", "", ...links.map((_, i) => i + 10)), ...links], options())).content
  expect(controls.length).toBeGreaterThan(19_500)
  expect((await accessibilitySnapshot(article, { ...options(), interactive: true })).content).not.toContain("The Array object")
})

test("orders landmarks across empty branching wrappers, follows aria-owns cycles once, and never enters an editor", async () => {
  const tree = [
    node(1, "generic", "", 2, 3, 4),
    node(2, "navigation", "Menu", 5),
    node(3, "main", "Body", 1, 6),
    node(4, "dialog", "Confirm"),
    node(5, "textbox", "Password", 7),
    node(6, "StaticText", "Body"),
    node(7, "StaticText", "secret"),
  ]

  const result = await accessibilitySnapshot(tree, options())
  expect(result.content.split("\n").map((s) => s.trim().split(" ")[1])).toEqual([
    "[dialog]",
    "[main]",
    "[navigation]",
    "[textbox]",
  ])
  expect(result.content).not.toContain("secret")
  expect((await accessibilitySnapshot(tree, { ...options(), text: "secret" })).content).toBe("")
})

test("summarizes collections, preserves late selections, and expands a scoped collection", async () => {
  const items = Array.from({ length: 30 }, (_, i) => node(i + 2, "option", `City ${i}`))
  items[29].properties = [{ name: "selected", value: { type: "boolean", value: true } }]
  const tree = [node(1, "listbox", "Cities", ...items.map((_, i) => i + 2)), ...items]
  const result = await accessibilitySnapshot(tree, options())
  expect(result.content).toContain('"City 29" selected=true')
  expect(result.content).toContain('"City 27"')
  expect(result.truncated).toBe(false)
  const short = await accessibilitySnapshot(tree, { ...options(), maxLines: 10 })
  expect(short.content).toContain('"City 29" selected=true')
  expect(short.content).toContain("+21 more in @")
  const scoped = await accessibilitySnapshot(tree, { ...options(), root: 1 })
  expect(scoped.truncated).toBe(false)
  expect(scoped.content).toContain('"City 27"')
})

test("alerts and nested dialogs outrank navigation; invalid fields and safe values survive a tight budget", async () => {
  const field = node(4, "textbox", "Email")
  field.properties = (["invalid", "readonly", "required"] as const).map((key) => ({
    name: key,
    value: { type: "boolean", value: true },
  }))
  field.value = { type: "string", value: "bad@" }
  const other = { ...node(6, "textbox", "Password"), value: { type: "string" as const, value: "secret" } }

  const tree = [
    node(1, "generic", "", 2, 5),
    node(2, "navigation", "Routes", 3),
    node(3, "dialog", "Submit", 4, 6),
    field,
    node(5, "alert", "Errors"),
    other,
  ]

  const content = (await accessibilitySnapshot(tree, { ...options(), readableValue: async (id) => id === 4 })).content
  expect(content.indexOf("[dialog]")).toBeLessThan(content.indexOf("[navigation]"))
  expect(content.indexOf("[alert]")).toBeLessThan(content.indexOf("[navigation]"))
  expect(content).toContain('invalid=true required=true readonly=true value="bad@"')
  expect(content).not.toContain("secret")
})

test("headings inside collapsed card wrappers distinguish identical controls", async () => {
  const tree = [
    node(1, "list", "", 2, 6),
    node(2, "listitem", "", 3, 5),
    node(3, "generic", "", 4),
    node(4, "heading", "Alpha"),
    node(5, "button", "Edit"),
    node(6, "listitem", "", 7, 9),
    node(7, "generic", "", 8),
    node(8, "heading", "Beta"),
    node(9, "button", "Edit"),
  ]

  const result = await accessibilitySnapshot(tree, { ...options(), interactive: true })
  expect(result.content).toContain('[button] "Edit" in heading "Alpha"')
  expect(result.content).toContain('[button] "Edit" in heading "Beta"')
})

test("an invalid input in the last table row survives truncation", async () => {
  const rows = Array.from({length:40}, (_, i) => node(i+2,"row","",i+42))
  const fields = rows.map((_, i) => node(i+42,"textbox",`Field ${i}`))
  fields[39].properties = [{name:"invalid",value:{type:"token",value:"true"}}]
  const root = node(1,"table","Form",...rows.map(row=>Number(row.nodeId)))
  const result = await accessibilitySnapshot([root,...rows,...fields],{...options(),interactive:true,maxLines:3})
  expect(result.content).toContain('[textbox] "Field 39" invalid=true')
  expect(result.content).not.toContain('"Field 38"')
})

test("an unnamed list item uses its text inside a wrapper as context", async () => {
  const result = await accessibilitySnapshot([node(1,"listitem","",2,4),node(2,"generic","",3),node(3,"StaticText","Project Fox"),node(4,"button","Edit")],{...options(),interactive:true})
  expect(result.content).toContain('[button] "Edit" in listitem "Project Fox"')
})

test("prefers a nonignored root and can find a known ref after its role changes", async () => {
  const first = { ...node(1, "generic", ""), ignored: true, nodeId: "ignored" }

  const result = await accessibilitySnapshot([first, node(1, "group", "Renamed")], {
    ...options(),
    root: 1,
    text: "@e9",
    previous: new Map([[1, "e9"]]),
  })

  expect(result.content).toBe('@e9 [group] "Renamed"')
})

test("snapshot, find, then scope by the first ref without invalidating the second", async () => {
  const live = documentRefs()
  const tree = [node(1, "generic", "", 2, 3), node(2, "button", "First"), node(3, "button", "Second")]
  const setup = options()

  const read = async (extra: { maxLines?: number; text?: string; root?: number }) => {
    const result = await accessibilitySnapshot(tree, { ...setup, ...extra, previous: live.previous("main") })
    live.add("main", undefined, result.refs)

    return result.content
  }

  await read({ maxLines: 1 })
  await read({ text: "Second" })
  expect(await read({ root: live.get("e1")?.backendID })).toBe('@e1 [button] "First"')
  expect(live.get("e2")?.backendID).toBe(3)
  expect(await read({})).toContain('@e2 [button] "Second"')
  live.clear()
  expect(live.get("e1")).toBeUndefined()
  expect(live.previous("main").size).toBe(0)
})
