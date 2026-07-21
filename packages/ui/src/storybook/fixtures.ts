export const diff = {
  before: {
    name: "src/greet.ts",
    contents: `export function greet(name: string) {
  return \`Hello, \${name}!\`
}
`,
  },
  after: {
    name: "src/greet.ts",
    contents: `export function greet(name: string, excited = false) {
  const message = \`Hello, \${name}!\`
  return excited ? \`\${message}!!\` : message
}
`,
  },
}

export const code = {
  name: "src/calc.ts",
  contents: `export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

export function average(values: number[]) {
  if (values.length === 0) return 0
  return sum(values) / values.length
}
`,
}

export const markdown = [
  "# Markdown",
  "",
  "Use **Markdown** for rich text.",
  "",
  "## Highlights",
  "- Headings, lists, and code blocks",
  "- Inline `code` and links",
  "",
  "```ts",
  "export const value = 42",
  "```",
  "",
  "## Diagram",
  "Mermaid code blocks render as charts:",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Prompt] --> B{Streaming?}",
  "  B -->|Yes| C[Show source]",
  "  B -->|No| D[Render diagram]",
  "```",
  "",
  "More at https://example.com/docs",
].join("\n")

export const changes = {
  additions: 18,
  deletions: 6,
}

// One minimal flowchart exercising every node shape, edge style, and grouping construct,
// used to tune per-shape diagram coloring.
export const mermaidShapes = [
  "```mermaid",
  "flowchart TD",
  "  A([Start]) --> B[Process]",
  "  B --> C{Decision?}",
  "  C -->|yes| D[/Input/]",
  "  C -->|no| E[[Subroutine]]",
  "  C -->|maybe| M[Manual review]:::warning",
  "  D --> F[(Database)]",
  "  E -.-> G((Circle))",
  "  F ==> H{{Hexagon}}",
  "  subgraph Group",
  "    I[Task one] --> J[Task two]",
  "  end",
  "  H --> I",
  "  G --> K[\\Output\\]",
  "  J --> L(((Done)))",
  "  K --> L",
  "```",
].join("\n")
