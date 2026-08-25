import type { FlowchartDirection } from "../../flowchart/types.js"
import type { StateDiagramDirection } from "../../state/types.js"

export type LayoutFixture = {
  id: string
  kind: "flowchart" | "state"
  family: string
  profile: LabelProfile
  source: string
  curated?: boolean
}

type LabelProfile = "short" | "long" | "unicode"

const flowVariants = [
  ["TB", "short"],
  ["TD", "long"],
  ["BT", "unicode"],
  ["LR", "short"],
  ["RL", "long"],
  ["TB", "unicode"],
  ["TD", "short"],
  ["BT", "long"],
  ["LR", "unicode"],
  ["RL", "short"],
  ["LR", "long"],
  ["TD", "unicode"],
  ["TB", "long"],
  ["BT", "short"],
  ["RL", "unicode"],
] as const satisfies readonly (readonly [FlowchartDirection, LabelProfile])[]

const stateVariants = [
  ["TB", "short"],
  ["TD", "long"],
  ["LR", "unicode"],
  ["RL", "short"],
  ["TB", "long"],
  ["TD", "unicode"],
  ["LR", "short"],
  ["RL", "long"],
  ["LR", "long"],
  ["TD", "short"],
  ["TB", "unicode"],
  ["RL", "unicode"],
  ["BT", "short"],
  ["BT", "long"],
  ["BT", "unicode"],
] as const satisfies readonly (readonly [StateDiagramDirection, LabelProfile])[]

function nodeLabel(id: string, profile: LabelProfile): string {
  if (profile === "long") return `${id} deliberate deployment stage with a long descriptive label`
  if (profile === "unicode") return `${id} 東京<br/>résumé 🚀`
  return `${id} node`
}

function edgeLabel(id: string, profile: LabelProfile): string {
  if (profile === "long") return `${id} transition carrying detailed deployment context`
  if (profile === "unicode") return `${id} 東京<br/>✓ prêt`
  return `${id} edge`
}

function flowNode(id: string, profile: LabelProfile): string {
  return `  ${id}["${nodeLabel(id, profile)}"]`
}

function flowEdge(from: string, to: string, id: string, profile: LabelProfile): string {
  return `  ${from} -->|"${edgeLabel(id, profile)}"| ${to}`
}

function flowSource(
  direction: FlowchartDirection,
  profile: LabelProfile,
  nodes: readonly string[],
  edges: readonly [from: string, to: string, id: string][],
  extra: readonly string[] = [],
): string {
  return [
    `flowchart ${direction}`,
    ...nodes.map((id) => flowNode(id, profile)),
    ...extra,
    ...edges.map(([from, to, id]) => flowEdge(from, to, id, profile)),
  ].join("\n")
}

const flowFamilies = {
  chain(direction: FlowchartDirection, profile: LabelProfile) {
    return flowSource(
      direction,
      profile,
      ["A", "B", "C", "D", "E", "F"],
      [
        ["A", "B", "E01"],
        ["B", "C", "E02"],
        ["C", "D", "E03"],
        ["D", "E", "E04"],
        ["E", "F", "E05"],
      ],
    )
  },
  fork(direction: FlowchartDirection, profile: LabelProfile) {
    return flowSource(
      direction,
      profile,
      ["A", "B", "C", "D", "E"],
      [
        ["A", "B", "E01"],
        ["A", "C", "E02"],
        ["A", "D", "E03"],
        ["A", "E", "E04"],
      ],
    )
  },
  join(direction: FlowchartDirection, profile: LabelProfile) {
    return flowSource(
      direction,
      profile,
      ["A", "B", "C", "D", "E"],
      [
        ["A", "E", "E01"],
        ["B", "E", "E02"],
        ["C", "E", "E03"],
        ["D", "E", "E04"],
      ],
    )
  },
  cycle(direction: FlowchartDirection, profile: LabelProfile) {
    return flowSource(
      direction,
      profile,
      ["A", "B", "C", "D"],
      [
        ["A", "B", "E01"],
        ["B", "C", "E02"],
        ["C", "D", "E03"],
        ["D", "A", "E04"],
        ["C", "A", "E05"],
      ],
    )
  },
  crossing(direction: FlowchartDirection, profile: LabelProfile) {
    return flowSource(
      direction,
      profile,
      ["A", "B", "C", "D", "E", "F"],
      [
        ["A", "C", "E01"],
        ["A", "D", "E02"],
        ["B", "C", "E03"],
        ["B", "D", "E04"],
        ["C", "E", "E05"],
        ["D", "F", "E06"],
      ],
    )
  },
  parallel(direction: FlowchartDirection, profile: LabelProfile) {
    return flowSource(
      direction,
      profile,
      ["A", "B", "C"],
      [
        ["A", "B", "E01"],
        ["A", "B", "E02"],
        ["A", "B", "E03"],
        ["B", "C", "E04"],
        ["B", "C", "E05"],
      ],
    )
  },
  self(direction: FlowchartDirection, profile: LabelProfile) {
    return flowSource(
      direction,
      profile,
      ["A", "B", "C"],
      [
        ["A", "A", "E01"],
        ["A", "B", "E02"],
        ["B", "B", "E03"],
        ["B", "C", "E04"],
      ],
    )
  },
  subgraph(direction: FlowchartDirection, profile: LabelProfile) {
    return [
      `flowchart ${direction}`,
      `  subgraph Left["Left ${nodeLabel("SG1", profile)}"]`,
      flowNode("A", profile),
      flowNode("B", profile),
      "  end",
      `  subgraph Right["Right ${nodeLabel("SG2", profile)}"]`,
      flowNode("C", profile),
      flowNode("D", profile),
      "  end",
      flowEdge("A", "B", "E01", profile),
      flowEdge("A", "C", "E02", profile),
      flowEdge("B", "D", "E03", profile),
      flowEdge("C", "D", "E04", profile),
    ].join("\n")
  },
  "nested-subgraph"(direction: FlowchartDirection, profile: LabelProfile) {
    const local = direction === "LR" || direction === "RL" ? "TB" : "LR"
    return [
      `flowchart ${direction}`,
      `  subgraph Outer["Outer ${nodeLabel("SG1", profile)}"]`,
      `    direction ${local}`,
      `    subgraph Inner["Inner ${nodeLabel("SG2", profile)}"]`,
      flowNode("A", profile),
      flowNode("B", profile),
      "    end",
      flowNode("C", profile),
      "  end",
      flowNode("D", profile),
      flowEdge("A", "B", "E01", profile),
      flowEdge("A", "C", "E02", profile),
      flowEdge("B", "D", "E03", profile),
      flowEdge("C", "D", "E04", profile),
    ].join("\n")
  },
} satisfies Record<string, (direction: FlowchartDirection, profile: LabelProfile) => string>

