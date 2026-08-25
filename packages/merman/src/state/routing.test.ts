import { describe, expect, test } from "bun:test"
import { diagramTextWidth } from "../core/text.js"
import type { StateDiagramBoxBounds } from "./layout.js"
import { createStateDiagramLayout } from "./layout.js"
import { parseMermaidStateDiagram } from "./parser.js"
import {
  createStateTransitionJunctionPlans,
  createStateTransitionRenderPlans,
  createStateTransitionRoutePlans,
} from "./routing.js"
import type { StateVisibleDiagram } from "./visible-model.js"
import { prepareVisibleStateDiagram } from "./visible-model.js"

function bounds(id: string, centerX: number, centerY: number): StateDiagramBoxBounds {
  return { id, left: centerX - 2, top: centerY - 1, width: 5, height: 3, centerX, centerY }
}

describe("createStateTransitionRoutePlans", () => {
  test("classifies horizontal transition behavior before painting", () => {
    const diagram: StateVisibleDiagram = {
      direction: "LR",
      states: ["A", "B", "C"].map((id) => ({ id, label: id, kind: "state" })),
      transitions: [
        { from: "A", to: "B", label: "forward" },
        { from: "B", to: "C", label: "branch" },
        { from: "C", to: "A", label: "reset" },
        { from: "B", to: "B", label: "retry" },
      ],
      composites: [],
      notes: [],
    }
    const placements = new Map([
      ["A", bounds("A", 4, 4)],
      ["B", bounds("B", 14, 4)],
      ["C", bounds("C", 24, 10)],
    ])

    const plans = createStateTransitionRoutePlans(diagram, placements, 18)

    expect(plans.map((plan) => [plan.transition.label, plan.kind])).toEqual([
      ["forward", "horizontal-forward"],
      ["branch", "vertical-elbow"],
      ["reset", "bottom-feedback"],
      ["retry", "self"],
    ])
    expect(plans.find((plan) => plan.kind === "bottom-feedback")).toMatchObject({ railY: 18 })
  })

  test("classifies vertical self-transitions as loops before directional routing", () => {
    const diagram: StateVisibleDiagram = {
      direction: "TB",
      states: [{ id: "Working", label: "Working", kind: "state" }],
      transitions: [{ from: "Working", to: "Working", label: "retry" }],
      composites: [],
      notes: [],
    }

    expect(
      createStateTransitionRoutePlans(diagram, new Map([["Working", bounds("Working", 5, 3)]]), 12)[0],
    ).toMatchObject({
      kind: "self",
    })
  })

  test("allocates separate lanes for parallel transitions", () => {
    const horizontal: StateVisibleDiagram = {
      direction: "LR",
      states: ["A", "B"].map((id) => ({ id, label: id, kind: "state" })),
      transitions: [
        { from: "A", to: "B", label: "first" },
        { from: "A", to: "B", label: "second" },
      ],
      composites: [],
      notes: [],
    }
    const vertical = { ...horizontal, direction: "TB" as const }
    const placements = new Map([
      ["A", bounds("A", 4, 4)],
      ["B", bounds("B", 18, 4)],
    ])
    const verticalPlacements = new Map([
      ["A", bounds("A", 4, 4)],
      ["B", bounds("B", 4, 14)],
    ])

    expect(createStateTransitionRoutePlans(horizontal, placements, 12).map((plan) => plan.kind)).toEqual([
      "horizontal-forward",
      "bottom-parallel",
    ])
    expect(createStateTransitionRoutePlans(vertical, verticalPlacements, 22).map((plan) => plan.kind)).toEqual([
      "vertical",
      "side-parallel",
    ])
  })

  test("uses a bottom lane for same-rank parallel transitions in vertical diagrams", () => {
    const diagram: StateVisibleDiagram = {
      direction: "TB",
      states: ["A", "B"].map((id) => ({ id, label: id, kind: "state" })),
      transitions: [
        { from: "A", to: "B", label: "first" },
        { from: "A", to: "B", label: "second" },
      ],
      composites: [],
      notes: [],
    }
    const placements = new Map([
      ["A", bounds("A", 4, 4)],
      ["B", bounds("B", 18, 4)],
    ])

    expect(createStateTransitionRoutePlans(diagram, placements, 12).map((plan) => plan.kind)).toEqual([
      "horizontal-forward",
      "bottom-parallel",
    ])
  })

  test("routes interleaving independent feedback transitions on opposite sides", () => {
    const diagram: StateVisibleDiagram = {
      direction: "LR",
      states: ["A", "B", "C", "D"].map((id) => ({ id, label: id, kind: "state" })),
      transitions: [
        { from: "A", to: "B", label: "advance" },
        { from: "B", to: "C", label: "continue" },
        { from: "C", to: "D", label: "finish" },
        { from: "C", to: "A", label: "reset A" },
        { from: "D", to: "B", label: "reset B" },
      ],
      composites: [],
      notes: [],
    }
    const placements = new Map([
      ["A", bounds("A", 4, 4)],
      ["B", bounds("B", 14, 4)],
      ["C", bounds("C", 24, 4)],
      ["D", bounds("D", 34, 4)],
    ])
    const plans = createStateTransitionRenderPlans(diagram, placements, 12).filter((plan) =>
      plan.route.transition.label.startsWith("reset"),
    )

    expect(plans.map((plan) => plan.route.kind)).toEqual(["bottom-feedback", "top-feedback"])
    const firstCells = new Set(plans[0]!.path.map(([x, y]) => `${x}:${y}`))
    expect(plans[1]!.path.some(([x, y]) => firstCells.has(`${x}:${y}`))).toBe(false)
  })

  test("routes nested same-side feedback transitions from inner to outer rails", () => {
    const diagram: StateVisibleDiagram = {
      direction: "LR",
      states: ["A", "B", "C", "D"].map((id) => ({ id, label: id, kind: "state" })),
      transitions: [
        { from: "D", to: "A", label: "outer" },
        { from: "C", to: "B", label: "inner" },
      ],
      composites: [],
      notes: [],
    }
    const placements = new Map([
      ["A", bounds("A", 4, 4)],
      ["B", bounds("B", 14, 4)],
      ["C", bounds("C", 24, 4)],
      ["D", bounds("D", 34, 4)],
    ])
    const plans = createStateTransitionRenderPlans(diagram, placements, 12)
    const outer = plans.find((plan) => plan.route.transition.label === "outer")!
    const inner = plans.find((plan) => plan.route.transition.label === "inner")!
    const outerCells = new Set(outer.path.map(([x, y]) => `${x}:${y}`))

    expect(outer.route).toMatchObject({ kind: "bottom-feedback", railY: 15 })
    expect(inner.route).toMatchObject({ kind: "bottom-feedback", railY: 12 })
    expect(inner.path.some(([x, y]) => outerCells.has(`${x}:${y}`))).toBe(false)
  })

  test("allocates duplicate feedback transitions without crossing an independent feedback path", () => {
    const diagram: StateVisibleDiagram = {
      direction: "LR",
      states: ["A", "B", "C", "D"].map((id) => ({ id, label: id, kind: "state" })),
      transitions: [
        { from: "C", to: "A", label: "ca" },
        { from: "D", to: "B", label: "db1" },
        { from: "D", to: "B", label: "db2" },
      ],
      composites: [],
      notes: [],
    }
    const placements = new Map([
      ["A", bounds("A", 4, 4)],
      ["B", bounds("B", 14, 4)],
      ["C", bounds("C", 24, 4)],
      ["D", bounds("D", 34, 4)],
    ])
    const plans = createStateTransitionRenderPlans(diagram, placements, 12)
    const independent = plans.find((plan) => plan.route.transition.label === "ca")!
    const independentCells = new Set(independent.path.map(([x, y]) => `${x}:${y}`))
    const duplicates = plans.filter((plan) => plan.route.transition.label.startsWith("db"))

    expect(duplicates.map((plan) => plan.route.kind)).toEqual(["top-feedback", "top-feedback"])
    expect(duplicates.every((plan) => plan.path.every(([x, y]) => !independentCells.has(`${x}:${y}`)))).toBe(true)
  })
})

