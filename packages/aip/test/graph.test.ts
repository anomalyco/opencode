import { describe, expect, test } from "bun:test"
import { createOntology } from "../src/objects.ts"
import { obj } from "../src/ontology.ts"
import { describeSubgraph, expand, incoming, neighbors, subgraph, traverse } from "../src/graph.ts"

function fixture() {
  const o = createOntology()
  o.upsert(obj("Session", "s1", { title: "root" }))
    .upsert(obj("Session", "s2", { title: "child" }))
    .upsert(obj("Agent", "a1", { name: "build" }))
    .upsert(obj("Skill", "k1", { name: "git-commit" }))
    .upsert(obj("Tool", "t1", { name: "bash" }))
    .link("runs", "s1", "a1")
    .link("has-skill", "a1", "k1")
    .link("has-tool", "a1", "t1")
    .link("spawns", "s1", "s2")
  return o
}

describe("graph", () => {
  test("neighbors filters by link type", () => {
    const o = fixture()
    expect(neighbors(o, "a1", "has-skill").map((x) => x.id)).toEqual(["k1"])
    expect(neighbors(o, "a1").map((x) => x.id).sort()).toEqual(["k1", "t1"])
  })

  test("incoming finds parents", () => {
    const o = fixture()
    expect(incoming(o, "a1", "runs").map((x) => x.id)).toEqual(["s1"])
  })

  test("traverse follows a link-type chain", () => {
    const o = fixture()
    // Session -runs-> Agent -has-skill-> Skill
    expect(traverse(o, "s1", ["runs", "has-skill"]).map((x) => x.id)).toEqual(["k1"])
  })

  test("subgraph induces over an id set", () => {
    const o = fixture()
    const g = subgraph(o, ["s1", "a1"])
    expect(g.objects.map((x) => x.id).sort()).toEqual(["a1", "s1"])
    expect(g.links).toEqual([{ type: "runs", from: "s1", to: "a1" }])
  })

  test("expand does a bounded BFS in both directions", () => {
    const o = fixture()
    const g = expand(o, "s1", 2)
    // s1 -> a1 -> {k1,t1}, s1 -> s2
    expect(g.objects.map((x) => x.id).sort()).toEqual(["a1", "k1", "s1", "s2", "t1"])
  })

  test("describeSubgraph renders objects and links", () => {
    const o = fixture()
    const text = describeSubgraph(expand(o, "s1", 1))
    expect(text).toContain("Session s1")
    expect(text).toContain("s1 —runs→ a1")
  })
})