function stateDeclaration(id: string, profile: LabelProfile, indent = "  "): string {
  return `${indent}state "${nodeLabel(id, profile)}" as ${id}`
}

function stateTransition(from: string, to: string, id: string, profile: LabelProfile, indent = "  "): string {
  return `${indent}${from} --> ${to}: ${edgeLabel(id, profile)}`
}

function stateSource(
  direction: StateDiagramDirection,
  profile: LabelProfile,
  states: readonly string[],
  transitions: readonly [from: string, to: string, id: string][],
  extra: readonly string[] = [],
): string {
  return [
    "stateDiagram-v2",
    `  direction ${direction}`,
    ...states.map((id) => stateDeclaration(id, profile)),
    ...extra,
    ...transitions.map(([from, to, id]) => stateTransition(from, to, id, profile)),
  ].join("\n")
}

const stateFamilies = {
  chain(direction: StateDiagramDirection, profile: LabelProfile) {
    return stateSource(
      direction,
      profile,
      ["A", "B", "C", "D", "E"],
      [
        ["A", "B", "E01"],
        ["B", "C", "E02"],
        ["C", "D", "E03"],
        ["D", "E", "E04"],
      ],
      ["  [*] --> A", "  E --> [*]"],
    )
  },
  fork(direction: StateDiagramDirection, profile: LabelProfile) {
    return stateSource(
      direction,
      profile,
      ["A", "B", "C", "D"],
      [
        ["A", "B", "E01"],
        ["A", "C", "E02"],
        ["A", "D", "E03"],
      ],
    )
  },
  join(direction: StateDiagramDirection, profile: LabelProfile) {
    return stateSource(
      direction,
      profile,
      ["A", "B", "C", "D"],
      [
        ["A", "D", "E01"],
        ["B", "D", "E02"],
        ["C", "D", "E03"],
      ],
    )
  },
  cycle(direction: StateDiagramDirection, profile: LabelProfile) {
    return stateSource(
      direction,
      profile,
      ["A", "B", "C", "D"],
      [
        ["A", "B", "E01"],
        ["B", "C", "E02"],
        ["C", "D", "E03"],
        ["D", "A", "E04"],
        ["C", "A", "E05"],
      ],
    )
  },
  crossing(direction: StateDiagramDirection, profile: LabelProfile) {
    return stateSource(
      direction,
      profile,
      ["A", "B", "C", "D"],
      [
        ["A", "C", "E01"],
        ["A", "D", "E02"],
        ["B", "C", "E03"],
        ["B", "D", "E04"],
      ],
    )
  },
  parallel(direction: StateDiagramDirection, profile: LabelProfile) {
    return stateSource(
      direction,
      profile,
      ["A", "B", "C"],
      [
        ["A", "B", "E01"],
        ["A", "B", "E02"],
        ["A", "B", "E03"],
        ["B", "C", "E04"],
      ],
    )
  },
  self(direction: StateDiagramDirection, profile: LabelProfile) {
    return stateSource(
      direction,
      profile,
      ["A", "B", "C"],
      [
        ["A", "A", "E01"],
        ["A", "B", "E02"],
        ["B", "B", "E03"],
        ["B", "C", "E04"],
      ],
    )
  },
  choice(direction: StateDiagramDirection, profile: LabelProfile) {
    return stateSource(
      direction,
      profile,
      ["A", "B", "C"],
      [
        ["A", "Choice", "E01"],
        ["Choice", "B", "E02"],
        ["Choice", "C", "E03"],
        ["C", "A", "E04"],
      ],
      ["  state Choice <<choice>>"],
    )
  },
  notes(direction: StateDiagramDirection, profile: LabelProfile) {
    return stateSource(
      direction,
      profile,
      ["A", "B", "C"],
      [
        ["A", "B", "E01"],
        ["B", "C", "E02"],
        ["C", "A", "E03"],
      ],
      [
        `  note left of A: ${edgeLabel("N01", profile)}`,
        `  note right of B: ${edgeLabel("N02", profile)}`,
        `  note right of C: ${edgeLabel("N03", profile)}`,
      ],
    )
  },
  composite(direction: StateDiagramDirection, profile: LabelProfile) {
    return [
      "stateDiagram-v2",
      `  direction ${direction}`,
      `  state "${nodeLabel("Outer", profile)}" as Outer {`,
      stateDeclaration("A", profile, "    "),
      stateDeclaration("B", profile, "    "),
      "    [*] --> A",
      stateTransition("A", "B", "E01", profile, "    "),
      "    B --> [*]",
      "  }",
      stateDeclaration("Done", profile),
      stateTransition("Outer", "Done", "E02", profile),
      `  note right of B: ${edgeLabel("N01", profile)}`,
    ].join("\n")
  },
  "nested-composite"(direction: StateDiagramDirection, profile: LabelProfile) {
    return [
      "stateDiagram-v2",
      `  direction ${direction}`,
      `  state "${nodeLabel("Session", profile)}" as Session {`,
      "    [*] --> Open",
      `    state "${nodeLabel("Open", profile)}" as Open {`,
      stateDeclaration("Clean", profile, "      "),
      stateDeclaration("Dirty", profile, "      "),
      "      [*] --> Clean",
      stateTransition("Clean", "Dirty", "E01", profile, "      "),
      stateTransition("Dirty", "Clean", "E02", profile, "      "),
      "      Dirty --> [*]",
      "    }",
      "    Open --> [*]",
      "  }",
      stateDeclaration("Done", profile),
      stateTransition("Session", "Done", "E03", profile),
      `  note right of Dirty: ${edgeLabel("N01", profile)}`,
    ].join("\n")
  },
} satisfies Record<string, (direction: StateDiagramDirection, profile: LabelProfile) => string>

