import { expect, test } from "bun:test"
import type { Protocol } from "devtools-protocol"
import { accessibilitySnapshot } from "./snapshot"

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
  expect(page.content.length).toBeLessThanOrEqual(100_000)
  expect(page.content).toEndWith('"')
  expect(page.content).not.toContain(' 1999"')
  const match = await accessibilitySnapshot(tree, { ...setup, text: " 1999" })
  expect(match.truncated).toBe(false)
  expect([...match.refs.values()]).toEqual([2000])
})
