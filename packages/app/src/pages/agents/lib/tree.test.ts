import { describe, expect, it } from "bun:test"
import { buildTree, type TreeInput } from "./tree"

const row = (sessionID: string, parentID: string | null, extra: Partial<TreeInput> = {}): TreeInput => ({
  sessionID,
  parentID,
  tin: 10,
  tout: 1,
  cost: 0.5,
  live: false,
  ...extra,
})

const ids = (nodes: { row: TreeInput; depth: number }[]) => nodes.map((n) => `${n.row.sessionID}@${n.depth}`)

describe("buildTree", () => {
  it("nests children under parents in input order", () => {
    const nodes = buildTree([row("a", null), row("b", null), row("a1", "a"), row("a2", "a"), row("a1x", "a1")], {
      collapsed: new Set(),
      match: () => true,
    })
    expect(ids(nodes)).toEqual(["a@0", "a1@1", "a1x@2", "a2@1", "b@0"])
  })

  it("rolls up tokens, cost and live across descendants", () => {
    const nodes = buildTree([row("a", null), row("a1", "a", { live: true, cost: 1 }), row("a1x", "a1", { tout: 5 })], {
      collapsed: new Set(),
      match: () => true,
    })
    const root = nodes[0]!
    expect(root.rollup).toEqual({ tin: 30, tout: 7, cost: 2, live: 1, descendants: 2 })
    expect(nodes[1]!.rollup).toEqual({ tin: 20, tout: 6, cost: 1.5, live: 1, descendants: 1 })
  })

  it("hides descendants of collapsed nodes but keeps their rollup", () => {
    const nodes = buildTree([row("a", null), row("a1", "a"), row("a1x", "a1")], {
      collapsed: new Set(["a"]),
      match: () => true,
    })
    expect(ids(nodes)).toEqual(["a@0"])
    expect(nodes[0]!.rollup.descendants).toBe(2)
    expect(nodes[0]!.collapsed).toBe(true)
  })

  it("treats orphans (missing parent) as roots", () => {
    const nodes = buildTree([row("x1", "gone"), row("a", null)], { collapsed: new Set(), match: () => true })
    expect(ids(nodes)).toEqual(["x1@0", "a@0"])
  })

  it("keeps ancestors of matching descendants and drops non-matching branches", () => {
    const nodes = buildTree([row("a", null), row("a1", "a"), row("a1x", "a1", { live: true }), row("b", null)], {
      collapsed: new Set(),
      match: (r) => r.live,
    })
    expect(ids(nodes)).toEqual(["a@0", "a1@1", "a1x@2"])
  })

  it("expands collapsed ancestors when filtering reveals a match", () => {
    const nodes = buildTree([row("a", null), row("a1", "a", { live: true })], {
      collapsed: new Set(["a"]),
      match: (r) => r.live,
    })
    expect(ids(nodes)).toEqual(["a@0", "a1@1"])
  })

  it("survives parent cycles without looping", () => {
    const nodes = buildTree([row("a", "b"), row("b", "a")], { collapsed: new Set(), match: () => true })
    expect(nodes.length).toBe(2)
  })
})
