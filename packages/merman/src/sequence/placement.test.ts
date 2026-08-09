import { describe, expect, test } from "bun:test"
import { diagramTextWidth } from "../core/text.js"
import { parseMermaidSequenceDiagram } from "./parser.js"
import { createSequencePlacementPlan } from "./placement.js"

describe("createSequencePlacementPlan", () => {
  test("expands one fragment frame for a longer else label", () => {
    const plan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  A->>B: start
  alt ok
    A->>B: yes
  else validation failed with a substantially longer explanation
    B-->>A: no
  end`),
    )
    const fragments = plan.steps.filter((step) => step.type === "fragment")

    expect(fragments).toHaveLength(3)
    expect(fragments.map((fragment) => fragment.bounds.rightX)).toEqual([
      fragments[0]!.bounds.rightX,
      fragments[0]!.bounds.rightX,
      fragments[0]!.bounds.rightX,
    ])
    expect(fragments[1]!.labelText).toContain("validation failed")
  })

  test("includes non-adjacent message and note labels within planned width", () => {
    const plan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  participant A
  participant B
  participant C
  A->>C: this message needs room past the final participant
  Note over A,C: this note also needs full horizontal room`),
    )
    const message = plan.steps.find((step) => step.type === "message")!
    const note = plan.steps.find((step) => step.type === "note")!

    const messageWidth = Math.max(...message.labelLines.map(diagramTextWidth))
    expect(message.labelX + messageWidth).toBeLessThanOrEqual(plan.width)
    expect(note.textX + Math.max(...note.textLines.map(diagramTextWidth))).toBeLessThanOrEqual(plan.width)
  })

  test("keeps side notes clear of adjacent participant lifelines", () => {
    const plan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  participant A
  participant B
  participant C
  Note right of A: a long note between the first two participants
  Note left of C: another long note between the final participants`),
    )
    const notes = plan.steps.filter((step) => step.type === "note")

    expect(notes[0]!.textX + Math.max(...notes[0]!.textLines.map(diagramTextWidth))).toBeLessThan(
      plan.participants[1]!.centerX,
    )
    expect(notes[1]!.textX).toBeGreaterThan(plan.participants[1]!.centerX)
  })

  test("allocates group space around a contained self-message loop", () => {
    const plan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  box Backend
    participant Service
    Service->>Service: Check Permissions
  end`),
    )
    const group = plan.groups[0]!
    const message = plan.steps.find((step) => step.type === "selfMessage")!

    expect(group.leftX).toBeGreaterThanOrEqual(0)
    expect(group.rightX).toBeGreaterThanOrEqual(message.rightX + 2)
    expect(plan.width).toBeGreaterThan(group.rightX)
  })

  test("keeps external participants outside a group expanded by internal content", () => {
    const plan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  box G
    participant A
  end
  participant B as External
  A->>A: this self-loop extends underneath the external participant header`),
    )
    const group = plan.groups[0]!
    const external = plan.participants.find((participant) => participant.participant.id === "B")!

    expect(external.headerLeftX).toBeGreaterThan(group.rightX)
  })

  test("keeps many adjacent wide groups at a linear width", () => {
    const groupCount = 16
    const source = `sequenceDiagram
${Array.from(
  { length: groupCount },
  (_, index) => `  box Group ${index} has a deliberately wide heading
    participant P${index}
  end`,
).join("\n")}
  P0->>P15: hi`
    const plan = createSequencePlacementPlan(parseMermaidSequenceDiagram(source), { compact: true })

    expect(plan.groups).toHaveLength(groupCount)
    for (let index = 1; index < plan.groups.length; index++) {
      expect(plan.groups[index]!.leftX).toBeGreaterThan(plan.groups[index - 1]!.rightX)
    }
    expect(plan.width).toBeLessThan(groupCount * 60)
  })

  test("expands group and fragment frames around contained long content", () => {
    const groupPlan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  box Services
    participant A
    participant B
    participant C
    A->>C: this message text runs far outside of the group container boundary
  end`),
    )
    const group = groupPlan.groups[0]!
    const groupedMessage = groupPlan.steps.find((step) => step.type === "message")!
    const groupedMessageRight = groupedMessage.labelX + Math.max(...groupedMessage.labelLines.map(diagramTextWidth)) - 1

    expect(group.rightX).toBeGreaterThan(groupedMessageRight)

    const fragmentPlan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  participant A
  participant B
  participant C
  alt lookup
    A->>C: this non adjacent message is deliberately much wider than the frame
  end`),
    )
    const fragment = fragmentPlan.steps
      .filter((step) => step.type === "fragment")
      .find((step) => step.fragment.kind === "alt")!
    const fragmentMessage = fragmentPlan.steps.find((step) => step.type === "message")!
    const fragmentMessageRight =
      fragmentMessage.labelX + Math.max(...fragmentMessage.labelLines.map(diagramTextWidth)) - 1

    expect(fragment.bounds.rightX).toBeGreaterThan(fragmentMessageRight)
  })

  test("sizes multiline notes and their group and fragment bounds for every br spelling", () => {
    const plan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  box Tools
    participant Tool
    alt retry
      Note over Tool: directory instead?<br/>the WrongKind error carries the answer —<br/>branch to list, no extra round trip
      Note over Tool: first<br>second<br />third
    end
  end`),
    )
    const notes = plan.steps.filter((step) => step.type === "note")
    const fragment = plan.steps.filter((step) => step.type === "fragment").find((step) => step.fragment.kind === "alt")!
    const group = plan.groups[0]!
    const firstNoteWidth = Math.max(...notes[0]!.textLines.map(diagramTextWidth))

    expect(notes[0]!.textLines.map((line) => line.trim())).toEqual([
      "directory instead?",
      "the WrongKind error carries the answer —",
      "branch to list, no extra round trip",
    ])
    expect(notes[1]!.textLines.map((line) => line.trim())).toEqual(["first", "second", "third"])
    expect(fragment.bounds.rightX).toBeGreaterThan(notes[0]!.textX + firstNoteWidth - 1)
    expect(group.rightX).toBeGreaterThan(notes[0]!.textX + firstNoteWidth - 1)
    expect(plan.height).toBeGreaterThan(notes[1]!.textY + notes[1]!.textLines.length)
  })

  test("preserves nesting inset when a child fragment has a wide heading", () => {
    const plan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  participant A
  participant B
  alt outer
    loop inner heading wider than outer frame and participant span
      A->>B: x
    end
  end`),
    )
    const starts = plan.steps
      .filter((step) => step.type === "fragment")
      .filter((step) => step.fragment.kind === "alt" || step.fragment.kind === "loop")

    expect(starts[0]!.bounds.rightX).toBeGreaterThan(starts[1]!.bounds.rightX)
  })

  test("aligns explicit and shorthand activation intervals to message events", () => {
    const shorthand = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  A->>+B: request
  B-->>-A: response`),
    )
    const explicit = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  A->>B: request
  activate B
  B-->>A: response
  deactivate B`),
    )

    expect(explicit.activations).toEqual(shorthand.activations)
  })

  test("centers message label blocks over their arrow span", () => {
    const plan = createSequencePlacementPlan(
      parseMermaidSequenceDiagram(`sequenceDiagram
  participant A
  participant B
  A->>B: short<br/>a much longer line`),
    )
    const message = plan.steps.find((step) => step.type === "message")!
    const labelWidth = Math.max(...message.labelLines.map(diagramTextWidth))

    expect(message.labelX * 2 + labelWidth).toBe(message.leftX + message.rightX)
  })
})
