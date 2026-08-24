import { describe, expect, test } from "bun:test"
import type { StateDiagram } from "./types.js"
import { createStateDiagramLayout } from "./layout.js"

describe("StateDiagramLayout", () => {
  test("lays out horizontal main-path states before branch states", () => {
    const diagram: StateDiagram = {
      direction: "LR",
      states: [
        { id: "A", label: "A", kind: "state" },
        { id: "B", label: "B", kind: "state" },
        { id: "C", label: "C", kind: "state" },
      ],
      transitions: [
        { from: "A", to: "B", label: "main" },
        { from: "A", to: "C", label: "branch" },
      ],
      composites: [],
      notes: [],
    }

    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const a = layout.bounds.get("A")!
    const b = layout.bounds.get("B")!
    const c = layout.bounds.get("C")!

    expect(a.left).toBeLessThan(b.left)
    expect(c.top).toBeGreaterThan(a.top)
  })

  test("aligns a reconverging side branch under the parallel main-path stage", () => {
    const diagram: StateDiagram = {
      direction: "LR",
      states: ["Fork", "Upper", "Lower", "Join"].map((id) => ({ id, label: id, kind: "state" })),
      transitions: [
        { from: "Fork", to: "Upper", label: "upper" },
        { from: "Fork", to: "Lower", label: "lower" },
        { from: "Upper", to: "Join", label: "join" },
        { from: "Lower", to: "Join", label: "join" },
      ],
      composites: [],
      notes: [],
    }

    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const upper = layout.bounds.get("Upper")!
    const lower = layout.bounds.get("Lower")!

    expect(lower.centerX).toBe(upper.centerX)
    expect(lower.top).toBeGreaterThan(upper.top)
  })

  test("places note bounds outside their target state", () => {
    const diagram: StateDiagram = {
      direction: "LR",
      states: [
        { id: "A", label: "A", kind: "state" },
        { id: "B", label: "B", kind: "state" },
      ],
      transitions: [{ from: "A", to: "B", label: "next" }],
      composites: [],
      notes: [{ target: "A", position: "right", lines: ["note"] }],
    }

    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const target = layout.bounds.get("A")!
    const note = layout.noteBounds[0]!

    expect(note.left).toBeGreaterThanOrEqual(target.left + target.width)
    expect(note.lines).toEqual(["note"])
  })

  test("widens only the horizontal gap that carries a long label", () => {
    const diagram: StateDiagram = {
      direction: "LR",
      states: [
        { id: "A", label: "A", kind: "state" },
        { id: "B", label: "B", kind: "state" },
        { id: "C", label: "C", kind: "state" },
      ],
      transitions: [
        { from: "A", to: "B", label: "a transition label requiring substantially more room" },
        { from: "B", to: "C", label: "ok" },
      ],
      composites: [],
      notes: [],
    }

    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const a = layout.bounds.get("A")!
    const b = layout.bounds.get("B")!
    const c = layout.bounds.get("C")!
    const longGap = b.left - (a.left + a.width)
    const shortGap = c.left - (b.left + b.width)

    expect(longGap).toBeGreaterThan(shortGap)
  })
})
