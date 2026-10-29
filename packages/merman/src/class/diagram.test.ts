import { describe, expect, test } from "bun:test"
import { detectMermaidDiagram } from "../detect.js"
import { MermaidSyntaxError } from "../diagnostics.js"
import { expectDiagram } from "../test/diagram.js"
import { TextAttributes } from "@opentui/core"
import { renderClassDiagram } from "./diagram.js"
import { drawClassDiagramGrid } from "./drawing.js"
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
        attributes: [{ text: "+String name" }, { text: "+int age" }],
        methods: [
          { text: "+makeSound() void", classifier: "abstract" },
          { text: "+count() int", classifier: "static" },
        ],
      },
      { id: "Swimmer", label: "Swimmer", annotations: ["interface"], attributes: [], methods: [] },
      { id: "Box", label: "Generic box", annotations: [], attributes: [], methods: [] },
    ])
  })

  test("treats generic parameters as display only", () => {
    const diagram = parseMermaidClassDiagram(`classDiagram
  class Box~T~
  Box --> Item
  Repository~T~ <|.. Store
  class Vec~I~ {
    ~List~T~ hidden
    +area() double*
    +make() S$
  }`)

    expect(diagram.classes.map((node) => [node.id, node.label])).toEqual([
      ["Box", "Box<T>"],
      ["Item", "Item"],
      ["Repository", "Repository<T>"],
      ["Store", "Store"],
      ["Vec", "Vec<I>"],
    ])
    expect(diagram.relations.map((relation) => [relation.from, relation.to])).toEqual([
      ["Box", "Item"],
      ["Repository", "Store"],
    ])
    expect(diagram.classes.at(-1)!.attributes).toEqual([{ text: "~List<T> hidden" }])
    expect(diagram.classes.at(-1)!.methods).toEqual([
      { text: "+area() double", classifier: "abstract" },
      { text: "+make() S", classifier: "static" },
    ])
  })

  test("parses classes named like presentation keywords and compact cardinalities", () => {
    const diagram = parseMermaidClassDiagram(`classDiagram
  Link <|-- WebLink
  Style : +color
  Zoo "1"o-- "*"Animal
  link Link "https://example.com"
  style Link fill:#f00`)

    expect(diagram.classes.map((node) => node.id)).toEqual(["Link", "WebLink", "Style", "Zoo", "Animal"])
    expect(diagram.classes[2]!.attributes).toEqual([{ text: "+color" }])
    expect(diagram.relations.at(-1)).toMatchObject({ from: "Zoo", to: "Animal", fromMarker: "aggregation" })
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

  test("places cardinalities on free cells and shows a shared one once", () => {
    const output = renderClassDiagram(`classDiagram
  class User {
    +String id
    +String email
  }
  class Notification {
    +String message
    +Boolean read
  }
  class Project
  class Task
  User "1" --> "0..*" Notification : receives
  User "1" --> "0..*" Task : assigned to
  Project "1" --> "0..*" Task : contains`)
    expect(output.match(/0\.\.\*/g)).toHaveLength(2)
    expect(output.match(/(?<![.\w])1(?![\w.])/g)).toHaveLength(2)
    for (const line of output.split("\n")) expect(line).not.toMatch(/[│├┤]\d|\d[│├┤]/)
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
    const frameLine = lines.find((line) => line.includes("─ Accounts "))!
    const frameRight = Math.max(frameLine.lastIndexOf("╮"), frameLine.lastIndexOf("╯"))
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

  test("keeps different markers that leave the same point", () => {
    const output = renderClassDiagram(`classDiagram
  A <|-- B
  A --> C
  A *-- D`)
    expect(output).toContain("◆")
    expect(output).toContain("△")
    expect(output).toContain("▼")
  })

  test("keeps sideways attachments in left-to-right diagrams", () => {
    const lines = renderClassDiagram(`classDiagram
  direction LR
  A --> B
  A --> C`).split("\n")
    expect(lines[0]).toMatch(/^╭───╮/)
    expect(lines[1]).toMatch(/^│ A ├/)
    expect(lines[2]).toMatch(/^╰───╯/)
  })

  test("keeps a moved class's label inside the canvas", () => {
    const output = renderClassDiagram(
      `classDiagram
  Shape <|-- Circle
  Shape <|-- Rectangle
  Rectangle <|-- Square : is a square with quite a long label`,
      { compact: true, layoutMaxWidth: 80 },
    )
    expect(output).toContain("is a square with quite a long label")
  })

  test("writes a namespace title on the side its layout chose", () => {
    const output = renderClassDiagram(`classDiagram
  namespace Group {
    class A
  }
  B --> A`)
    expect(output).toContain("▼")
    expect(output.split("\n").at(-1)).toContain("─ Group ")
  })

  test("reserves room for cardinalities on sideways lines", () => {
    const output = renderClassDiagram(
      `classDiagram
  direction LR
  User "1" --> "0..*" Role`,
      { compact: true },
    )
    expect(output).toContain(" 1 ")
    expect(output).toContain("0..*")
  })

  test("renders line breaks, generics and border junctions as text", () => {
    const output = renderClassDiagram(`classDiagram
  direction LR
  class Foo["hello<br>world"] {
    +List~em~ items
  }
  class Vec~I~ {
    +int x
  }
  B -- Vec`)
    const lines = output.split("\n")
    expect(lines[lines.findIndex((line) => line.includes("hello")) + 1]).toContain("world")
    expect(output).toContain("+List<em> items")
    expect(output).toContain("Vec<I>")
    expect(output).toContain("┼")
  })

  test("styles abstract members in italics and static members underlined", () => {
    const grid = drawClassDiagramGrid(
      parseMermaidClassDiagram(`classDiagram
  class Shape {
    +area()* double
    +count()$ int
  }`),
    )
    const attributesOf = (text: string) => {
      const row = grid.rows.find((cells) =>
        cells
          .map((cell) => cell.char)
          .join("")
          .includes(text),
      )!
      const start = row
        .map((cell) => cell.char)
        .join("")
        .indexOf(text)
      return row[start]!.attributes
    }
    expect(attributesOf("+area() double")).toBe(TextAttributes.ITALIC)
    expect(attributesOf("+count() int")).toBe(TextAttributes.UNDERLINE)
  })
})
