import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { diagramTextWidth } from "../core/text.js"
import { expectDiagram } from "../test/diagram.js"
import { renderSequenceDiagram } from "./diagram.js"
import { drawSequenceDiagramGrid } from "./drawing.js"
import { parseMermaidSequenceDiagram } from "./parser.js"
import { resolveSequenceStyleColors } from "./style.js"

describe("SequenceDiagram", () => {
  test("parses Mermaid sequenceDiagram participants and messages", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  participant B as Browser
  participant S as Server
  B->>S: GET /
  S-->>B: 401 WWW-Auth
`)

    expect(diagram.participants).toEqual([
      { id: "B", label: "Browser" },
      { id: "S", label: "Server" },
    ])
    expect(diagram.messages).toEqual([
      { from: "B", to: "S", label: "GET /", style: "solid" },
      { from: "S", to: "B", label: "401 WWW-Auth", style: "dashed" },
    ])
    expect(diagram.steps).toEqual([
      { type: "message", message: { from: "B", to: "S", label: "GET /", style: "solid" } },
      { type: "message", message: { from: "S", to: "B", label: "401 WWW-Auth", style: "dashed" } },
    ])
  })

  test("decodes HTML entities in participant, message, and note labels", () => {
    const diagram = parseMermaidSequenceDiagram(`sequenceDiagram
  participant A as Worker &amp; signer
  participant B
  A->>B: ack &lt;3s
  Note over A,B: result &#8805; 1`)

    expect(diagram.participants[0]?.label).toBe("Worker & signer")
    expect(diagram.messages[0]?.label).toBe("ack <3s")
    expect(diagram.steps.find((step) => step.type === "note")?.note.label).toBe("result ≥ 1")
  })

  test("renders a terminal sequence diagram", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant B as Browser
  participant S as Server
  B->>S: GET /
  S-->>B: 401 WWW-Auth
`)

    expectDiagram(output).toEqualDiagram(`
      Browser           Server
      ───┬───           ───┬──
         │                 │
         │ GET /           │
         ├─────────────────►
         │                 │
         │ 401 WWW-Auth    │
         ◄─────────────────┤
         │                 │
         │                 │
         │                 │
         │                 │
         │                 │
    `)
  })

  test("renders a compact terminal sequence diagram without participant boxes", () => {
    const output = renderSequenceDiagram(
      `
sequenceDiagram
  participant Leaf as leaf tool
  participant Location as LocationMutation
  participant File as FileMutation
  Leaf->>Location: resolve(path)
  Location-->>Leaf: Plan(target, authority anchor)
  Leaf->>File: commit(plan)
  File->>Location: revalidate(plan)
  Location-->>File: same target or reject
`,
      { compact: true },
    )

    expectDiagram(output).toEqualDiagram(`
      leaf tool                       LocationMutation             FileMutation
          │                                   │                          │
          ├───────── resolve(path) ───────────►                          │
          │                                   │                          │
          ◄─ Plan(target, authority anchor) ──┤                          │
          │                                   │                          │
          ├─────────────────────── commit(plan) ─────────────────────────►
          │                                   │                          │
          │                                   ◄─── revalidate(plan) ─────┤
          │                                   │                          │
          │                                   ├─ same target or reject ──►
          │                                   │                          │
          │                                   │                          │
          │                                   │                          │
          │                                   │                          │
          │                                   │                          │
    `)
  })

  test("keeps structured sequence steps visible in compact mode", () => {
    const output = renderSequenceDiagram(
      `
sequenceDiagram
  participant Worker
  participant Store
  Note over Worker,Store: transaction
  alt accepted
    Worker->>Worker: prepare
    Worker->>Store: commit
  end
`,
      { compact: true },
    )

    expectDiagram(output).toContainInOrder("Worker", "Store", "transaction", "alt: accepted", "prepare", "commit")
  })

  test("keeps compact labels above arrows when they do not fit inline", () => {
    const output = renderSequenceDiagram(
      "sequenceDiagram\n  participant A\n  participant B\n  participant C\n  A->>C: this label is deliberately much too long to fit between endpoints despite intermediate spacing",
      { compact: true },
    )
    const lines = output.split("\n")

    expect(lines.findIndex((line) => line.includes("deliberately"))).toBeLessThan(
      lines.findIndex((line) => line.includes("►")),
    )
  })

  test("normalizes invalid participant gaps for text rendering", () => {
    const content = "sequenceDiagram\n  A->>B: hello"

    expect(renderSequenceDiagram(content, { minParticipantGap: Number.NaN })).toContain("hello")
  })

  test("connects participant headers to lifelines", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant Browser
  participant Server
`)

    const lines = output.split("\n")
    const browserCenter = lines[0]!.indexOf("w")
    const serverCenter = lines[0]!.indexOf("v")

    expect(lines[1]?.[browserCenter]).toBe("┬")
    expect(lines[2]?.[browserCenter]).toBe("│")
    expect(lines[1]?.[serverCenter]).toBe("┬")
    expect(lines[2]?.[serverCenter]).toBe("│")
  })

  test("ramps participant frames into neutral lifelines", () => {
    const grid = drawSequenceDiagramGrid(
      parseMermaidSequenceDiagram(
        "sequenceDiagram\n  participant Browser\n  participant Server\n  Note over Browser,Server: context\n  Browser->>Server: request",
      ),
    )
    const rampStyles = grid.rows
      .flatMap((row) => row.map((cell) => cell.style))
      .filter((style) => style?.startsWith("lifelineRamp"))

    expect(new Set(rampStyles)).toEqual(new Set(["lifelineRamp1", "lifelineRamp2", "lifelineRamp3"]))
  })

  test("fades the bottom of participant lifelines", () => {
    const grid = drawSequenceDiagramGrid(
      parseMermaidSequenceDiagram(
        "sequenceDiagram\n  participant Browser\n  participant Server\n  Browser->>Server: request",
      ),
    )
    const fadeStyles = grid.rows
      .flatMap((row) => row.map((cell) => cell.style))
      .filter((style) => style?.startsWith("lifelineFade"))

    expect(new Set(fadeStyles)).toEqual(
      new Set(["lifelineFade1", "lifelineFade2", "lifelineFade3", "lifelineFade4", "lifelineFade5"]),
    )

    const lifeline = RGBA.fromInts(100, 120, 110)
    const background = RGBA.fromInts(10, 20, 15)
    const colors = resolveSequenceStyleColors({ lifeline, lifelineEnd: background })
    expect(colors.lifelineFade1.equals(lifeline)).toBe(true)
    expect(colors.lifelineFade5.equals(background)).toBe(true)
  })

  test("renders notes and long cross-participant messages in order", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant Browser
  participant Server
  participant Store as Ticket store
  Note over Browser,Server: native browser Basic prompt
  Browser->>Server: POST connect-token
  Server->>Store: issue { ptyID, scope }
`)

    expectDiagram(output).toContainInOrder(
      "native browser Basic prompt",
      "POST connect-token",
      "issue { ptyID, scope }",
    )
  })

  test("renders notes to the left and right of a participant", () => {
    const output = renderSequenceDiagram(`sequenceDiagram
  participant OpenTUI
  Note right of OpenTUI: child is not renderable
  Note left of OpenTUI: remove failed`)

    expect(output).toContain("child is not renderable")
    expect(output).toContain("remove failed")
  })

  test("preserves the parsed shape of notes over participants", () => {
    const diagram = parseMermaidSequenceDiagram(`sequenceDiagram
  participant A
  Note over A: hello`)

    expect(diagram.steps).toContainEqual({ type: "note", note: { over: ["A"], label: "hello" } })
  })

  test("parses the complete source of a br-delimited note", () => {
    const diagram = parseMermaidSequenceDiagram(`sequenceDiagram
  Note over Tool: directory instead?<br/>the WrongKind error carries the answer —<br/>branch to list, no extra round trip`)

    expect(diagram.steps).toContainEqual({
      type: "note",
      note: {
        over: ["Tool"],
        label:
          "directory instead?<br/>the WrongKind error carries the answer —<br/>branch to list, no extra round trip",
      },
    })
  })

  test("parses activation shorthand and control blocks", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  Browser->>+Server: request
  alt accepted
    Server-->>-Browser: response
  else rejected
    activate Server
    Server-->>Browser: error
    deactivate Server
  end
`)

    expect(diagram.steps).toEqual([
      {
        type: "message",
        message: {
          from: "Browser",
          to: "Server",
          label: "request",
          style: "solid",
          activate: "Server",
        },
      },
      { type: "fragment", fragment: { kind: "alt", label: "accepted" } },
      {
        type: "message",
        message: {
          from: "Server",
          to: "Browser",
          label: "response",
          style: "dashed",
          deactivate: "Server",
        },
      },
      { type: "fragment", fragment: { kind: "else", label: "rejected" } },
      { type: "activation", activation: { participant: "Server", active: true } },
      {
        type: "message",
        message: { from: "Server", to: "Browser", label: "error", style: "dashed" },
      },
      { type: "activation", activation: { participant: "Server", active: false } },
      { type: "fragment", fragment: { kind: "end", label: "alt" } },
    ])
  })

  test("renders activation syntax as visible intervals", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  Browser->>+Server: request
  Server-->>-Browser: response
`)

    expect(output).toContain("┃")
    expect(output).toContain("request")
    expect(output).toContain("response")
  })

  test("renders br-delimited participant aliases on separate lines", () => {
    const output = renderSequenceDiagram(`sequenceDiagram
  participant A as First line<br/>Second line
  participant B as Normal
  A->>B: hello`)

    expect(output).not.toContain("<br")
    expect(output).toContain("First line")
    expect(output).toContain("Second line")
  })

  test("parses Mermaid arrow head variants", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  A->B: open solid
  B-->A: open dashed
  A-xB: failed solid
  B--xA: failed dashed
  A-)B: async solid
  B--)A: async dashed
`)

    expect(diagram.messages).toEqual([
      { from: "A", to: "B", label: "open solid", style: "solid", head: "open" },
      { from: "B", to: "A", label: "open dashed", style: "dashed", head: "open" },
      { from: "A", to: "B", label: "failed solid", style: "solid", head: "cross" },
      { from: "B", to: "A", label: "failed dashed", style: "dashed", head: "cross" },
      { from: "A", to: "B", label: "async solid", style: "solid", head: "async" },
      { from: "B", to: "A", label: "async dashed", style: "dashed", head: "async" },
    ])
  })

  test("renders Mermaid arrow head variants", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  A->B: open solid
  B-->A: open dashed
  A-xB: failed solid
  B--xA: failed dashed
  A-)B: async solid
  B--)A: async dashed
