import { describe, expect, test } from "bun:test"
import { parseColor } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import stringWidth from "string-width"
import { blendColor, colorsEqual, DIAGRAM_FADE_STEPS } from "../core/color/style.js"
import { expectDiagram } from "../test/diagram.js"
import { drawFlowchartDiagramGrid as drawParsedFlowchartDiagramGrid } from "./drawing.js"
import {
  DEFAULT_MIN_RANK_GAP,
  DEFAULT_MIN_VERTICAL_RANK_GAP,
  layoutFlowchartDiagram as layoutParsedFlowchartDiagram,
} from "./layout.js"
import { parseMermaidFlowchartDiagram } from "./parser.js"
import { renderFlowchartDiagram, renderFlowchartDiagramAnsi } from "./render.js"
import { FlowchartDiagramRenderable } from "./renderable.js"
import { flowchartNodeColorKey, renderGridStyledText, resolveFlowchartStyleColors } from "./style.js"

function drawFlowchartDiagramGrid(content: string, options?: Parameters<typeof drawParsedFlowchartDiagramGrid>[1]) {
  return drawParsedFlowchartDiagramGrid(parseMermaidFlowchartDiagram(content), options)
}

function layoutFlowchartDiagram(content: string, options?: Parameters<typeof layoutParsedFlowchartDiagram>[1]) {
  return layoutParsedFlowchartDiagram(parseMermaidFlowchartDiagram(content), options)
}

function flowchartTextSize(content: string): { width: number; height: number } {
  return drawFlowchartDiagramGrid(content).getTextSize({ trimTop: true, trimBottom: true })
}

function routeRunsAlongHorizontalBorder(
  route: { points: readonly { x: number; y: number }[] },
  bounds: { left: number; top: number; width: number; height: number },
): boolean {
  const borderYs = new Set([bounds.top, bounds.top + bounds.height - 1])
  const left = bounds.left
  const right = bounds.left + bounds.width - 1

  for (let index = 1; index < route.points.length; index++) {
    const from = route.points[index - 1]!
    const to = route.points[index]!
    if (from.y !== to.y || !borderYs.has(from.y)) continue
    if (Math.max(from.x, to.x) >= left && Math.min(from.x, to.x) <= right) return true
  }
  return false
}

function routeRunsAlongVerticalBorder(
  route: { points: readonly { x: number; y: number }[] },
  bounds: { left: number; top: number; width: number; height: number },
): boolean {
  const borderXs = new Set([bounds.left, bounds.left + bounds.width - 1])
  const top = bounds.top
  const bottom = bounds.top + bounds.height - 1

  for (let index = 1; index < route.points.length; index++) {
    const from = route.points[index - 1]!
    const to = route.points[index]!
    if (from.x !== to.x || !borderXs.has(from.x)) continue
    if (Math.max(from.y, to.y) >= top && Math.min(from.y, to.y) <= bottom) return true
  }
  return false
}

