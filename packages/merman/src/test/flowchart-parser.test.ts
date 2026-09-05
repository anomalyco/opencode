import { describe, expect, test } from "bun:test"
import { MermaidSyntaxError } from "../diagnostics.js"
import { detectMermaidDiagram } from "../detect.js"
import { isMermaidFlowchartDiagram, parseMermaidFlowchartDiagram } from "../flowchart/parser.js"

describe("flowchart parser", () => {
  test("accepts slash IDs as sources, targets, and explicitly labeled nodes", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  src/api --> _pkg/worker[Worker (fast/slow), ready]
  _pkg/worker --> sink/archive`)

    expect(diagram.nodes).toEqual([
      { id: "src/api", label: "src/api", shape: "box" },
      { id: "_pkg/worker", label: "Worker (fast/slow), ready", shape: "box" },
      { id: "sink/archive", label: "sink/archive", shape: "box" },
    ])
    expect(diagram.edges).toEqual([
      { from: "src/api", to: "_pkg/worker", label: "" },
      { from: "_pkg/worker", to: "sink/archive", label: "" },
    ])
  })

  test("separates class suffixes from slash and dotted edge endpoint IDs", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  cli/tui:::ui-->node.id/src:::core
  node.id/src:::core-->cli/tui:::ui`)
    expect(diagram.nodes).toEqual([
      { id: "cli/tui", label: "cli/tui", shape: "box" },
      { id: "node.id/src", label: "node.id/src", shape: "box" },
    ])
    expect(diagram.edges).toEqual([
      { from: "cli/tui", to: "node.id/src", label: "" },
      { from: "node.id/src", to: "cli/tui", label: "" },
    ])
  })

  test("strips class suffixes from standalone slash nodes before resolving labels and membership", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  subgraph Group
    cli/tui[CLI/TUI]:::ui
    node.id/src:::core
    cli/tui-->node.id/src
  end`)
    expect(diagram.nodes).toEqual([
      { id: "cli/tui", label: "CLI/TUI", shape: "box" },
      { id: "node.id/src", label: "node.id/src", shape: "box" },
    ])
    expect(diagram.subgraphs?.[0]?.nodeIds).toEqual(["cli/tui", "node.id/src"])
    expect(diagram.edges).toEqual([{ from: "cli/tui", to: "node.id/src", label: "" }])
  })

  test("accepts slash subgraph IDs with and without explicit labels", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart TD
  subgraph pkg/outer[Outer (api/ui), services]
    subgraph pkg/inner
      pkg/node[Node]
    end
  end`)

    expect(diagram.subgraphs).toEqual([
      { id: "pkg/outer", label: "Outer (api/ui), services", nodeIds: [], parentId: undefined },
      { id: "pkg/inner", label: "pkg/inner", nodeIds: ["pkg/node"], parentId: "pkg/outer" },
    ])
  })

  test.each(["-->", "==>", "-.->", "---", "~~~", "<-->", "<==>", "<-.->"])(
    "separates adjacent %s operators from slash IDs",
    (operator) => {
      const diagram = parseMermaidFlowchartDiagram(`flowchart LR\na/src${operator}b/dst${operator}c/end`)
      expect(diagram.nodes.map((node) => node.id)).toEqual(["a/src", "b/dst", "c/end"])
      expect(diagram.edges.map((edge) => [edge.from, edge.to])).toEqual([
        ["a/src", "b/dst"],
        ["b/dst", "c/end"],
      ])
    },
  )

  test.each(["/src --> B", "A --> /dst", "/src[Label]", "1/src --> B", "A --> 1/dst"])(
    "rejects IDs without a letter or underscore first: %s",
    (statement) => {
      expect(() => parseMermaidFlowchartDiagram(`flowchart LR\n${statement}`)).toThrow(MermaidSyntaxError)
    },
  )

  test.each([
    ["<-->", undefined],
    ["<==>", "thick"],
    ["<-.->", "dashed"],
  ] as const)("retains both arrowheads and style for %s with optional pipe labels", (operator, style) => {
    for (const label of ["", "exchange (in/out), ready"]) {
      const diagram = parseMermaidFlowchartDiagram(`flowchart LR\nA${operator}${label ? `|${label}|` : ""}B`)
      expect(diagram.edges).toEqual([{ from: "A", to: "B", label, sourceArrowhead: true, ...(style ? { style } : {}) }])
    }
  })

  test.each([
    ["<-- exchange -->", undefined],
    ["<== exchange ==>", "thick"],
    ["<-. exchange .->", "dashed"],
  ] as const)("retains bidirectional inline labels for %s", (operator, style) => {
    expect(parseMermaidFlowchartDiagram(`flowchart LR\nA ${operator} B`).edges).toEqual([
      { from: "A", to: "B", label: "exchange", sourceArrowhead: true, ...(style ? { style } : {}) },
    ])
  })

  test("keeps unquoted parentheses, slashes, and commas in node and edge labels", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  A[Request (GET/POST), ready] -->|Result (ok/error), done| B[Response (json/xml), sent]`)
    expect(diagram.nodes.map((node) => node.label)).toEqual(["Request (GET/POST), ready", "Response (json/xml), sent"])
    expect(diagram.edges[0]?.label).toBe("Result (ok/error), done")
  })

  test.each([
    "classDef highlight fill:#fff,stroke:#000;",
    "class A,B highlight;",
    "style A fill:#fff;",
    'style A fill:url("data:image/svg+xml;utf8,icon");',
    "linkStyle 0 stroke:#fff;",
    'click A "https://example.com/a;b" "Open; page" _blank;',
    'click A "https://example.com/a" "Open page" _blank',
    "click A callback",
    "accTitle: A useful diagram",
    "accDescr: A description (with punctuation), for everyone",
    "accDescr { A description on one line }",
    "accDescr {\nA description spanning\nseveral lines\n}",
    '%%{init: {"theme": "dark"}}%%',
    '%%{init: {\n"theme": "dark"\n}}%%',
  ])("ignores nonstructural presentation and metadata: %s", (statement) => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR\nA --> B\n${statement}\nB --> C`)
    expect(diagram.nodes.map((node) => node.id)).toEqual(["A", "B", "C"])
    expect(diagram.edges).toEqual([
      { from: "A", to: "B", label: "" },
      { from: "B", to: "C", label: "" },
    ])
  })

  test("recognizes flowcharts with a preceding multiline init directive", () => {
    const source = `%%{init: {
  "theme": "dark"
}}%%
flowchart LR
A --> B`
    expect(isMermaidFlowchartDiagram(source)).toBe(true)
    expect(detectMermaidDiagram(source)).toBe("flowchart")
    expect(parseMermaidFlowchartDiagram(source).direction).toBe("LR")
  })

  test.each([
    '%%{init: {\n"theme": "dark"',
    '%%{init: {"theme": "dark"}}%% unexpected',
    "accDescr {\nDescription",
    "accDescr { Description } unexpected",
  ])("does not throw during detection of malformed pre-header metadata: %s", (metadata) => {
    const source = `${metadata}\nflowchart LR\nA --> B`
    expect(isMermaidFlowchartDiagram(source)).toBe(false)
    expect(detectMermaidDiagram(source)).toBeUndefined()
    expect(() => parseMermaidFlowchartDiagram(source)).toThrow(MermaidSyntaxError)
  })

  test.each([
    '%%{init: {\n"theme": "dark"',
    '%%{init: {"theme": "dark"}}%% unexpected',
    "accDescr {\nDescription",
    "accDescr { Description } unexpected",
  ])("leaves malformed post-header metadata validation to parsing: %s", (metadata) => {
    const source = `flowchart LR\nA --> B\n${metadata}`
    expect(detectMermaidDiagram(source)).toBe("flowchart")
    expect(() => parseMermaidFlowchartDiagram(source)).toThrow(MermaidSyntaxError)
  })

  test.each(["classDef", "class", "style", "linkStyle", "click", "accTitle", "accDescr"])(
    "does not discard structural statements using the ID %s",
    (id) => {
      const diagram = parseMermaidFlowchartDiagram(`flowchart LR\n${id}[Label]\n${id} --> B`)
      expect(diagram.nodes.map((node) => node.id)).toEqual([id, "B"])
      expect(diagram.edges).toEqual([{ from: id, to: "B", label: "" }])
    },
  )

  test.each([
    "A --o B",
    "A & B --> C",
    "class --o B",
    "class A -->",
    "style A fill:#fff; A --> B",
    "style A fill:#fff; C[New node]",
    "classDef highlight fill:#fff; subgraph Group",
  ])("rejects unsupported structure rather than dropping it: %s", (statement) => {
    expect(() => parseMermaidFlowchartDiagram(`flowchart LR\n${statement}`)).toThrow(MermaidSyntaxError)
  })

  test("preserves source locations after multiline metadata", () => {
    expect(() => parseMermaidFlowchartDiagram('flowchart LR\n%%{init: {\n"theme": "dark"\n}}%%\nA --o B')).toThrow(
      'Unsupported syntax in flowchart diagram at line 5: "A --o B"',
    )
  })

  test.each([
    "accDescr { Description } A --> B",
    "accDescr {\nDescription\n} A --> B",
    '%%{init: {"theme": "dark"}}%% A --> B',
    '%%{init: {\n"theme": "dark"\n}}%% A --> B',
  ])("does not discard structure after metadata block endings: %s", (statement) => {
    expect(() => parseMermaidFlowchartDiagram(`flowchart LR\n${statement}`)).toThrow(MermaidSyntaxError)
  })

  test.each(["accDescr {\nDescription", '%%{init: {\n"theme": "dark"'])(
    "rejects unclosed metadata blocks: %s",
    (statement) => {
      expect(() => parseMermaidFlowchartDiagram(`flowchart LR\n${statement}`)).toThrow("Unclosed metadata block")
    },
  )

  test.each(["-->", "~~~"])("resolves %s subgraph endpoints independent of declaration order", (operator) => {
    for (const before of [true, false]) {
      const declarations = "subgraph Group\nA\nend\nsubgraph Other\nB\nend"
      const connections = `Group${operator}Other${operator}C`
      const diagram = parseMermaidFlowchartDiagram(
        `flowchart TD\nsubgraph Parent\n${before ? `${connections}\n${declarations}` : `${declarations}\n${connections}`}\nend`,
      )
      expect(diagram.nodes.map((node) => node.id).sort()).toEqual(["A", "B", "C"])
      expect(diagram.subgraphs?.map((subgraph) => [subgraph.id, subgraph.nodeIds])).toEqual([
        ["Parent", ["C"]],
        ["Group", ["A"]],
        ["Other", ["B"]],
      ])
      expect(diagram.edges).toEqual([
        { from: "Group", to: "Other", label: "", ...(operator === "~~~" ? { orderOnly: true } : {}) },
        { from: "Other", to: "C", label: "", ...(operator === "~~~" ? { orderOnly: true } : {}) },
      ])
    }
  })

  test("removes explicitly labeled and standalone nodes that resolve to declared subgraphs", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart TD
  subgraph Parent
    Group[Temporary label] --> B
    Parent
    subgraph Group[Real group]
      Group
      A
    end
  end`)
    expect(diagram.nodes.map((node) => node.id)).toEqual(["B", "A"])
    expect(diagram.subgraphs?.map((subgraph) => [subgraph.id, subgraph.nodeIds])).toEqual([
      ["Parent", ["B"]],
      ["Group", ["A"]],
    ])
    expect(diagram.edges).toEqual([{ from: "Group", to: "B", label: "" }])
  })
})
