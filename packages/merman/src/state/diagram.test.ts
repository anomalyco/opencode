import { describe, expect, test } from "bun:test"
import { parseColor } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import stringWidth from "string-width"
import { expectDiagram } from "../test/diagram.js"
import { renderStateDiagram, renderStateDiagramAnsi } from "./diagram.js"
import { drawStateDiagramGrid } from "./drawing.js"
import { parseMermaidStateDiagram } from "./parser.js"
import { StateDiagramRenderable } from "./renderable.js"

describe("StateDiagram", () => {
  test("detects and parses Mermaid state diagrams", () => {
    const diagram = parseMermaidStateDiagram(`
stateDiagram-v2
  %% request lifecycle
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  Loading --> Success: done
  Success --> [*]
`)

    expect(diagram.direction).toBe("LR")
    expect(diagram.states).toEqual([
      { id: "__start", label: "●", kind: "start" },
      { id: "Idle", label: "Idle", kind: "state" },
      { id: "Loading", label: "Loading", kind: "state" },
      { id: "Success", label: "Success", kind: "state" },
      { id: "__end", label: "◎", kind: "end" },
    ])
    expect(diagram.transitions).toEqual([
      { from: "__start", to: "Idle", label: "" },
      { from: "Idle", to: "Loading", label: "submit" },
      { from: "Loading", to: "Success", label: "done" },
      { from: "Success", to: "__end", label: "" },
    ])
  })

  test("parses quoted state aliases", () => {
    const diagram = parseMermaidStateDiagram(`
stateDiagram-v2
  state "Waiting<br/>for Payment" as WaitingPayment
  [*] --> WaitingPayment
`)

    expect(diagram.states).toContainEqual({
      id: "WaitingPayment",
      label: "Waiting<br/>for Payment",
      kind: "state",
    })
  })

  test("parses choice pseudo-states", () => {
    const diagram = parseMermaidStateDiagram(`
stateDiagram-v2
  [*] --> Decision
  state Decision <<choice>>
  Decision --> Accepted: yes
`)

    expect(diagram.states).toContainEqual({ id: "Decision", label: "┼", kind: "choice" })
  })

  test("parses composite states and notes", () => {
    const diagram = parseMermaidStateDiagram(`
stateDiagram-v2
  state Authenticated {
    [*] --> Idle
    Idle --> Editing: open
  }
  note right of Editing
    Draft changes
  end note
`)

    expect(diagram.composites).toContainEqual({ id: "Authenticated", label: "Authenticated" })
    expect(diagram.states).toContainEqual({
      id: "Idle",
      label: "Idle",
      kind: "state",
      parentId: "Authenticated",
    })
    expect(diagram.states).toContainEqual({
      id: "Authenticated.__start",
      label: "●",
      kind: "start",
      parentId: "Authenticated",
    })
    expect(diagram.notes).toEqual([{ target: "Editing", position: "right", lines: ["Draft changes"] }])
  })

  test("renders a horizontal state diagram", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  Loading --> Success: done
  Success --> [*]
`)

    expectDiagram(output).toEqualDiagram(`
                    ╭──────╮   submit    ╭─────────╮    done     ╭─────────╮
      ●────────────▶│ Idle ├────────────▶│ Loading ├────────────▶│ Success ├────────────▶◎
                    ╰──────╯             ╰─────────╯             ╰─────────╯
    `)
  })

  test("renders reverse horizontal direction from right to left", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  direction RL
  A --> B`)
    const labelRow = output.split("\n").find((line) => line.includes(" A ") && line.includes(" B "))!

    expect(labelRow.indexOf("B")).toBeLessThan(labelRow.indexOf("A"))
    expect(output).toContain("◀")
  })

  test("does not mutate a parsed diagram when rendering with a direction override", () => {
    const diagram = parseMermaidStateDiagram(`stateDiagram-v2
  direction LR
  A --> B`)

    drawStateDiagramGrid(diagram, { direction: "RL" })

    expect(diagram.direction).toBe("LR")
  })

  test("normalizes mutable renderable state gaps before exposing them", async () => {
    const testRenderer = await createTestRenderer({ width: 40, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: "stateDiagram-v2\n  A --> B",
        minStateGap: Number.NaN,
      })

      expect(diagram.minStateGap).toBe(5)
      diagram.minStateGap = 0
      expect(diagram.minStateGap).toBe(1)
      diagram.minStateGap = 3.9
      expect(diagram.minStateGap).toBe(3)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("places right-to-left transition labels between intact frames", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  direction RL
  A --> B: reopen after a very detailed reviewer comment`)

    expect(output).toContain("╭───╮")
    expect(output.match(/╭───╮/g)?.length).toBe(2)
    expect(output).toContain("reopen after a very detailed reviewer comment")
  })

  test("keeps Unicode state labels inside their measured frame", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  direction LR
  state "界" as Wide`)
    const widths = output.split("\n").map((line) => stringWidth(line))

    expect(new Set(widths).size).toBe(1)
    expect(output).toContain("界")
  })

  test("reserves horizontal room for long transition labels", () => {
    const label = "this transition label is much wider than the route"
    const output = renderStateDiagram(`stateDiagram-v2
  direction LR
  A --> B: ${label}`)
    const labelRow = output.split("\n").find((line) => line.includes(label))!

    expect(labelRow.match(/╭───╮/g)?.length).toBe(2)
  })

  test("renders every line of multiline transition labels", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  direction LR
  A --> B: first<br/>second`)

    expect(output).toContain("first")
    expect(output).toContain("second")
  })

  test("renders a vertical state diagram", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction TB
  [*] --> Cart
  Cart --> Payment: checkout
  Payment --> Complete
`)

    expect(output).toMatchInlineSnapshot(`
      "      ●
            │
            │
            │
            ▼
        ╭──────╮
        │ Cart │
        ╰───┬──╯
            │
            │ checkout
            │
            ▼
       ╭─────────╮
       │ Payment │
       ╰────┬────╯
            │
            │
            │
            ▼
      ╭──────────╮
      │ Complete │
      ╰──────────╯"
    `)
  })

  test("renders branched and backward transitions visibly", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  Loading --> Success: 200 OK
  Loading --> Error: timeout
  Error --> Loading: retry
  Success --> [*]
`)

    expect(output).toMatchInlineSnapshot(`
      "              ╭──────╮   submit    ╭─────────╮   200 OK    ╭─────────╮
      ●────────────▶│ Idle ├────────────▶│ Loading ├────────────▶│ Success ├────────────▶◎
                    ╰──────╯             ╰──┬──────╯             ╰─────────╯
                                            │   ▲
                                   timeout  │   │
                                            ▼   │  retry
                                          ╭─────┴─╮
                                          │ Error │
                                          ╰───────╯"
    `)
  })

  test("captures converging labeled branches with long state names", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  [*] --> Waiting
  state "Waiting for surface and workspace" as Waiting
  state "Surface bound only" as Surface
  state "Workspace bound only" as Workspace
  state "Ready with queued input" as Ready
  state "Agent activity requested" as Active
  Waiting --> Surface: InteractionSurfaceBound
  Waiting --> Workspace: WorkspaceBound
  Surface --> Ready: WorkspaceBound
  Workspace --> Ready: InteractionSurfaceBound
  Ready --> Active: AgentActivityRequested`)

    expect(output).toMatchInlineSnapshot(`
      "              ╭───────────────────────────────────╮ InteractionSurfaceBound ╭────────────────────╮ WorkspaceBound ╭─────────────────────────╮ AgentActivityRequested ╭──────────────────────────╮
      ●────────────▶│ Waiting for surface and workspace ├────────────────────────▶│ Surface bound only ├───────────────▶│ Ready with queued input ├───────────────────────▶│ Agent activity requested │
                    ╰───────────────┬───────────────────╯                         ╰────────────────────╯                ╰─────────────────────────╯                        ╰──────────────────────────╯
                                    │ WorkspaceBound                                                                                   ▲
                                    ╰──────────────────────────────────────────────────────╮                                           │
                                                                                           │           InteractionSurfaceBound         │
                                                                                           ▼   ╭───────────────────────────────────────╯
                                                                                 ╭─────────────┴────────╮
                                                                                 │ Workspace bound only │
                                                                                 ╰──────────────────────╯"
    `)
  })

  test("keeps raised note connectors off outgoing transitions", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  Loading --> Success: 200 OK
  Loading --> Error: timeout
  note right of Loading : waiting for response
  Error --> Loading: retry
  Success --> [*]
`)

    expect(output).toMatchInlineSnapshot(`
      "                                                  ╔══════════════════════╗
                                                    ╔═══╣ waiting for response ║
                                                    ║   ╚══════════════════════╝
                                                    ║
                                                    ║
                    ╭──────╮   submit    ╭─────────╮   200 OK    ╭─────────╮
      ●────────────▶│ Idle ├────────────▶│ Loading ├────────────▶│ Success ├────────────▶◎
                    ╰──────╯             ╰──┬──────╯             ╰─────────╯
                                            │   ▲
                                   timeout  │   │
                                            ▼   │  retry
                                          ╭─────┴─╮
                                          │ Error │
                                          ╰───────╯"
    `)
  })

  test("renders configurable line arrowheads", () => {
    const output = renderStateDiagram(
      `
stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
`,
      { arrowHeadStyle: "line" },
    )

    expect(output).toContain("→")
    expect(output).not.toContain("▶")
  })

  test("renders self transitions and choice branches", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction LR
  state Decision <<choice>>
  [*] --> Editing
  Editing --> Editing: type
  Editing --> Decision: submit
  Decision --> Saved: ok
  Decision --> Error: fail
  Error --> Editing: retry
`)

    expect(output).toMatchInlineSnapshot(`
      "              ╭─────────╮   submit          ok      ╭───────╮
      ●────────────▶│ Editing ├─────────────┬────────────▶│ Saved │
                    ╰──┬──────╯             │             ╰───────╯
                     ▲ │    ▲ type          │ fail
                     │ ╰────╯               │
                     │                      ▼
                     │                  ╭───────╮
                     │                  │ Error │
                     │                  ╰───┬───╯
                     │                      │
                     │                      │
                     │        retry         │
                     ╰──────────────────────╯"
    `)
  })

  test("connects lower routed branches into choice junctions", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  direction LR
  state Decision <<choice>>
  [*] --> Fork
  Fork --> Upper
  Fork --> Lower
  Upper --> Decision
  Lower --> Decision
  Decision --> Done
  Done --> [*]`)

    expect(output).toContain("Upper ├─────────────┬────────────▶│ Done")
  })

  test("renders self transitions as loops in vertical diagrams", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  direction TB
  Working --> Working: retry`)

    expectDiagram(output).toEqualDiagram(`
      ╭─────────╮
      │ Working │
      ╰──┬──────╯
         │    ▲ retry
         ╰────╯
    `)
  })

  test("renders parallel transitions without losing labels", () => {
    const horizontal = renderStateDiagram(`stateDiagram-v2
  direction LR
  A --> B: first
  A --> B: second`)
    const vertical = renderStateDiagram(`stateDiagram-v2
  direction TB
  A --> B: first
  A --> B: second`)

    expect(horizontal).toContain("first")
    expect(horizontal).toContain("second")
    expect(vertical).toContain("first")
    expect(vertical).toContain("second")
  })

  test("keeps independent overlapping feedback labels and paths distinct", () => {
    const content = (direction: "LR" | "RL") => `stateDiagram-v2
  direction ${direction}
  A --> B: advance
  B --> C: continue
  C --> D: finish
  C --> A: reset A
  D --> B: reset B`

    for (const direction of ["LR", "RL"] as const) {
      const output = renderStateDiagram(content(direction))
      expect(output).toContain("reset A")
      expect(output).toContain("reset B")
      expect(output).not.toContain("res│t")
    }
  })

  test("keeps independent internal feedback paths inside their composite frame", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  direction LR
  state Runtime {
    A --> B: advance
    B --> C: continue
    C --> D: finish
    C --> A: reset A
    D --> B: reset B
  }`)
    const lines = output.split("\n")
    const frameTop = lines.findIndex((line) => line.includes("Runtime"))
    const upperFeedback = lines.findIndex((line) => line.includes("reset B"))

    expect(upperFeedback).toBeGreaterThan(frameTop)
    expect(output).toContain("reset A")
    expect(output).not.toContain("res│t")
  })

  test("places notes away from independent feedback corridors", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  direction LR
  A --> B: advance
  B --> C: continue
  C --> D: finish
  C --> A: reset A
  D --> B: reset B
  note right of B : note beside B`)

    expect(output).toContain("note beside B")
    expect(output).toContain("reset B")
    expect(output).not.toContain("╭─║")
    expect(output).not.toContain("║──")
  })

  test("keeps duplicate feedback labels away from an independent return path", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  direction LR
  A --> B
  B --> C
  C --> D
  C --> A: ca
  D --> B: db1
  D --> B: db2`)

    expect(output).toContain("ca")
    expect(output).toContain("db1")
    expect(output).toContain("db2")
    expect(output).not.toContain("c│")
  })

  test("renders composite state containers", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction LR
  state Authenticated {
    [*] --> Idle
    Idle --> Editing: open
    Editing --> [*]: save
  }
`)

    expect(output).toMatchInlineSnapshot(`
      "╭─ Authenticated ──────────────────────────────────────────────╮
      │                                                              │
      │               ╭──────╮    open     ╭─────────╮    save       │
      │ ─────────────▶│ Idle ├────────────▶│ Editing ├────────────── │
      │               ╰──────╯             ╰─────────╯               │
      │                                                              │
      ╰──────────────────────────────────────────────────────────────╯"
    `)
  })

  test("routes transitions entering and leaving composite states through scoped markers", () => {
    const content = `
stateDiagram-v2
  direction LR
  [*] --> Authenticated: login
  state Authenticated {
    [*] --> Idle
    Idle --> Editing: open
    Editing --> [*]: save
  }
  Authenticated --> [*]: logout
`
    const diagram = parseMermaidStateDiagram(content)
    const output = renderStateDiagram(content)

    expect(diagram.transitions).toContainEqual({
      from: "__start",
      to: "Authenticated.__start",
      label: "login",
    })
    expect(diagram.transitions).toContainEqual({
      from: "Authenticated.__end",
      to: "__end",
      label: "logout",
    })
    expect(output).toMatchInlineSnapshot(`
      "            ╭─ Authenticated ──────────────────╮
                  │                                  │
          login   │ ╭──────╮    open     ╭─────────╮ │  save
      ●────────────▶│ Idle ├────────────▶│ Editing ├────────────▶◎
                  │ ╰──────╯             ╰─────────╯ │
                  │                                  │
                  ╰──────────────────────────────────╯"
    `)
  })

  test("renders notes attached to states", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  note right of Loading : waits for response
`)

    expect(output).toMatchInlineSnapshot(`
      "              ╭──────╮   submit    ╭─────────╮    ╔════════════════════╗
      ●────────────▶│ Idle ├────────────▶│ Loading │════╣ waits for response ║
                    ╰──────╯             ╰─────────╯    ╚════════════════════╝"
    `)
  })

  test("renders ANSI styles", () => {
    const output = renderStateDiagramAnsi(`
stateDiagram-v2
  [*] --> Idle
`)

    expect(output).toContain("\x1b[")
    expect(output).toContain("●")
  })

  test("colors states, transitions, labels, and markers separately", async () => {
    const stateColor = parseColor("#E5E7EB")
    const activeStateColor = parseColor("#DDFFF6")
    const transitionColor = parseColor("#86E1C8")
    const labelColor = parseColor("#E6B17E")
    const testRenderer = await createTestRenderer({ width: 80, height: 12 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading: submit`,
        activeState: "Loading",
        stateColor,
        activeStateColor,
        transitionColor,
        labelColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const idleSpan = spans.find((span) => span.text.includes("Idle"))
      const loadingSpan = spans.find((span) => span.text.includes("Loading"))
      const arrowSpan = spans.find((span) => span.text.includes("▶"))
      const labelSpan = spans.find((span) => span.text.includes("submit"))
      const fadeSpan = spans.find((span) => span.text.includes("├") || span.text.includes("┤"))

      expect(idleSpan?.fg.equals(stateColor)).toBe(true)
      expect(loadingSpan?.fg.equals(activeStateColor)).toBe(true)
      expect(arrowSpan?.fg.equals(transitionColor)).toBe(true)
      expect(labelSpan?.fg.equals(labelColor)).toBe(true)
      expect(fadeSpan?.fg.equals(stateColor)).toBe(false)
      expect(fadeSpan?.fg.equals(transitionColor)).toBe(false)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("repaints state colors after mounting without changing diagram text", async () => {
    const initialColor = parseColor("#86E1C8")
    const updatedColor = parseColor("#38BDF8")
    const testRenderer = await createTestRenderer({ width: 80, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: "stateDiagram-v2\n  A --> B: next",
        transitionColor: initialColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()
      const before = testRenderer.captureCharFrame()

      diagram.transitionColor = updatedColor
      await testRenderer.renderOnce()
      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)

      expect(testRenderer.captureCharFrame()).toBe(before)
      expect(spans.some((span) => span.text.includes("▶") && span.fg.equals(updatedColor))).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("colors active transitions separately", async () => {
    const transitionColor = parseColor("#86E1C8")
    const activeTransitionColor = parseColor("#E6B17E")
    const testRenderer = await createTestRenderer({ width: 80, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading: submit`,
        activeTransition: { from: "Idle", to: "Loading" },
        transitionColor,
        activeTransitionColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const activeArrowSpan = spans.find((span) => span.text.includes("▶") && span.fg?.equals(activeTransitionColor))
      const inactiveArrowSpan = spans.find((span) => span.text.includes("▶") && span.fg?.equals(transitionColor))
      const departureSpan = spans.find((span) => span.text.includes("├"))
      const labelSpan = spans.find((span) => span.text.includes("submit"))

      expect(activeArrowSpan).toBeTruthy()
      expect(inactiveArrowSpan).toBeTruthy()
      expect(departureSpan?.fg.equals(activeTransitionColor)).toBe(false)
      expect(departureSpan?.fg.equals(transitionColor)).toBe(false)
      expect(labelSpan?.fg.equals(activeTransitionColor)).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("active transitions preserve route glyph shape", () => {
    const content = `stateDiagram-v2
  direction LR
  A --> B: next`

    const inactive = renderStateDiagram(content)
    const active = renderStateDiagram(content, {
      activeTransition: { from: "A", to: "B" },
    })

    expect(active).toBe(inactive)
  })

  test("derives transition boundary fades from per-state colors", async () => {
    const sourceColor = parseColor("#000000")
    const activeTransitionColor = parseColor("#060000")
    const expectedBoundaryColor = parseColor("#010000")
    const testRenderer = await createTestRenderer({ width: 80, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  Idle --> Loading: submit`,
        activeState: "Idle",
        activeStateColor: "#FF0000",
        activeTransition: { from: "Idle", to: "Loading" },
        activeTransitionColor,
        stateColors: { Idle: sourceColor },
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const departureSpan = spans.find((span) => span.text.includes("├"))

      expect(departureSpan?.fg.equals(expectedBoundaryColor)).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("colors individual states with per-state overrides", async () => {
    const stateColor = parseColor("#E4EFE8")
    const activeStateColor = parseColor("#FFD3A0")
    const outgoingColor = parseColor("#F0C198")
    const incomingColor = parseColor("#CFE4D7")
    const testRenderer = await createTestRenderer({ width: 90, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  Idle --> Loading: submit`,
        activeState: "Loading",
        stateColor,
        activeStateColor,
        stateColors: {
          Idle: outgoingColor,
          Loading: incomingColor,
        },
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      let spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const idleSpan = spans.find((span) => span.text.includes("Idle"))
      const loadingSpan = spans.find((span) => span.text.includes("Loading"))

      expect(idleSpan?.fg.equals(outgoingColor)).toBe(true)
      expect(loadingSpan?.fg.equals(incomingColor)).toBe(true)

      diagram.stateColors = undefined
      await testRenderer.renderOnce()
      spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)

      expect(spans.find((span) => span.text.includes("Idle"))?.fg.equals(stateColor)).toBe(true)
      expect(spans.find((span) => span.text.includes("Loading"))?.fg.equals(activeStateColor)).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("renders state backgrounds inside the state box only", async () => {
    const activeStateColor = parseColor("#FFD3A0")
    const activeStateBg = parseColor("#26352F")
    const testRenderer = await createTestRenderer({ width: 90, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  Idle --> Loading: submit`,
        activeState: "Loading",
        activeStateColor,
        stateBgColors: { Loading: activeStateBg },
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const borderSpan = spans.find((span) => span.text.includes("╭") || span.text.includes("╮"))
      const loadingSpan = spans.find((span) => span.text.includes("Loading"))

      expect(borderSpan?.bg.equals(activeStateBg)).toBe(false)
      expect(loadingSpan?.fg.equals(activeStateColor)).toBe(true)
      expect(loadingSpan?.bg.equals(activeStateBg)).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("fades active transitions from the active state color", () => {
    const output = renderStateDiagramAnsi(
      `
stateDiagram-v2
  [*] --> Idle
`,
      {
        activeState: "__start",
        activeTransition: { from: "__start", to: "Idle" },
        theme: {
          activeStateActiveTransitionFade1: "[active-state-fade]",
          startActiveTransitionFade1: "[start-fade]",
        },
      },
    )

    expect(output).toContain("[active-state-fade]")
    expect(output).not.toContain("[start-fade]")
  })

  test("colors note connector, border, and text separately", async () => {
    const noteConnectorColor = parseColor("#8DA99B")
    const noteBorderColor = parseColor("#B68B68")
    const noteTextColor = parseColor("#F1D9BE")
    const testRenderer = await createTestRenderer({ width: 110, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  note right of Loading : waits for response`,
        noteConnectorColor,
        noteBorderColor,
        noteTextColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const connectorSpan = spans.find((span) => span.text.includes("═") && span.fg?.equals(noteConnectorColor))
      const borderSpan = spans.find((span) => span.text.includes("╔") && span.fg?.equals(noteBorderColor))
      const textSpan = spans.find((span) => span.text.includes("waits for response"))

      expect(connectorSpan).toBeTruthy()
      expect(borderSpan).toBeTruthy()
      expect(textSpan?.fg.equals(noteTextColor)).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("colors active transition paths through choice junctions", async () => {
    const activeTransitionColor = parseColor("#E6B17E")
    const testRenderer = await createTestRenderer({ width: 120, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  direction LR
  state Decision <<choice>>
  Validating --> Decision
  Decision --> Submitted: valid
  Decision --> Invalid: errors`,
        activeTransition: [
          { from: "Validating", to: "Decision" },
          { from: "Decision", to: "Submitted", label: "valid" },
        ],
        activeTransitionColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const validSpan = spans.find((span) => span.text.includes("valid"))
      const errorsSpan = spans.find((span) => span.text.includes("errors"))
      const activeArrowSpan = spans.find((span) => span.text.includes("▶") && span.fg?.equals(activeTransitionColor))

      expect(validSpan?.fg.equals(activeTransitionColor)).toBe(true)
      expect(errorsSpan?.fg.equals(activeTransitionColor)).toBe(false)
      expect(activeArrowSpan).toBeTruthy()
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("colors composite containers separately", async () => {
    const compositeColor = parseColor("#6F8A7E")
    const stateColor = parseColor("#E4EFE8")
    const testRenderer = await createTestRenderer({ width: 100, height: 10 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  direction LR
  state Authenticated {
    [*] --> Idle
  }`,
        compositeColor,
        stateColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const compositeSpan = spans.find((span) => span.text.includes("Authenticated"))
      const stateSpan = spans.find((span) => span.text.includes("Idle"))

      expect(compositeSpan?.fg.equals(compositeColor)).toBe(true)
      expect(stateSpan?.fg.equals(stateColor)).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("ignores stale active transition selections while highlighting matches", () => {
    expect(() =>
      renderStateDiagram(
        `stateDiagram-v2
  direction LR
  A --> B`,
        {
          activeTransition: [
            { from: "Missing", to: "Gone" },
            { from: "A", to: "B" },
          ],
        },
      ),
    ).not.toThrow()
  })
})
