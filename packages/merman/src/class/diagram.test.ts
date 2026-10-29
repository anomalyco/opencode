import { describe, expect, test } from "bun:test"
import { detectMermaidDiagram } from "../detect.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import { expectDiagram } from "../test/diagram.js"
import { renderClassDiagram } from "./diagram.js"
import { parseMermaidClassDiagram } from "./parser.js"

describe("class diagram parser", () => {
  test("detects classDiagram headers", () => {
    expect(detectMermaidDiagram("%% comment\nclassDiagram\n  A <|-- B")).toBe("class")
    expect(detectMermaidDiagram("classDiagram-v2\n  class A")).toBe("class")
    expect(detectMermaidDiagram("flowchart LR\n  A --> B")).toBe("flowchart")
  })

  test("parses class bodies, member shorthand and annotations", () => {
    const diagram = parseMermaidClassDiagram(`classDiagram
  class Animal {
    <<abstract>>
    +String name
    +makeSound()* void
    +count()$ int
  }
  Animal : +int age
  <<interface>> Swimmer
  class Box~T~["Generic box"]`)

    expect(diagram.classes).toEqual([
      {
        id: "Animal",
        label: "Animal",
        annotations: ["abstract"],
        attributes: ["+String name", "+int age"],
        methods: ["<i>+makeSound() void</i>", "+count() int"],
      },
      { id: "Swimmer", label: "Swimmer", annotations: ["interface"], attributes: [], methods: [] },
      { id: "Box<T>", label: "Generic box", annotations: [], attributes: [], methods: [] },
    ])
  })

  test("parses relation markers, line styles, cardinalities and labels", () => {
    const diagram = parseMermaidClassDiagram(`classDiagram
  Animal <|-- Duck
  Zoo "1" o-- "*" Animal : houses
  Car *-- Wheel
  Duck ..> Pond : uses
  Circle ..|> Shape
  A -- B
  Foo --> Bar`)

    expect(diagram.relations).toEqual([
      { from: "Animal", to: "Duck", label: "", dashed: false, fromMarker: "inheritance" },
      {
        from: "Zoo",
        to: "Animal",
        label: "houses",
        dashed: false,
        fromMarker: "aggregation",
        fromCardinality: "1",
        toCardinality: "*",
      },
      { from: "Car", to: "Wheel", label: "", dashed: false, fromMarker: "composition" },
      { from: "Duck", to: "Pond", label: "uses", dashed: true, toMarker: "arrow" },
      { from: "Circle", to: "Shape", label: "", dashed: true, toMarker: "inheritance" },
      { from: "A", to: "B", label: "", dashed: false },
      { from: "Foo", to: "Bar", label: "", dashed: false, toMarker: "arrow" },
    ])
  })

  test("parses direction and namespaces, ignoring presentation statements", () => {
    const diagram = parseMermaidClassDiagram(`classDiagram
  direction LR
  namespace Shapes {
    class Shape
    class Circle
  }
  classDef hot fill:#f00
  cssClass "Shape" hot`)

    expect(diagram.direction).toBe("LR")
    expect(diagram.namespaces).toEqual([{ id: "Shapes", classIds: ["Shape", "Circle"] }])
  })

  test("rejects unsupported or unclosed syntax", () => {
    expect(() => parseMermaidClassDiagram('classDiagram\n  note for A "hi"')).toThrow(MermaidSyntaxError)
    expect(() => parseMermaidClassDiagram("classDiagram\n  class A {\n    +x")).toThrow('Unclosed block; expected "}"')
  })
})

describe("class diagram rendering", () => {
  test("draws compartments, markers, cardinalities and labels", () => {
    expectDiagram(
      renderClassDiagram(`classDiagram
  class Animal {
    +String name
    +eat() void
  }
  Zoo "1" o-- "*" Animal : houses
  Animal <|-- Duck`),
    ).toEqualDiagram(`
        ╭─────╮
        │ Zoo │
        ╰─────╯
            ◇ 1
            │  houses
            │
            │ *
    ╭───────┴──────╮
    │    Animal    │
    ├──────────────┤
    │ +String name │
    ├──────────────┤
    │ +eat() void  │
    ╰──────────────╯
            △
            │
            │
            │
        ╭───┴──╮
        │ Duck │
        ╰──────╯`)
  })

  test("moves a single child under its parent so the line runs straight", () => {
    const lines = renderClassDiagram(`classDiagram
  Shape <|-- Circle
  Shape <|-- Rectangle
  Rectangle <|-- Square
  class Rectangle {
    -double width
    -double height
  }`).split("\n")
    const squareTop = lines.findIndex((line) => line.includes("│ Square │")) - 1
    const marker = lines.findLastIndex((line) => line.includes("△"))
    const column = lines[marker]!.indexOf("△")
    expect(lines[squareTop]!.indexOf("┴")).toBe(column)
    for (let row = marker + 1; row < squareTop; row++) expect(lines[row]!.trim()).toBe("│")
  })

  test("draws dashed relations with continuous dashed glyphs", () => {
    const output = renderClassDiagram(`classDiagram
  Checkout ..> PaymentMethod : uses`)
    expectDiagram(output).toContainInOrder("│ Checkout │", "╎", "uses", "▼", "│ PaymentMethod │")
    expect(output).not.toMatch(/\n\s*\n/)
  })

  test("keeps classes outside a namespace off its frame", () => {
    const output = renderClassDiagram(`classDiagram
  namespace Accounts {
    class Account
    class Checking
    class Savings
  }
  Account <|-- Checking
  Account <|-- Savings
  AccountRepository ..|> Repository
  AccountRepository ..> Account : stores`)
    const lines = output.split("\n")
    const frameRight = lines.find((line) => line.includes("╭─ Accounts"))!.lastIndexOf("╮")
    const repository = lines.find((line) => /│ Repository │/.test(line))!
    expect(repository.indexOf("Repository")).toBeGreaterThan(frameRight)
  })

  test("draws namespaces and dashed horizontal relations", () => {
    expectDiagram(
      renderClassDiagram(`classDiagram
  direction LR
  namespace Shapes {
    class Circle
  }
  Circle ..|> Shape`),
    ).toContainInOrder("╭─ Shapes ─", "│ Circle ├", "▷│ Shape │")
  })
})