describe("FlowchartDiagram", () => {
  test("renders compact horizontal flowcharts with shorter routes", () => {
    const output = renderFlowchartDiagram(
      `flowchart LR
  A[Idea] --> B[Parse]
  B --> C[Render]
  C --> D[Terminal]`,
      { compact: true },
    )

    expectDiagram(output).toEqualDiagram(`
      ╭──────╮    ╭───────╮    ╭────────╮    ╭──────────╮
      │ Idea ├───▶│ Parse ├───▶│ Render ├───▶│ Terminal │
      ╰──────╯    ╰───────╯    ╰────────╯    ╰──────────╯
    `)
  })

  test("renders compact vertical flowcharts with a readable arrow stem", () => {
    const output = renderFlowchartDiagram(
      `flowchart TD
  A[Start] --> B[Done]`,
      { compact: true },
    )

    expectDiagram(output).toEqualDiagram(`
      ╭───────╮
      │ Start │
      ╰───┬───╯
          │
          ▼
      ╭──────╮
      │ Done │
      ╰──────╯
    `)
  })

  test("routes compact vertical sibling subtrees from their true parents", () => {
    const output = renderFlowchartDiagram(
      `flowchart TD
  D[DEPLOYMENT - Anomaly] --> CA[ClientApps: google, github]
  D --> O[ORG acme = guild/workspace]
  O --> OG[org grant: google, authed as bot@acme.com]
  O --> M[MEMBER juliana]
  M --> UG[user grant: google, personal]`,
      { compact: true },
    )

    expectDiagram(output).toEqualDiagram(`
                               ╭──────────────────────╮
                               │ DEPLOYMENT - Anomaly │
                               ╰───────────┬──────────╯
                      ╭────────────────────╰────────────────────╮
                      ▼                                         ▼
       ╭────────────────────────────╮            ╭────────────────────────────╮
       │ ClientApps: google, github │            │ ORG acme = guild/workspace │
       ╰────────────────────────────╯            ╰──────────────┬─────────────╯
                            ╭───────────────────────────────────╰───────╮
                            ▼                                           ▼
      ╭───────────────────────────────────────────╮            ╭────────────────╮
      │ org grant: google, authed as bot@acme.com │            │ MEMBER juliana │
      ╰───────────────────────────────────────────╯            ╰────────┬───────╯
                                           ╭────────────────────────────╯
                                           ▼
                           ╭──────────────────────────────╮
                           │ user grant: google, personal │
                           ╰──────────────────────────────╯
    `)
  })

  test("routes vertical sibling subtrees from their true parents", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  D[DEPLOYMENT - Anomaly] --> CA[ClientApps: google, github]
  D --> O[ORG acme = guild/workspace]
  O --> OG[org grant: google, authed as bot@acme.com]
  O --> M[MEMBER juliana]
  M --> UG[user grant: google, personal]`)

    expectDiagram(output).toEqualDiagram(`
                               ╭──────────────────────╮
                               │ DEPLOYMENT - Anomaly │
                               ╰───────────┬──────────╯
                                           │
                      ╭────────────────────┴────────────────────╮
                      │                                         │
                      ▼                                         ▼
       ╭────────────────────────────╮            ╭────────────────────────────╮
       │ ClientApps: google, github │            │ ORG acme = guild/workspace │
       ╰────────────────────────────╯            ╰──────────────┬─────────────╯
                                                                │
                            ╭───────────────────────────────────┴───────╮
                            │                                           │
                            ▼                                           ▼
      ╭───────────────────────────────────────────╮            ╭────────────────╮
      │ org grant: google, authed as bot@acme.com │            │ MEMBER juliana │
      ╰───────────────────────────────────────────╯            ╰────────┬───────╯
                                                                        │
                                           ╭────────────────────────────╯
                                           │
                                           ▼
                           ╭──────────────────────────────╮
                           │ user grant: google, personal │
                           ╰──────────────────────────────╯
    `)
  })

  test("keeps Unicode node labels inside their measured frame", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  A[界]`)
    const widths = output.split("\n").map((line) => stringWidth(line))

    expect(new Set(widths).size).toBe(1)
    expect(output).toContain("界")
  })

  test("does not mutate a parsed diagram when laying out with a direction override", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  A --> B`)

    layoutParsedFlowchartDiagram(diagram, { direction: "RL" })

    expect(diagram.direction).toBe("LR")
  })

  test("does not draw reverse-flow arrowheads on a target's opposite side", () => {
    const content = `flowchart RL
  Parser[Parser] --> Output[Rendered]`
    const output = renderFlowchartDiagram(content)
    const layout = layoutFlowchartDiagram(content)
    const outputBounds = layout.bounds.get("Output")!
    const renderedRow = output.split("\n").find((line) => line.includes("Rendered"))!

    const horizontalRoute = layout.routes.find((route) => route.edge.from === "Parser" && route.edge.to === "Output")!
    expect(horizontalRoute.points.at(-1)?.x).toBe(outputBounds.left + outputBounds.width)
    expect(renderedRow).toContain("│ Rendered │◀")
    expect(renderedRow.trimStart().startsWith("◀")).toBe(false)
  })

  test("preserves arrowheads for horizontal cycles", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  A[A] --> B[B]
  B --> A`)

    expectDiagram(output).toEqualDiagram(`
        ╭──────────────╮
        │              │
        │              │
        ▼              │
      ╭───╮          ╭─┴─╮
      │ A ├─────────▶│ B │
      ╰───╯          ╰───╯
    `)
  })

  test("renders parallel same-endpoint edges without losing labels", () => {
    const content = `flowchart LR
  A[Source] -->|first| B[Target]
  A -->|second| B`
    const output = renderFlowchartDiagram(content)
    const active = drawParsedFlowchartDiagramGrid(parseMermaidFlowchartDiagram(content), {
      activeEdge: { from: "A", to: "B", index: 0 },
    }).toString({ trimTop: true, trimBottom: true })

    expect(output).toContain("first")
    expect(output).toContain("second")
    expect(output.match(/▶/g)).toHaveLength(1)
    expect(output.match(/▲/g)).toHaveLength(1)
    expect(active).not.toContain("firstd")
  })

  test("keeps three parallel multiline edges legible in both orientations", () => {
    const horizontal = renderFlowchartDiagram(`flowchart LR
  A[Source] -->|first 1<br/>first 2<br/>first 3<br/>first 4| B[Target]
  A -->|second 1<br/>second 2<br/>second 3<br/>second 4| B
  A -->|third 1<br/>third 2<br/>third 3<br/>third 4| B`)
    const vertical = renderFlowchartDiagram(`flowchart TD
  A[Source] -->|first lane<br/>first two| B[Target]
  A -->|second lane<br/>second two| B
  A -->|third lane<br/>third two| B`)

    for (const label of ["second 1", "second 2", "second 3", "second 4", "third 1", "third 2"]) {
      expect(horizontal).toContain(label)
    }
    for (const label of ["first lane", "first two", "second lane", "second two", "third lane", "third two"]) {
      expect(vertical).toContain(label)
    }
  })

  test("keeps transitive targets below intermediate vertical stages", () => {
    const content = `flowchart TD
  A[Start] --> B[Validate]
  B --> C[Publish]
  A --> C`
    const layout = layoutFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(layout.bounds.get("C")!.top).toBeGreaterThan(layout.bounds.get("B")!.top)
    expect(output.match(/[▼◀]/g)).toHaveLength(3)
  })

  test("routes transitive horizontal shortcuts around intermediate stages", () => {
    const content = `flowchart LR
  A[Start] --> B[Validate]
  B --> C[Publish]
  A --> C`
    const layout = layoutFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(layout.bounds.get("C")!.left).toBeGreaterThan(layout.bounds.get("B")!.left)
    expect(output.match(/[▶▼]/g)).toHaveLength(3)
  })

  test("folds oversized horizontal activity pipelines into a readable vertical layout", () => {
    const output = renderFlowchartDiagram(
      `flowchart LR
  C[ReceiveInput] --> P[Persist ActivityRequested]
  P --> S[Self RunPendingActivity]
  S --> O[OpenCode async task]
  O --> M[Self OutputObserved]
  M --> E[Persist OutputObserved]`,
      { layoutMaxWidth: 120 },
    )

    expectDiagram(output).toEqualDiagram(`
            ╭──────────────╮
            │ ReceiveInput │
            ╰───────┬──────╯
                    │
                    │
                    │
                    ▼
      ╭───────────────────────────╮
      │ Persist ActivityRequested │
      ╰─────────────┬─────────────╯
                    │
                    │
                    │
                    ▼
       ╭─────────────────────────╮
       │ Self RunPendingActivity │
       ╰────────────┬────────────╯
                    │
                    │
                    │
                    ▼
         ╭─────────────────────╮
         │ OpenCode async task │
         ╰──────────┬──────────╯
                    │
                    │
                    │
                    ▼
         ╭─────────────────────╮
         │ Self OutputObserved │
         ╰──────────┬──────────╯
                    │
                    │
                    │
                    ▼
       ╭────────────────────────╮
       │ Persist OutputObserved │
       ╰────────────────────────╯
    `)
  })

  test("folds oversized horizontal feedback pipelines without losing labeled routes", () => {
    const output = renderFlowchartDiagram(
      `flowchart LR
  C[Commands] --> A[AgentThread activation]
  A -->|persist facts| J[(AgentThread journal)]
  A -->|resume / steer / abort| O[OpenCode session]
  O -->|observed output| A
  J -->|visible output requested| R[Reactor]
  R --> D[Discord]`,
      { layoutMaxWidth: 120 },
    )

    expectDiagram(output).toEqualDiagram(`
                                      ╭──────────╮
                                      │ Commands │
                                      ╰─────┬────╯
                                            │
                                            │
                                            │
                                            ▼
                               ╭────────────────────────╮
                               │ AgentThread activation │◀───── observed output ─────╮
                               ╰────────────┬───────────╯                            │
                                            │                                        │
                 ╭───── persist facts ──────┴── resume / steer / abort ──╮           │
                 │                                                       │           │
                 ▼                                                       │           │
      ╭─────────────────────╮                                            ▼           │
      ├─────────────────────┤                                  ╭──────────────────╮  │
      │ AgentThread journal │                                  │ OpenCode session ├──╯
      ├─────────────────────┤                                  ╰──────────────────╯
      ╰──────────┬──────────╯
                 │
                 ╰ visible output requested ╮
                                            │
                                            ▼
                                       ╭─────────╮
                                       │ Reactor │
                                       ╰────┬────╯
                                            │
                                            │
                                            │
                                            ▼
                                       ╭─────────╮
                                       │ Discord │
                                       ╰─────────╯
    `)
  })

  test("parses Mermaid flowchart nodes and standard arrows", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart TD
  Start([Start]):::focus --> Form[Collect Details]
  Form -->|valid| Store[(Orders DB)]:::store
  Form -- invalid --> Review(Manual Review)
  Review --> Decision{Approved?}
`)

    expect(diagram.direction).toBe("TD")
    expect(diagram.nodes).toEqual([
      { id: "Start", label: "Start", shape: "rounded" },
      { id: "Form", label: "Collect Details", shape: "box" },
      { id: "Store", label: "Orders DB", shape: "database" },
      { id: "Review", label: "Manual Review", shape: "rounded" },
      { id: "Decision", label: "Approved?", shape: "decision" },
    ])
    expect(diagram.edges).toEqual([
      { from: "Start", to: "Form", label: "" },
      { from: "Form", to: "Store", label: "valid" },
      { from: "Form", to: "Review", label: "invalid" },
      { from: "Review", to: "Decision", label: "" },
    ])
  })

  test("parses Mermaid subgraph groups", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end
  subgraph Platform
    API --> DB[(Database)]
  end
`)

    expect(diagram.subgraphs).toEqual([
      { id: "Web", label: "Web App", nodeIds: ["UI", "API"], parentId: undefined },
      { id: "Platform", label: "Platform", nodeIds: ["API", "DB"], parentId: undefined },
    ])
  })

  test("parses Mermaid subgraph-local directions", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart TD
  subgraph Verse
    direction LR
    A[A] --> B[B]
  end
`)

    expect(diagram.subgraphs).toEqual([
      { id: "Verse", label: "Verse", nodeIds: ["A", "B"], parentId: undefined, direction: "LR" },
    ])
  })

  test("parses and renders Mermaid subroutine nodes", () => {
    const content = `
flowchart LR
  Parse[[Parse]] --> Layout[Layout]
`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(diagram.nodes[0]).toEqual({ id: "Parse", label: "Parse", shape: "subroutine" })
    expectDiagram(output).toContainInOrder("╭─┬─────┬─╮", "│ │Parse│ ├", "╰─┴─────┴─╯")
  })

  test("parses and renders Mermaid thick edges", () => {
    const content = `
flowchart LR
  Build[Build] ==> Ship[Ship]
`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(diagram.edges).toEqual([{ from: "Build", to: "Ship", label: "", style: "thick" }])
    expect(output).toContain("━━━━━━━━━▶")
  })

  test("parses and renders Mermaid dashed edges", () => {
    const content = `
flowchart LR
  Build[Build] -.-> Ship[Ship]
`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(diagram.edges).toEqual([{ from: "Build", to: "Ship", label: "", style: "dashed" }])
    expect(output).toContain("─ ─ ─ ─ ─▶")
  })

  test("tracks nested Mermaid subgraphs", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart LR
  subgraph Outer
    subgraph Inner [Inner Work]
      A[A] --> B[B]
    end
    B --> C[C]
  end
`)

    expect(diagram.subgraphs).toEqual([
      { id: "Outer", label: "Outer", nodeIds: ["B", "C"], parentId: undefined },
      { id: "Inner", label: "Inner Work", nodeIds: ["A", "B"], parentId: "Outer" },
    ])
  })

  test("detects graph headers and renders a terminal flowchart", () => {
    const output = renderFlowchartDiagram(`
graph LR
  Client([Client]) --> API[API]
  API --> Cache[(Cache)]
`)

    expectDiagram(output).toEqualDiagram(`
                                           ╭───────╮
      ╭────────╮          ╭─────╮          ├───────┤
      │ Client ├─────────▶│ API ├─────────▶│ Cache │
      ╰────────╯          ╰─────╯          ├───────┤
                                           ╰───────╯
    `)
  })

  test("renders Mermaid decision diamond nodes", () => {
    const output = renderFlowchartDiagram(`
flowchart LR
  Build[Build] --> Gate{Ready?}
  Gate -->|yes| Ship([Ship])
  Gate -->|no| Fix[Fix]
`)

    expect(output).toContain("Ready?")
    expect(output).toContain("╭─╯")
    expect(output).toContain("╰─╮")
    expect(output).toContain("yes")
    expect(output).toContain("no")
    expect(output).not.toMatch(/[╱╲\\/]/)
  })

  test("pads edge labels away from corners and arrowheads", () => {
    const output = renderFlowchartDiagram(`
flowchart LR
  Gate{Ready?} -->|pass| Stage[(Stage)]
  Gate -->|notes| Notes([Notes])
`)

    expect(output).toContain(" pass ")
    expect(output).toContain(" notes ")
    expect(output).not.toContain("┌pass")
    expect(output).not.toContain("└notes")
    expect(output).not.toContain("pass─▶")
    expect(output).not.toContain("notes▶")
  })

  test("renders br-delimited edge labels on separate rows", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  A[Start] -->|first<br/>second line| B[Finish]`)

    expect(output).toContain("first")
    expect(output).toContain("second line")
    expect(output.indexOf("first")).toBeLessThan(output.indexOf("second line"))
    expect(output).not.toContain("<br")
  })

  test("keeps tall multiline branch labels out of sibling nodes", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  A[Start] -->|one<br/>two<br/>three<br/>four<br/>five| B[Upper]
  A --> C[Lower]`)
    const lines = output.split("\n")
    const labelRows = ["one", "two", "three", "four", "five"].map((line) =>
      lines.findIndex((row) => row.includes(line)),
    )
    const lowerRow = lines.findIndex((line) => line.includes("Lower"))

    expect(labelRows).toEqual([...labelRows].sort((left, right) => left - right))
    expect(lowerRow).toBeGreaterThan(labelRows.at(-1)!)
  })

  test("keeps multiline vertical edge labels above their target node", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  A[Start] -->|first<br/>second<br/>third<br/>fourth| B[Finish]`)
    const lines = output.split("\n")
    const fourthRow = lines.findIndex((line) => line.includes("fourth"))
    const finishRow = lines.findIndex((line) => line.includes("Finish"))

    expect(fourthRow).toBeGreaterThanOrEqual(0)
    expect(finishRow).toBeGreaterThan(fourthRow)
    expect(output).not.toContain("<br")
  })

  test("expands canvas for multiline back-edge labels", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  A --> B
  B -->|try<br/>again| A`)

    expect(output).toContain("try")
    expect(output).toContain("again")
    expect(output).not.toContain("<br")
  })

  test("applies active-edge styling to each multiline label row", () => {
    const grid = drawParsedFlowchartDiagramGrid(
      parseMermaidFlowchartDiagram(`flowchart LR
  A -->|first<br/>second| B`),
      { activeEdge: { from: "A", to: "B" } },
    )
    const styledText = new Map(
      grid.rows.map((row) => [
        row.map((cell) => cell.char).join(""),
        row.filter((cell) => cell.char !== " ").map((cell) => cell.style),
      ]),
    )

    for (const label of ["first", "second"]) {
      const styles = [...styledText.entries()].find(([line]) => line.includes(label))?.[1]
      expect(styles).toContain("activeEdge")
    }
  })

  test("only expands horizontal rank gaps for labeled edges", () => {
    const { bounds } = layoutFlowchartDiagram(`
flowchart LR
  Spec[Spec] --> Plan[Plan]
  Plan --> Build[Build]
  Build --> Gate{Ready?}
  Gate -->|pass| Stage[(Stage)]
`)
    const gapBetween = (fromId: string, toId: string): number => {
      const from = bounds.get(fromId)!
      const to = bounds.get(toId)!
      return to.left - (from.left + from.width)
    }

    expect(gapBetween("Spec", "Plan")).toBe(DEFAULT_MIN_RANK_GAP)
    expect(gapBetween("Plan", "Build")).toBe(DEFAULT_MIN_RANK_GAP)
    expect(gapBetween("Build", "Gate")).toBe(DEFAULT_MIN_RANK_GAP)
    expect(gapBetween("Gate", "Stage")).toBeGreaterThan(DEFAULT_MIN_RANK_GAP)
  })

  test("renders Mermaid subgraph frames", () => {
    const output = renderFlowchartDiagram(`
graph LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end
  API --> DB[(DB)]
`)

    expect(output).toContain("Web App")
    expect(output).toContain("UI")
    expect(output).toContain("API")
    expect(output).toContain("DB")
    expect(output).toContain("╭─ Web App ")
    expect(output.split("\n").find((line) => line.includes("API") && line.includes("DB"))).not.toContain("┼")
  })

  test("reserves frame rows for br-delimited subgraph labels", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  subgraph Web [API<br/>Services]
    A[Worker]
  end`)
    const lines = output.split("\n")
    const apiRow = lines.findIndex((line) => line.includes("API"))
    const servicesRow = lines.findIndex((line) => line.includes("Services"))
    const workerRow = lines.findIndex((line) => line.includes("Worker"))

    expect(apiRow).toBeGreaterThanOrEqual(0)
    expect(servicesRow).toBe(apiRow + 1)
    expect(workerRow).toBeGreaterThan(servicesRow)
    expect(output).not.toContain("<br")
  })

  test("moves multiline subgraph labels away from entering routes", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  Input --> A
  subgraph Group [Line one<br/>Line two]
    A[A] --> B[B]
  end`)
    const lines = output.split("\n")
    const lineOne = lines.findIndex((line) => line.includes("Line one"))
    const lineTwo = lines.findIndex((line) => line.includes("Line two"))
    const b = lines.findIndex((line) => line.includes("│ B │"))

    expect(lineOne).toBeGreaterThan(b)
    expect(lineTwo).toBe(lineOne + 1)
    expect(output).not.toContain("<br")
  })

  test("draws transition lines over subgraph frames without joining them", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  subgraph Verse [verse]
    direction LR
    A[A] --> B[B]
    C[C] --> D[D]
  end
  B --> Join
  D --> Join
`)
    const crossingLines = output.split("\n").filter((line) => line.includes("Join") || line.includes("├"))

    expect(output).toContain(" verse ")
    expect(crossingLines.join("\n")).not.toContain("┼")
  })

  test("lays out subgraph-local directions independently from the outer flow", () => {
    const layout = layoutFlowchartDiagram(`
flowchart TD
  Start[Start] --> A[A]
  subgraph Steps
    direction LR
    A --> B[B]
    B --> C[C]
  end
  C --> Done[Done]
`)
    const a = layout.bounds.get("A")!
    const b = layout.bounds.get("B")!
    const c = layout.bounds.get("C")!
    const done = layout.bounds.get("Done")!
    const route = layout.routes.find((candidate) => candidate.edge.from === "A" && candidate.edge.to === "B")!

    expect(a.centerY).toBe(b.centerY)
    expect(b.left).toBeGreaterThan(a.left)
    expect(c.left).toBeGreaterThan(b.left)
    expect(done.top).toBeGreaterThan(c.top)
    expect(route.points[0]!.y).toBe(route.points[route.points.length - 1]!.y)
  })

  test("compacts stacked subgraph-local direction rows", () => {
    const layout = layoutFlowchartDiagram(`
flowchart TD
  Start[Start] --> A
  subgraph First [first row]
    direction LR
    A[A] --> B[B]
  end
  B --> C
  subgraph Second [second row]
    direction LR
    C[C] --> D[D]
  end
  D --> Done[Done]
`)
    const first = layout.subgraphBounds.get("First")!
    const second = layout.subgraphBounds.get("Second")!
    const betweenRows = layout.routes.find((route) => route.edge.from === "B" && route.edge.to === "C")!

    expect(second.top).toBeGreaterThan(first.top)
    expect(second.top - (first.top + first.height)).toBeLessThanOrEqual(DEFAULT_MIN_VERTICAL_RANK_GAP)
    expect(routeRunsAlongHorizontalBorder(betweenRows, first)).toBe(false)
    expect(routeRunsAlongHorizontalBorder(betweenRows, second)).toBe(false)
  })

  test("keeps subgraph labels readable when routes enter through the frame", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Start[Start] --> Remember
  subgraph Remembering [remember to]
    direction LR
    Remember[remember to] --> Heart[Heart]
  end
`)

    expect(output).toContain(" remember to ")
    expect(output).not.toContain("rememb▼r")
  })

  test("keeps local LR branch joins compact when they feed a vertical stage", () => {
    const content = `
flowchart TD
  Start[Start] --> A
  subgraph Verse [verse]
    direction LR
    A[A]
    B[B]
    C[C]
    D[D]
    E[E]
    F[F]
    G[G]
    A --> B
    B --> C
    A --> D
    D --> E
    A --> F
    F --> G
  end
  C --> Join
  E --> Join
  G --> Join
`
    const layout = layoutFlowchartDiagram(content)
    const b = layout.bounds.get("B")!
    const c = layout.bounds.get("C")!
    const d = layout.bounds.get("D")!
    const e = layout.bounds.get("E")!
    const verse = layout.subgraphBounds.get("Verse")!
    const joinRoutes = layout.routes.filter((route) => route.edge.to === "Join")
    const output = renderFlowchartDiagram(content)

    expect(c.left).toBeGreaterThan(b.left)
    expect(e.left).toBeGreaterThan(d.left)
    expect(new Set(joinRoutes.map((route) => route.points[1]!.x)).size).toBe(1)
    expect(Math.max(...joinRoutes.flatMap((route) => route.points.map((point) => point.x)))).toBeGreaterThan(
      verse.left + verse.width,
    )
    expect(output).not.toContain("││")
  })

  test("routes transitions between local LR subgraphs outside their frames", () => {
    const layout = layoutFlowchartDiagram(`
flowchart TD
  subgraph First [first]
    direction LR
    A[A]
    B[B]
    C[C]
    A --> B
    A --> C
  end
  B --> D
  C --> D
  subgraph Second [second]
    direction LR
    D[D] --> E[E]
  end
`)
    const first = layout.subgraphBounds.get("First")!
    const second = layout.subgraphBounds.get("Second")!
    const routes = layout.routes.filter((route) => route.edge.to === "D")

    expect(routes.length).toBe(2)
    for (const route of routes) {
      expect(routeRunsAlongHorizontalBorder(route, first)).toBe(false)
      expect(routeRunsAlongVerticalBorder(route, first)).toBe(false)
      expect(routeRunsAlongHorizontalBorder(route, second)).toBe(false)
      expect(routeRunsAlongVerticalBorder(route, second)).toBe(false)
    }
  })

  test("keeps grouped fan routes orthogonal after subgraph translation", () => {
    const layout = layoutFlowchartDiagram(`
flowchart LR
  Brief([Sketch Brief]) --> Parse[Parse Mermaid]
  subgraph Plan [Diagram Plan]
    Parse --> Layout[Rank Layout]
    Parse --> Cache[(Diagram Cache)]
  end
  Layout --> Preview([Terminal Preview])
  Cache --> Preview
`)

    for (const route of layout.routes) {
      for (let index = 1; index < route.points.length; index++) {
        const from = route.points[index - 1]!
        const to = route.points[index]!
        expect(from.x === to.x || from.y === to.y).toBe(true)
      }
    }
  })

  test("moves subgraph labels away from crossing routes", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Orders --> Receipt([Receipt])
  subgraph Fulfill [Fulfillment]
    Orders[(Orders DB)]
    Receipt([Receipt])
  end
`)
    const lines = output.split("\n")
    const titleLineIndex = lines.findIndex((line) => line.includes("Fulfillment"))
    const ordersLineIndex = lines.findIndex((line) => line.includes("Orders DB"))

    expect(titleLineIndex).toBeGreaterThan(ordersLineIndex)
    expect(lines[titleLineIndex]).not.toContain("approved")
  })

  test("renders labeled vertical branches", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Input([Input]) --> Router[Route]
  Router -->|hit| Cache[(Cache)]
  Router -->|miss| Worker[Worker]
`)

    expect(output).toContain("Input")
    expect(output).toContain("Route")
    expect(output).toContain("Cache")
    expect(output).toContain("Worker")
    expect(output).toContain("hit")
    expect(output).toContain("miss")
    expect(output).toContain("▼")
  })

  test("routes branch edges without diagonal glyphs", () => {
    const output = renderFlowchartDiagram(`
graph LR
  Ticket([Ticket]) --> Triage[Auto Triage]
  Triage -->|billing| Billing[Billing Queue]
  Triage -->|bug| Bugs[(Bug Tracker)]
  Triage -->|question| Docs[Docs Reply]
  Billing --> Done([Closed])
  Bugs --> Done
  Docs --> Done
`)

    expect(output).toContain("Billing Queue")
    expect(output).toContain("Bug Tracker")
    expect(output).toContain("Docs Reply")
    expect(output).toContain("┼")
    expect(output).not.toMatch(/[▲▼]│/)
    expect(output).not.toMatch(/[╱╲\\/]/)
  })

  test("keeps vertical branch labels separated from return edges", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Cart([Cart]) --> Address[Address]
  Address --> Payment[Payment]
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Retry --> Payment
  Orders --> Receipt([Receipt])
`)

    expect(output).toContain("approved")
    expect(output).toContain("declined")
    expect(output).not.toContain("approveddeclined")
    expect(output).not.toContain("declinedapproved")
  })

  test("expands canvas to include back-edge labels", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  A --> B
  B -->|again| A
`)

    expect(output).toContain("again")
  })

  test("keeps vertical flowcharts compact with attached source connectors", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Cart([Cart]) --> Address[Address]
  Address --> Payment[Payment]
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Retry --> Payment
  Orders --> Receipt([Receipt])
`)
    const lines = output.split("\n")
    const cartConnectorLineIndex = lines.findIndex((line) => line.includes("┬"))
    const connectorColumn = [...lines[cartConnectorLineIndex]!].indexOf("┬")

    expect(lines.length).toBeLessThanOrEqual(34)
    expect([...lines[cartConnectorLineIndex + 1]!][connectorColumn]).toBe("│")
  })

  test("keeps short back-edge labels out of source nodes", () => {
    const output = renderFlowchartDiagram(`
flowchart LR
  Build[Build Services] --> Test[Integration Tests]
  Test -->|pass| Canary[Canary]
  Test -->|fail| Fix[Fix Forward]
  Fix --> Build
  Canary -->|rollback| Fix
`)
    const rollbackLine = output.split("\n").find((line) => line.includes("rollback"))

    expect(rollbackLine).toBeDefined()
    expect(rollbackLine).not.toContain("Canary")
    expect(rollbackLine).not.toContain("Fix Forward")
  })

  test("renders ANSI output with configurable styles", () => {
    const output = renderFlowchartDiagramAnsi(
      `
flowchart LR
  A --> B
`,
      { theme: { edge: "\x1b[31m" } },
    )

    expect(output).toContain("\x1b[31m")
    expect(output).toContain("▶")
    expect(output.endsWith("\n")).toBe(false)
  })

  test("renders subgraph frames with group styling", () => {
    const output = renderFlowchartDiagramAnsi(
      `
flowchart LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end
`,
      { theme: { group: "\x1b[2m", edge: "\x1b[31m" } },
    )

    expect(output).toContain("\x1b[2m")
    expect(output).toContain("Web App")
  })

  test("renders active flowchart nodes and selected connections", () => {
    const output = renderFlowchartDiagramAnsi(
      `
flowchart LR
  A[A] --> B[B]
`,
      {
        activeNode: "A",
        activeEdge: { from: "A", to: "B" },
        theme: { activeNode: "[active-node]", activeEdge: "[active-edge]" },
      },
    )

    expect(output).toContain("[active-node]")
    expect(output).toContain("[active-edge]")
  })

  test("styles idle active flowchart edges without changing route geometry", () => {
    const content = `
flowchart TD
  A[A] --> B[B]
  A --> C[C]
`

    expect(renderFlowchartDiagram(content, { activeEdge: { from: "A", to: "B" } })).toBe(
      renderFlowchartDiagram(content),
    )
  })

  test("styles active flowchart junctions and node connectors", () => {
    const grid = drawFlowchartDiagramGrid(
      `
flowchart TD
  A[A] --> B[B]
  A --> C[C]
`,
      { activeEdge: { from: "A", to: "B" } },
    )
    const cells = grid.rows.flat()

    expect(cells.some((cell) => cell.char === "┬" && cell.style === "activeEdge")).toBe(true)
    expect(cells.some((cell) => cell.char === "┴" && cell.style === "activeEdge")).toBe(true)
  })

  test("applies flowchart node foreground and background color maps", () => {
    const grid = drawFlowchartDiagramGrid("flowchart LR\n  A[Alpha] --> B[Beta]")
    const fg = parseColor("#ff0000")
    const bg = parseColor("#001122")
    const styled = renderGridStyledText(
      grid,
      resolveFlowchartStyleColors(),
      new Map([["A", fg]]),
      new Map([[flowchartNodeColorKey("A", 1), bg]]),
    )

    expect(styled.chunks.some((chunk) => chunk.text === "A" && colorsEqual(chunk.fg, fg))).toBe(true)
    expect(styled.chunks.some((chunk) => colorsEqual(chunk.bg, bg))).toBe(true)
  })

  test("navigates selected flowchart connections from the renderable", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 12 })
    const diagram = new FlowchartDiagramRenderable(renderer, {
      content: `flowchart LR
  A[A] --> B[B]
  A --> C[C]
  B --> D[D]`,
    })

    expect(diagram.activateFirstNode()).toBe("A")
    expect(diagram.selectedConnection).toEqual({ from: "A", to: "B", index: 0 })
    expect(diagram.selectNextConnection()).toEqual({ from: "A", to: "C", index: 1 })
    const traversed = diagram.selectedConnection
    expect(diagram.followSelectedConnection()).toBe("C")
    expect(diagram.activeNode).toBe("C")
    expect(diagram.selectedConnection).toBeUndefined()
    diagram.activeEdge = traversed
    expect(diagram.activeEdge).toEqual({ from: "A", to: "C", index: 1 })
    diagram.activeEdge = undefined

    diagram.content = "flowchart LR\n  X[X] --> Y[Y]"
    expect(diagram.activeNode).toBeUndefined()
    expect(diagram.activateFirstNode()).toBe("X")

    renderer.destroy()
  })

  test("applies and updates renderable layoutMaxWidth", async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 240, height: 40 })
    const diagram = new FlowchartDiagramRenderable(renderer, {
      content: `flowchart LR
  C[ReceiveInput] --> P[Persist ActivityRequested]
  P --> S[Self RunPendingActivity]
  S --> O[OpenCode async task]
  O --> M[Self OutputObserved]
  M --> E[Persist OutputObserved]`,
      layoutMaxWidth: 120,
    })

    renderer.root.add(diagram)
    await renderOnce()
    expect(diagram.layoutMaxWidth).toBe(120)
    const foldedWidth = diagram.renderedWidth

    diagram.layoutMaxWidth = undefined
    await renderOnce()
    expect(diagram.layoutMaxWidth).toBeUndefined()
    expect(diagram.renderedWidth).toBeGreaterThan(foldedWidth)

    renderer.destroy()
  })

  test("applies renderable group color separately from edges", async () => {
    const { renderer, renderOnce, captureSpans } = await createTestRenderer({
      width: 80,
      height: 12,
    })
    const groupColor = parseColor("#123456")
    const edgeColor = parseColor("#abcdef")
    const diagram = new FlowchartDiagramRenderable(renderer, {
      id: "flowchart-group-style",
      content: `flowchart LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end`,
      groupColor,
      edgeColor,
    })

    renderer.root.add(diagram)
    await renderOnce()

    const frame = captureSpans()
    const groupLabel = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("Web App"))
    const edge = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("▶"))
    expect(groupLabel?.fg.equals(groupColor)).toBe(true)
    expect(edge?.fg.equals(edgeColor)).toBe(true)

    renderer.destroy()
  })

  test("updates renderable content and colors", async () => {
    const { renderer, renderOnce, captureCharFrame, captureSpans } = await createTestRenderer({
      width: 60,
      height: 16,
    })
    const initialContent = "flowchart LR\n  A --> B"
    const diagram = new FlowchartDiagramRenderable(renderer, {
      id: "flowchart",
      content: initialContent,
      nodeColor: "#ff0000",
    })
    const initialSize = flowchartTextSize(initialContent)

    expect({ width: diagram.renderedWidth, height: diagram.renderedHeight }).toEqual(initialSize)
    expect(diagram.scrollHeight).toBe(initialSize.height)

    renderer.root.add(diagram)
    await renderOnce()
    expect(captureCharFrame()).toContain("A")

    const updatedContent = "flowchart LR\n  A --> C"
    diagram.content = updatedContent
    const nodeColor = parseColor("#00ff00")
    const edgeColor = parseColor("#0000ff")
    diagram.nodeColor = nodeColor
    diagram.edgeColor = edgeColor
    expect({ width: diagram.renderedWidth, height: diagram.renderedHeight }).toEqual(flowchartTextSize(updatedContent))
    await renderOnce()

    expect(captureCharFrame()).toContain("C")
    const frame = captureSpans()
    const sourceConnector = frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes("├"))
    expect(frame.lines.some((line) => line.spans.some((span) => span.fg.equals(parseColor("#00ff00"))))).toBe(true)
    expect(sourceConnector?.fg.equals(blendColor(nodeColor, edgeColor, 1 / (DIAGRAM_FADE_STEPS.length + 1)))).toBe(true)
    expect(sourceConnector?.fg.equals(edgeColor)).toBe(false)

    renderer.destroy()
  })
})