`)

    expect(output).toMatchInlineSnapshot(`
      " A                  B
      ─┬─                ─┬─
       │                  │
       │ open solid       │
       ├─────────────────>│
       │                  │
       │ open dashed      │
       │<─────────────────┤
       │                  │
       │ failed solid     │
       ├─────────────────✕│
       │                  │
       │ failed dashed    │
       │✕─────────────────┤
       │                  │
       │ async solid      │
       ├─────────────────)│
       │                  │
       │ async dashed     │
       │(─────────────────┤
       │                  │
       │                  │
       │                  │
       │                  │
       │                  │"
    `)
  })

  test("renders boxed alt else regions", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  alt accepted
    Browser->>Server: ok
  else rejected
    Server-->>Browser: no
  end
`)

    expectDiagram(output).toContainInOrder("╭─ alt: accepted", "ok", "├─ else: rejected", "no", "╰")
    expect(output).not.toContain("end alt")
  })

  test("expands a fragment frame for a longer else label", () => {
    const output = renderSequenceDiagram(`sequenceDiagram
  A->>B: start
  alt ok
    A->>B: yes
  else validation failed with a substantially longer explanation
    B-->>A: no
  end`)
    const lines = output.split("\n")
    const elseRow = lines.find((line) => line.includes("validation failed"))!
    const endRow = [...lines].reverse().find((line) => line.includes("╰"))!

    expect(elseRow.lastIndexOf("┤")).toBe(endRow.lastIndexOf("╯"))
  })

  test("preserves combined graphemes in participant names", () => {
    const output = renderSequenceDiagram(`sequenceDiagram
  participant A as Cafe\u0301
  participant B
  A->>B: hi`)

    expect(output).toContain("Cafe\u0301")
  })

  test("renders fragment boxes with lifeline overhang", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant A
  participant B
  alt ok
    A->>B: yes
  end
`)
    const lines = output.split("\n")
    const participantCenter = lines.find((line) => line.includes("  A"))!.indexOf("A")
    const fragmentStart = lines.find((line) => line.includes("alt: ok"))!.indexOf("╭")

    expect(fragmentStart).toBeLessThan(participantCenter)
  })

  test("supports configurable fragment border styles", () => {
    const output = renderSequenceDiagram(
      `
sequenceDiagram
  participant A
  participant B
  alt ok
    A->>B: yes
  else no
    B-->>A: no
  end
`,
      { fragmentBorderStyle: "double" },
    )

    expect(output).toContain("╔")
    expect(output).toContain("╠")
    expect(output).toContain("╚")
    expect(output).toContain("═")
    expect(output).toContain("║")
  })

  test("parses and renders autonumbered messages", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  autonumber
  Browser->>API: request
  API-->>Browser: response
`)
    const output = renderSequenceDiagram(`
sequenceDiagram
  autonumber
  Browser->>API: request
  API-->>Browser: response
`)

    expect(diagram.messages.map((message) => message.number)).toEqual([1, 2])
    expect(output).toContain("1. request")
    expect(output).toContain("2. response")
  })

  test("supports autonumber start and increment", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  autonumber 10 5
  Browser->>API: first
  API-->>Browser: second
`)
    const output = renderSequenceDiagram(`
sequenceDiagram
  autonumber 10 5
  Browser->>API: first
  API-->>Browser: second
`)

    expect(diagram.messages.map((message) => message.number)).toEqual([10, 15])
    expect(output).toContain("10. first")
    expect(output).toContain("15. second")
  })

  test("parses and renders loop regions", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  loop retry up to 3x
    Browser->>API: GET /users/42
    API-->>Browser: 503
  end
`)
    const output = renderSequenceDiagram(`
sequenceDiagram
  loop retry up to 3x
    Browser->>API: GET /users/42
    API-->>Browser: 503
  end
`)

    expect(diagram.steps[0]).toEqual({
      type: "fragment",
      fragment: { kind: "loop", label: "retry up to 3x" },
    })
    expect(output).toContain("╭─ ↻ loop: retry up to 3x")
    expect(output).not.toContain("end loop")
    expect(output.indexOf("loop: retry up to 3x")).toBeLessThan(output.indexOf("GET /users/42"))
  })

  test("parses Mermaid box participant groups", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  participant Browser
  box Backend
    participant API
    participant Cache
  end
  box Purple Storage Layer
    participant DB
  end
  box "Purple Literal Label"
    participant Worker
  end
  Browser->>API: request
`)

    expect(diagram.groups).toEqual([
      { label: "Backend", participantIds: ["API", "Cache"] },
      { label: "Storage Layer", participantIds: ["DB"] },
      { label: "Purple Literal Label", participantIds: ["Worker"] },
    ])
    expect(diagram.steps).toEqual([
      {
        type: "message",
        message: { from: "Browser", to: "API", label: "request", style: "solid" },
      },
    ])
  })

  test("adds implicit participants inside box groups", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  participant API
  box Backend
    API->>DB: query
  end
`)

    expect(diagram.groups).toEqual([{ label: "Backend", participantIds: ["API", "DB"] }])
    expect(diagram.steps).toEqual([
      { type: "message", message: { from: "API", to: "DB", label: "query", style: "solid" } },
    ])
  })

  test("does not clip long non-adjacent messages or notes", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant A
  participant B
  participant C
  A->>C: this message needs room past the final participant
  Note over A,C: this note also needs full horizontal room
`)

    expect(output).toContain("this message needs room past the final participant")
    expect(output).toContain("this note also needs full horizontal room")
  })

  test("keeps long content inside participant groups and fragment frames", () => {
    const group = renderSequenceDiagram(`sequenceDiagram
  box Services
    participant A
    participant B
    participant C
    A->>C: this message text runs far outside of the group container boundary
  end`)
    const fragment = renderSequenceDiagram(`sequenceDiagram
  participant A
  participant B
  participant C
  alt lookup
    A->>C: this non adjacent message is deliberately much wider than the frame
  end`)

    const groupMessageRow = group.split("\n").find((line) => line.includes("this message text"))!
    const fragmentMessageRow = fragment.split("\n").find((line) => line.includes("this non adjacent message"))!
    expect(groupMessageRow.trimEnd().endsWith("│")).toBe(true)
    expect(fragmentMessageRow).toContain("this non adjacent message is deliberately much wider than the frame")
    expect(fragmentMessageRow.match(/│/g)?.length).toBe(3)
  })

  test("keeps long notes inside groups and nested fragment frames intact", () => {
    const groupedNote = renderSequenceDiagram(`sequenceDiagram
  box Services
    participant A
    participant B
    participant C
    Note over A,C: this note text runs far outside of the group container boundary
  end`)
    const fragmentNote = renderSequenceDiagram(`sequenceDiagram
  participant A
  participant B
  participant C
  alt lookup
    Note over A,C: this non adjacent note is deliberately much wider than the frame
  end`)
    const nested = renderSequenceDiagram(`sequenceDiagram
  participant A
  participant B
  alt outer
    loop inner heading wider than outer frame and participant span
      A->>B: x
    end
  end`)

    expect(groupedNote).toContain("this note text runs far outside of the group container boundary")
    expect(fragmentNote).toContain("this non adjacent note is deliberately much wider than the frame")
    expect(nested).toContain("span ─╮│")
    expect(nested).toContain("──────╯│")
  })

  test("does not draw external participants inside groups expanded by self messages", () => {
    const output = renderSequenceDiagram(`sequenceDiagram
  box G
    participant A
  end
  participant B as External
    A->>A: this self-loop extends underneath the external participant header`)
    const groupBorderRight = output.split("\n")[0]!.lastIndexOf("╮")
    const lines = output.split("\n")
    const externalLabelRow = lines.findIndex((line) => line.includes("External"))
    const externalHeaderLeft = lines[externalLabelRow + 1]!.lastIndexOf("─")

    expect(externalHeaderLeft).toBeGreaterThan(groupBorderRight)
  })

  test("keeps adjacent wide participant group frames separate", () => {
    const output = renderSequenceDiagram(
      `sequenceDiagram
  box First very wide group heading
    participant A
  end
  box Second very wide group heading
    participant B
  end
  A->>B: hi`,
      { compact: true },
    )
    const topRow = output.split("\n")[0]!

    expect(topRow).toContain("First very wide group heading")
    expect(topRow).toContain("Second very wide group heading")
    expect(topRow.indexOf("╮")).toBeLessThan(topRow.lastIndexOf("╭"))
  })

  test("renders many adjacent wide participant groups without excessive canvas growth", () => {
    const groupCount = 16
    const output = renderSequenceDiagram(
      `sequenceDiagram
${Array.from(
  { length: groupCount },
  (_, index) => `  box Group ${index} has a deliberately wide heading
    participant P${index}
  end`,
).join("\n")}
  P0->>P15: hi`,
      { compact: true },
    )

    expect(Math.max(...output.split("\n").map(diagramTextWidth))).toBeLessThan(groupCount * 60)
  })

  test("renders full-height participant group boxes", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant Browser
  box Backend
    participant API
    participant Cache
    participant DB
  end
  Browser->>API: GET /users/42
  API->>Cache: get user:42
`)

    expect(output).toMatchInlineSnapshot(`
      "                   ╭─ Backend ───────────────────────────────╮
      Browser            │ API              Cache              DB  │
      ───┬───            │ ─┬─              ──┬──              ─┬─ │
         │               │  │                 │                 │  │
         │ GET /users/42 │  │                 │                 │  │
         ├──────────────────►                 │                 │  │
         │               │  │                 │                 │  │
         │               │  │ get user:42     │                 │  │
         │               │  ├─────────────────►                 │  │
         │               │  │                 │                 │  │
         │               │  │                 │                 │  │
         │               │  │                 │                 │  │
         │               │  │                 │                 │  │
         │               │  │                 │                 │  │
                         ╰─────────────────────────────────────────╯"
    `)
  })

  test("lets message lines pass through group borders without intersections", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant Browser
  box Backend
    participant API
  end
  Browser->>API: GET /users/42
`)
    const arrowLine = output.split("\n").find((line) => line.includes("►"))!

    expect(arrowLine).toContain("───────────────►")
    expect(arrowLine).not.toContain("┼")
  })

  test("keeps filled arrowheads to one terminal column", () => {
    const output = renderSequenceDiagram(`sequenceDiagram
  box Backend
    participant A
    participant B
    A->>B: request
  end`)
    const lines = output.split("\n")
    const frameWidth = diagramTextWidth(lines.at(-1)!)

    expect(Math.max(...lines.map(diagramTextWidth))).toBe(frameWidth)
  })

  test("renders self messages as loopback arrows", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant Service
  Service->>Service: Check Permissions
`)

    expect(output).toMatchInlineSnapshot(`
      "Service
      ───┬───
         │
         ├────────────────────╮
         │ Check Permissions  │
         ◄────────────────────╯
         │
         │
         │
         │
         │"
    `)
  })

  test("renders note badges in their reserved rows", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  Browser->>Server: one
  Note over Browser,Server: phase
  Browser->>Server: two
`)
    const lines = output.split("\n")
    const noteRow = lines.findIndex((line) => line.includes("phase"))
    const nextMessageRow = lines.findIndex((line) => line.includes("two"))

    expect(noteRow).toBeGreaterThan(0)
    expect(lines[noteRow - 1]?.trim()).toBe("│                 │")
    expect(lines[noteRow]).toContain(" phase ")
    expect(lines[noteRow + 1]?.trim()).toBe("│                 │")
    expect(nextMessageRow).toBe(noteRow + 2)
  })

  test("renders br-delimited message labels across multiple rows", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  Browser->>Server: POST connect-token<br/>· Basic (cached by browser)<br/>· X-OpenCode-Ticket: 1
`)

    expect(output).toContain("POST connect-token")
    expect(output).toContain("· Basic (cached by browser)")
    expect(output).toContain("· X-OpenCode-Ticket: 1")
    expect(output.indexOf("· X-OpenCode-Ticket: 1")).toBeLessThan(output.indexOf("├"))
  })

  test("renders br-delimited notes as rows without source tags", () => {
    const output = renderSequenceDiagram(`sequenceDiagram
  Note over Tool: directory instead?<br/>the WrongKind error carries the answer —<br/>branch to list, no extra round trip`)

    expectDiagram(output).toContainInOrder(
      "directory instead?",
      "the WrongKind error carries the answer —",
      "branch to list, no extra round trip",
    )
    expect(output).not.toMatch(/<br\s*\/?\s*>/i)
  })
})
