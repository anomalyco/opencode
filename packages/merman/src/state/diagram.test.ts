import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import { expectDiagram } from "../test/diagram.js"
import { renderStateDiagram } from "./diagram.js"
import { drawStateDiagramGrid } from "./drawing.js"
import { parseMermaidStateDiagram } from "./parser.js"

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

  test("keeps reciprocal multiline transition labels clear of routes", () => {
    const output = renderStateDiagram(`stateDiagram-v2
    [*] --> Running: create from base image
    Running --> Dormant: 📸 suspend hook fires<br/>(WE must call it on idle)
    Dormant --> Running: wake from snapshot image<br/>(apt installs restored!)
    Running --> Lost: 💥 sandbox dies BEFORE hook fires<br/>(crash, our bug, race)
    Lost --> Running: wake from LAST snapshot<br/>⚠ files since then GONE`)
    const labelLines = [
      "create from base image",
      "📸 suspend hook fires",
      "(WE must call it on idle)",
      "wake from snapshot image",
      "(apt installs restored!)",
      "💥 sandbox dies BEFORE hook fires",
      "(crash, our bug, race)",
      "wake from LAST snapshot",
      "⚠ files since then GONE",
    ]

    for (const line of labelLines) expect(output.split(line)).toHaveLength(2)
    expect(output).toMatchInlineSnapshot(`
      "
        create from base image ╭─────────╮
      ●───────────────────────▶│ Running │
                               ╰──┬──────╯ 💥 sandbox dies BEFORE hook fires
                                ▲ │   ▲    (crash, our bug, race)
                       ╭────────┼─╰───┼───────╮
                       ▼   ╭────┼─────╯       ▼
                    ╭──────┴──╮ │           ╭──────╮
                    │ Dormant │ │           │ Lost │
                    ╰─────────╯ │           ╰───┬──╯
                                │               │
       📸 suspend hook fires    │               │
       (WE must call it on idle)│               │
                                ╰───────────────╯
                            wake from snapshot image
                            (apt installs restored!)
                                  wake from LAST snapshot
                                  ⚠ files since then GONE"
    `)
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

  test("places a composite note above an occupied right side", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  [*] --> Processing

  state Processing {
    [*] --> Validate
    Validate --> Decision
    state Decision <<choice>>
    Decision --> Accepted: valid
    Decision --> Rejected: invalid
    Accepted --> [*]
    Rejected --> [*]
  }

  note right of Processing
    Validation and routing happen
    inside this composite state.
  end note

  Processing --> Complete
  Complete --> [*]`)
    const lines = output.split("\n")
    const noteBottom = lines.findIndex((line) => line.includes("╚═══════════════════════════════╝"))
    const completeRow = lines.findIndex((line) => line.includes(" Complete "))

    expect(noteBottom).toBeGreaterThanOrEqual(0)
    expect(noteBottom).toBeLessThan(completeRow)
    expect(lines.slice(noteBottom + 1, completeRow).every((line) => !line.includes("Complete"))).toBe(true)
    expect(lines).toHaveLength(20)
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

  test("keeps composite-to-choice elbows connected", () => {
    const output = renderStateDiagram(`stateDiagram-v2
  [*] --> Authenticated
  state Authenticated {
    [*] --> Editing
    Editing --> Ready
  }
  note right of Editing
    Draft changes
  end note
  Authenticated --> Decision
  state Decision <<choice>>
  Decision --> [*]`)

    expect(output).toContain("╰─────────────┬\n")
  })
})
