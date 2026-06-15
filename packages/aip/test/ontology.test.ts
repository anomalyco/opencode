import { describe, expect, test } from "bun:test"
import { createOntology } from "../src/objects.ts"
import { obj, Ontology } from "../src/ontology.ts"

describe("ontology", () => {
  test("registers daemoncode object & link types", () => {
    const o = createOntology()
    expect(o.getObjectType("Session")?.titleProperty).toBe("title")
    expect(o.getObjectType("Skill")?.properties).toContain("passRate")
    expect(o.getLinkType("has-skill")).toEqual({ name: "has-skill", from: "Agent", to: "Skill" })
  })

  test("upsert rejects unknown types", () => {
    const o = new Ontology()
    expect(() => o.upsert(obj("Ghost", "x"))).toThrow(/unknown object type/)
  })

  test("link validates endpoint types", () => {
    const o = createOntology()
    o.upsert(obj("Session", "s1")).upsert(obj("Agent", "a1"))
    expect(() => o.link("runs", "s1", "a1")).not.toThrow()
    // wrong direction: Agent->Session is not a "runs" edge
    expect(() => o.link("runs", "a1", "s1")).toThrow(/expects Session->Agent/)
  })

  test("link requires existing endpoints", () => {
    const o = createOntology()
    o.upsert(obj("Session", "s1"))
    expect(() => o.link("runs", "s1", "missing")).toThrow(/missing target/)
  })

  test("setProperty returns previous value and updates", () => {
    const o = createOntology()
    o.upsert(obj("Skill", "k1", { passRate: 0.25 }))
    const prev = o.setProperty("k1", "passRate", 0.9)
    expect(prev).toBe(0.25)
    expect(o.property("k1", "passRate")).toBe(0.9)
  })

  test("objectsOfType filters", () => {
    const o = createOntology()
    o.upsert(obj("Skill", "k1")).upsert(obj("Skill", "k2")).upsert(obj("Tool", "t1"))
    expect(o.objectsOfType("Skill").map((x) => x.id).sort()).toEqual(["k1", "k2"])
  })

  test("link dedups identical edges", () => {
    const o = createOntology()
    o.upsert(obj("Session", "s1")).upsert(obj("Agent", "a1"))
    o.link("runs", "s1", "a1").link("runs", "s1", "a1")
    expect(o.allLinks().filter((l) => l.type === "runs").length).toBe(1)
  })
})
