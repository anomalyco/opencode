import { describe, expect, test } from "bun:test"
import { spatialPathClaim } from "../core/spatial.js"
import { diagramTextWidth } from "../core/text.js"
import type { StateDiagram } from "./types.js"
import { createStateDiagramLayout, expandCompositeBoundsForInternalTransitions } from "./layout.js"
import { stateDiagramNoteConnector } from "./note.js"
import { parseMermaidStateDiagram } from "./parser.js"
import { createStateTransitionRenderPlans } from "./routing.js"
import { prepareVisibleStateDiagram } from "./visible-model.js"

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

  test("reserves notes and connectors from final transition geometry", () => {
    const diagram = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  direction LR
  A --> B: advance
  B --> C: continue
  note right of B: first note
  note right of B: second note
  note left of C: left note`),
    )
    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const plans = createStateTransitionRenderPlans(diagram, layout.bounds, 30, { noteBounds: layout.noteBounds })
    const occupiedByNote = layout.noteBounds.map((noteBound) => {
      const target = layout.bounds.get(noteBound.note.target)!
      const connector = spatialPathClaim(
        `connector:${noteBound.id}`,
        `connector:${noteBound.id}`,
        "boundary",
        stateDiagramNoteConnector(noteBound, target).points,
      )
      return new Set([
        ...Array.from({ length: noteBound.height }, (_, dy) =>
          Array.from({ length: noteBound.width }, (_, dx) => `${noteBound.left + dx}:${noteBound.top + dy}`),
        ).flat(),
        ...connector.spans.flatMap((span) =>
          Array.from({ length: span.toX - span.fromX + 1 }, (_, dx) => `${span.fromX + dx}:${span.y}`),
        ),
      ])
    })

    for (const [index, occupied] of occupiedByNote.entries()) {
      for (const other of occupiedByNote.slice(index + 1)) {
        expect([...occupied].some((cell) => other.has(cell))).toBe(false)
      }
    }
    const noteCells = new Set(occupiedByNote.flatMap((occupied) => [...occupied]))
    for (const plan of plans) {
      expect(plan.path.some(([x, y]) => noteCells.has(`${x}:${y}`))).toBe(false)
      if (!plan.label) continue
      const width = Math.max(...plan.label.lines.map(diagramTextWidth))
      expect(
        plan.label.lines.some((_, dy) =>
          Array.from({ length: width }, (_, dx) => `${plan.label!.x + dx}:${plan.label!.y + dy}`).some((cell) =>
            noteCells.has(cell),
          ),
        ),
      ).toBe(false)
    }
  })

  test("finalizes nested composite bounds after transition-aware note placement", () => {
    const diagram = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  direction LR
  state Outer {
    state Inner {
      A --> B: internal route
      note right of B: nested note
    }
  }
  Outer --> Done: leave composite`),
    )
    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const note = layout.noteBounds[0]!
    const inner = layout.compositeBounds.get("Inner")!
    const outer = layout.compositeBounds.get("Outer")!
    const done = layout.bounds.get("Done")!

    for (const composite of [inner, outer]) {
      expect(note.left).toBeGreaterThan(composite.left)
      expect(note.top).toBeGreaterThan(composite.top)
      expect(note.left + note.width).toBeLessThan(composite.left + composite.width)
      expect(note.top + note.height).toBeLessThan(composite.top + composite.height)
    }
    expect(
      done.left < outer.left + outer.width &&
        done.left + done.width > outer.left &&
        done.top < outer.top + outer.height &&
        done.top + done.height > outer.top,
    ).toBe(false)

    const maxY = Math.max(...[...layout.bounds.values(), note].map((bound) => bound.top + bound.height))
    const plans = createStateTransitionRenderPlans(diagram, layout.bounds, maxY + 3, { noteBounds: layout.noteBounds })
    const noteCells = new Set(
      Array.from({ length: note.height }, (_, dy) =>
        Array.from({ length: note.width }, (_, dx) => `${note.left + dx}:${note.top + dy}`),
      ).flat(),
    )
    expect(plans.every((plan) => plan.path.every(([x, y]) => !noteCells.has(`${x}:${y}`)))).toBe(true)
  })

  test.each([
    ["LR", -1],
    ["RL", 1],
  ] as const)("keeps a reciprocal pair on the %s axis", (direction, expectedSign) => {
    const diagram = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  direction ${direction}
  A --> B: forward
  B --> A: backward`),
    )
    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const a = layout.bounds.get("A")!
    const b = layout.bounds.get("B")!

    expect(a.centerY).toBe(b.centerY)
    expect(Math.sign(a.centerX - b.centerX)).toBe(expectedSign)
  })

  test.each(["TB", "TD"] as const)(
    "contains nested internal feedback with strict margins in %s diagrams",
    (direction) => {
      const diagram = prepareVisibleStateDiagram(
        parseMermaidStateDiagram(`stateDiagram-v2
  direction ${direction}
  state Outer {
    state Inner {
      A --> B: down
      B --> A: up
      note right of B: nested note
    }
  }`),
      )
      const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
      const plans = createStateTransitionRenderPlans(diagram, layout.bounds, 30, { noteBounds: layout.noteBounds })
      expandCompositeBoundsForInternalTransitions(diagram, layout.compositeBounds, plans)
      const inner = layout.compositeBounds.get("Inner")!
      const outer = layout.compositeBounds.get("Outer")!
      const note = layout.noteBounds[0]!

      for (const composite of [inner, outer]) {
        for (const plan of plans) {
          expect(
            plan.path.every(
              ([x, y]) =>
                x > composite.left &&
                x < composite.left + composite.width - 1 &&
                y > composite.top &&
                y < composite.top + composite.height - 1,
            ),
          ).toBe(true)
        }
        expect(
          note.connector!.points.every(
            (point) =>
              point.x > composite.left &&
              point.x < composite.left + composite.width - 1 &&
              point.y > composite.top &&
              point.y < composite.top + composite.height - 1,
          ),
        ).toBe(true)
      }
      expect(new Set(note.connector!.points.map((point) => point.y))).toEqual(
        new Set([layout.bounds.get("B")!.centerY]),
      )
      expect(inner.left - outer.left).toBeGreaterThanOrEqual(2)
      expect(inner.top - outer.top).toBeGreaterThanOrEqual(2)
      expect(outer.left + outer.width - (inner.left + inner.width)).toBeGreaterThanOrEqual(2)
      expect(outer.top + outer.height - (inner.top + inner.height)).toBeGreaterThanOrEqual(2)
    },
  )
})