describe("createStateTransitionRenderPlans", () => {
  test("prepares concrete cells, labels, and route paths before painting", () => {
    const diagram: StateVisibleDiagram = {
      direction: "LR",
      states: ["A", "B"].map((id) => ({ id, label: id, kind: "state" })),
      transitions: [{ from: "A", to: "B", label: "next" }],
      composites: [],
      notes: [],
    }
    const placements = new Map([
      ["A", bounds("A", 4, 4)],
      ["B", bounds("B", 14, 4)],
    ])

    const plan = createStateTransitionRenderPlans(diagram, placements, 18)[0]!

    expect(plan.cells).toEqual([
      { x: 6, y: 4, char: "├" },
      { x: 7, y: 4, char: "─" },
      { x: 8, y: 4, char: "─" },
      { x: 9, y: 4, char: "─" },
      { x: 10, y: 4, char: "─" },
      { x: 11, y: 4, arrowDirection: "right" },
    ])
    expect(plan.label).toEqual({ x: 8, y: 3, lines: ["next"] })
    expect(plan.path).toEqual([
      [6, 4],
      [7, 4],
      [8, 4],
      [9, 4],
      [10, 4],
      [11, 4],
    ])
  })

  test("keeps vertical branch routes out of unrelated state bounds", () => {
    const diagram = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  direction TB
  state "Branch root" as Root
  state "Upper branch" as Upper
  state "Lower branch" as Lower
  state "Merged branch" as Merge
  Root --> Upper: branch-up
  Root --> Lower: branch-down
  Upper --> Merge: merge-up
  Lower --> Merge: merge-down
  Merge --> Root: branch-feedback`),
    )
    const layout = createStateDiagramLayout(diagram, { minStateGap: 4 })
    const plans = createStateTransitionRenderPlans(diagram, layout.bounds, 30)

    for (const plan of plans) {
      const unrelated = diagram.states
        .filter((state) => state.id !== plan.route.transition.from && state.id !== plan.route.transition.to)
        .map((state) => layout.bounds.get(state.id)!)
      expect(
        plan.path.some(([x, y]) =>
          unrelated.some(
            (bound) =>
              x >= bound.left && x < bound.left + bound.width && y >= bound.top && y < bound.top + bound.height,
          ),
        ),
        `${plan.route.transition.from} -> ${plan.route.transition.to}`,
      ).toBe(false)
    }
  })

  test("keeps vertical feedback routes out of compact sibling state bounds", () => {
    const diagram = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  direction TB
  [*] --> Root
  Root --> A
  Root --> B
  A --> Merge
  B --> Merge
  Merge --> A: retry`),
    )
    const layout = createStateDiagramLayout(diagram, { minStateGap: 12 })
    const plan = createStateTransitionRenderPlans(diagram, layout.bounds, 30).find(
      (plan) => plan.route.transition.label === "retry",
    )!
    const sibling = layout.bounds.get("B")!

    expect(
      plan.path.some(
        ([x, y]) =>
          x >= sibling.left && x < sibling.left + sibling.width && y >= sibling.top && y < sibling.top + sibling.height,
      ),
    ).toBe(false)
  })

  test("keeps every dense vertical fan route out of unrelated state bounds", () => {
    const diagram = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  direction TB
  state "Alpha" as A
  state "Beta" as B
  state "Gamma store" as C
  state "Delta notifier" as D
  A --> B
  A --> C
  A --> D
  B --> A: back
  B --> D: across`),
    )
    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const plans = createStateTransitionRenderPlans(diagram, layout.bounds, 30)

    for (const plan of plans) {
      const unrelated = diagram.states
        .filter((state) => state.id !== plan.route.transition.from && state.id !== plan.route.transition.to)
        .map((state) => layout.bounds.get(state.id)!)
      expect(
        plan.path.some(([x, y]) =>
          unrelated.some(
            (bound) =>
              x >= bound.left && x < bound.left + bound.width && y >= bound.top && y < bound.top + bound.height,
          ),
        ),
        `${plan.route.transition.from} -> ${plan.route.transition.to}`,
      ).toBe(false)
    }
  })

  test("keeps routes to offset end markers continuous", () => {
    const diagram = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  [*] --> Pending
  Pending --> Running
  Running --> Idle
  Running --> Interrupted
  Interrupted --> [*]`),
    )
    const layout = createStateDiagramLayout(diagram, { minStateGap: 12 })
    const plan = createStateTransitionRenderPlans(diagram, layout.bounds, 30).find(
      (plan) => plan.route.transition.to === "__end",
    )!

    expect(
      plan.path.slice(1).every(([x, y], index) => {
        const previous = plan.path[index]!
        return Math.abs(x - previous[0]) + Math.abs(y - previous[1]) === 1
      }),
    ).toBe(true)
  })

  test.each(["LR", "RL", "TB", "TD"] as const)(
    "keeps endpoint-disjoint %s transitions on separate cells when a detour exists",
    (direction) => {
      const diagram = prepareVisibleStateDiagram(
        parseMermaidStateDiagram(`stateDiagram-v2
  direction ${direction}
  state "A" as A
  state "B" as B
  state "C" as C
  state "D" as D
  B --> D: e0
  C --> A: e1`),
      )
      const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
      const plans = createStateTransitionRenderPlans(diagram, layout.bounds, 30)
      const first = new Set(plans[0]!.path.map(([x, y]) => `${x}:${y}`))

      expect(plans[1]!.path.every(([x, y]) => !first.has(`${x}:${y}`))).toBe(true)
    },
  )

  test("anchors labels to final repaired transition geometry", () => {
    const diagram = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  direction TB
  state "A" as A
  state "B" as B
  state "C" as C
  A --> B: e0
  A --> C: e1
  B --> A: e2`),
    )
    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const plan = createStateTransitionRenderPlans(diagram, layout.bounds, 30).find(
      (candidate) => candidate.route.transition.label === "e2",
    )!
    const width = Math.max(...plan.label!.lines.map(diagramTextWidth))
    const distance = Math.min(
      ...plan.path.map(([pathX, pathY]) => {
        const dx =
          pathX < plan.label!.x
            ? plan.label!.x - pathX
            : pathX >= plan.label!.x + width
              ? pathX - (plan.label!.x + width - 1)
              : 0
        const dy =
          pathY < plan.label!.y
            ? plan.label!.y - pathY
            : pathY >= plan.label!.y + plan.label!.lines.length
              ? pathY - (plan.label!.y + plan.label!.lines.length - 1)
              : 0
        return dx + dy
      }),
    )

    expect(plan.pathRepaired).toBe(true)
    expect(distance).toBeLessThanOrEqual(4)
  })

  test.each(["LR", "RL", "TB", "TD"] as const)(
    "allocates distinct connected self-transition lanes in %s diagrams",
    (direction) => {
      for (const count of [2, 3, 4]) {
        const diagram = prepareVisibleStateDiagram(
          parseMermaidStateDiagram(`stateDiagram-v2
  direction ${direction}
${Array.from({ length: count }, (_, index) => `  A --> A: loop-${index}`).join("\n")}`),
        )
        const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
        const plans = createStateTransitionRenderPlans(diagram, layout.bounds, 30)

        expect(new Set(plans.map((plan) => plan.path.map(([x, y]) => `${x}:${y}`).join("|"))).size).toBe(count)
        for (const plan of plans) {
          expect(
            plan.path.slice(1).every(([x, y], index) => {
              const previous = plan.path[index]!
              return Math.abs(x - previous[0]) + Math.abs(y - previous[1]) === 1
            }),
          ).toBe(true)
        }
      }
    },
  )

  test("uses fixed-width side lanes for long parallel vertical labels", () => {
    const diagram = prepareVisibleStateDiagram(
      parseMermaidStateDiagram(`stateDiagram-v2
  direction TB
  A --> B: alpha route label that is deliberately long
  A --> B: beta route label that is deliberately long
  A --> B: gamma route label that is deliberately long`),
    )
    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const rails = createStateTransitionRoutePlans(diagram, layout.bounds, 30)
      .filter((plan) => plan.kind === "side-parallel")
      .map((plan) => plan.railX)

    expect(rails).toHaveLength(2)
    expect(rails[1]! - rails[0]!).toBe(3)
  })

  test.each([
    [
      "parallel",
      `stateDiagram-v2
  direction TB
  A --> B: alpha route label that is deliberately long
  A --> B: beta route label that is deliberately long
  A --> B: gamma route label that is deliberately long`,
      3,
    ],
    [
      "self",
      `stateDiagram-v2
  direction LR
  A --> A: one
  A --> A: two
  A --> A: three`,
      3,
    ],
  ] as const)("keeps %s labels one column clear of frames and route rails", (_, source, count) => {
    const diagram = prepareVisibleStateDiagram(parseMermaidStateDiagram(source))
    const layout = createStateDiagramLayout(diagram, { minStateGap: 5 })
    const plans = createStateTransitionRenderPlans(diagram, layout.bounds, 30)
    const routeCells = plans.flatMap((plan) => plan.path)

    expect(plans).toHaveLength(count)
    for (const plan of plans) {
      const width = Math.max(...plan.label!.lines.map(diagramTextWidth))
      for (const [row, line] of plan.label!.lines.entries()) {
        const lineWidth = diagramTextWidth(line)
        const y = plan.label!.y + row
        expect(
          routeCells
            .filter(([, routeY]) => routeY === y)
            .every(([routeX]) => routeX < plan.label!.x - 1 || routeX > plan.label!.x + lineWidth),
        ).toBe(true)
        for (const bound of layout.bounds.values()) {
          if (y < bound.top || y >= bound.top + bound.height) continue
          expect(bound.left + bound.width <= plan.label!.x - 1 || bound.left >= plan.label!.x + width + 1).toBe(true)
        }
      }
    }

    if (source.includes("A --> A")) {
      const arrowXs = plans
        .flatMap((plan) => plan.cells.filter((cell) => cell.arrowDirection).map((cell) => cell.x))
        .sort((left, right) => left - right)
      expect(arrowXs.slice(1).every((x, index) => x - arrowXs[index]! >= 4)).toBe(true)
    }
  })
})

describe("createStateTransitionJunctionPlans", () => {
  test("prepares choice topology from connected transitions", () => {
    const diagram: StateVisibleDiagram = {
      direction: "LR",
      states: [
        { id: "A", label: "A", kind: "state" },
        { id: "Decision", label: "Decision", kind: "choice" },
        { id: "B", label: "B", kind: "state" },
        { id: "C", label: "C", kind: "state" },
      ],
      transitions: [
        { from: "A", to: "Decision", label: "" },
        { from: "Decision", to: "B", label: "yes" },
        { from: "Decision", to: "C", label: "no" },
      ],
      composites: [],
      notes: [],
    }
    const placements = new Map([
      ["A", bounds("A", 4, 4)],
      ["Decision", { id: "Decision", left: 14, top: 4, width: 1, height: 1, centerX: 14, centerY: 4 }],
      ["B", bounds("B", 24, 4)],
      ["C", bounds("C", 4, 10)],
    ])

    const plan = createStateTransitionJunctionPlans(
      diagram,
      placements,
      createStateTransitionRenderPlans(diagram, placements, 18),
    )[0]!

    expect(plan.kind).toBe("choice")
    expect([...plan.connections]).toEqual(["left", "right", "down"])
    expect(plan.transitions.map((transition) => transition.label)).toEqual(["", "yes", "no"])
  })

  test("derives a lower choice connection from its routed elbow approach", () => {
    const diagram: StateVisibleDiagram = {
      direction: "LR",
      states: [
        { id: "Upper", label: "Upper", kind: "state" },
        { id: "Lower", label: "Lower", kind: "state" },
        { id: "Decision", label: "Decision", kind: "choice" },
        { id: "Done", label: "Done", kind: "state" },
      ],
      transitions: [
        { from: "Upper", to: "Decision", label: "" },
        { from: "Lower", to: "Decision", label: "" },
        { from: "Decision", to: "Done", label: "" },
      ],
      composites: [],
      notes: [],
    }
    const placements = new Map([
      ["Upper", bounds("Upper", 14, 4)],
      ["Lower", bounds("Lower", 14, 11)],
      ["Decision", { ...bounds("Decision", 24, 4), left: 24, top: 4, width: 1, height: 1, centerX: 24, centerY: 4 }],
      ["Done", bounds("Done", 34, 4)],
    ])
    const renderPlans = createStateTransitionRenderPlans(diagram, placements, 18)

    const plan = createStateTransitionJunctionPlans(diagram, placements, renderPlans)[0]!

    expect([...plan.connections]).toContain("down")
  })
})

describe("reconverging vertical elbows", () => {
  test("uses separate top connectors for a lower parallel lane", () => {
    const diagram: StateVisibleDiagram = {
      direction: "LR",
      states: ["Fork", "Upper", "Lower", "Join"].map((id) => ({ id, label: id, kind: "state" })),
      transitions: [
        { from: "Fork", to: "Upper", label: "" },
        { from: "Fork", to: "Lower", label: "down" },
        { from: "Upper", to: "Join", label: "" },
        { from: "Lower", to: "Join", label: "up" },
      ],
      composites: [],
      notes: [],
    }
    const placements = new Map([
      ["Fork", bounds("Fork", 4, 4)],
      ["Upper", bounds("Upper", 14, 4)],
      ["Lower", bounds("Lower", 14, 11)],
      ["Join", bounds("Join", 24, 4)],
    ])

    const plans = createStateTransitionRenderPlans(diagram, placements, 18)
    const entering = plans.find((plan) => plan.route.transition.to === "Lower")!
    const leaving = plans.find((plan) => plan.route.transition.from === "Lower")!

    expect(entering.route).toMatchObject({ kind: "vertical-elbow", offsetConnector: true })
    expect(leaving.route).toMatchObject({ kind: "vertical-elbow", offsetConnector: true })
    expect(entering.path.at(-1)).not.toEqual(leaving.path[0])
    expect(entering.cells.at(-1)).toMatchObject({ arrowDirection: "down" })
    expect(entering.cells.at(-2)).toMatchObject({ x: entering.cells.at(-1)!.x, char: "│" })
    expect(entering.cells.at(-2)!.y).toBe(entering.cells.at(-1)!.y - 1)
    expect(entering.cells.at(-3)).toMatchObject({ x: entering.cells.at(-1)!.x, char: "╮" })
    expect(entering.cells.at(-3)!.y).toBe(entering.cells.at(-1)!.y - 2)
    const enteringHorizontalY = entering.cells.find((cell) => cell.char === "╰")!.y
    const leavingHorizontalY = leaving.cells.find((cell) => cell.char === "╭")!.y
    expect(entering.label!.y).toBeLessThan(enteringHorizontalY)
    expect(leaving.label!.y).toBeLessThan(leavingHorizontalY)
  })
})