export const deploymentArchitectureSource = `flowchart LR
    Client[OpenCode client]

    subgraph CF[Cloudflare]
      DNS[opencode.ai]
      Web[Console frontend Worker]
      Proxy[Console API proxy Worker]
      Infer[inference-next Worker]
      KV[Model registry KV]
      Redis[Upstash Redis]
      Logs[Axiom / Cloudflare logs]
      Lake[Pipeline to R2 data lake]
    end

    subgraph AWS[AWS]
      EKS[EKS cluster]
      API[Console API pod<br/>1 replica]
      OTEL[OTel collector]
      ECR[ECR]
    end

    DB[(PlanetScale)]
    Models[Anthropic / OpenAI / other providers]

    Client -->|/inference/*| DNS --> Infer
    Client -->|/console/*| DNS --> Web
    Web -->|/console/api, /auth, etc.| Proxy
    Proxy -->|Cloudflare VPC service| API

    Infer -->|public DATABASE_URL| DB
    Infer --> KV
    Infer --> Redis
    Infer --> Models
    Infer --> Logs
    Infer --> Lake

    API -->|private DATABASE_AWS_URL| DB
    API --> OTEL
    ECR --> API`

export function layoutFixtures(): readonly LayoutFixture[] {
  const flowcharts = Object.entries(flowFamilies).flatMap(([family, source]) =>
    flowVariants.map(([direction, profile]) => ({
      id: `flowchart/${family}/${direction.toLowerCase()}-${profile}`,
      kind: "flowchart" as const,
      family,
      profile,
      source: source(direction, profile),
    })),
  )
  const states = Object.entries(stateFamilies).flatMap(([family, source]) =>
    stateVariants.map(([direction, profile]) => ({
      id: `state/${family}/${direction.toLowerCase()}-${profile}`,
      kind: "state" as const,
      family,
      profile,
      source: source(direction, profile),
    })),
  )
  return [
    ...flowcharts,
    {
      id: "flowchart/deployment-architecture/curated",
      kind: "flowchart" as const,
      family: "deployment-architecture",
      profile: "short" as const,
      source: deploymentArchitectureSource,
      curated: true,
    },
    {
      id: "flowchart/grouped-fanout/curated",
      kind: "flowchart" as const,
      family: "grouped-fanout",
      profile: "short" as const,
      source: `flowchart TD
  subgraph Group
    S[Source]
    S -->|route 0 detail| N0[Node 0]
    S -->|route 1 detail| N1[Node 1]
    S -->|route 2 detail| N2[Node 2]
    S -->|route 3 detail| N3[Node 3]
  end`,
      curated: true,
    },
    ...states,
  ]
}
