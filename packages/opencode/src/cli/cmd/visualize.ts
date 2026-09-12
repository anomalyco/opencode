import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { intro, select, isCancel, outro, log } from "@clack/prompts"
import open from "open"
import path from "path"
import os from "os"

interface VisualizeArgs {
  target?: string
  subject?: string
  target_dest?: string
  format?: string
  output?: string
  yes?: boolean
}

export const VisualizeCommand = effectCmd({
  command: "visualize [target] [subject]",
  describe: "visualize architecture, execution flows, schemas, or session context",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("target", {
        describe: "visualizer target: context, architecture, flow, schema, deps, state",
        type: "string",
      })
      .positional("subject", {
        describe: "specific module, function, or path to diagram (e.g. auth-pipeline, @models)",
        type: "string",
      })
      .option("dest", {
        alias: "t",
        describe: "rendering target destination: browser, terminal, ascii, file",
        type: "string",
        choices: ["browser", "terminal", "ascii", "file"],
      })
      .option("format", {
        alias: "f",
        describe: "diagram markup format: mermaid, ascii, svg, html",
        type: "string",
        choices: ["mermaid", "ascii", "svg", "html"],
        default: "mermaid",
      })
      .option("output", {
        alias: "o",
        describe: "output file path when saving to disk",
        type: "string",
      })
      .option("yes", {
        alias: "y",
        describe: "skip interactive confirmation prompt and render immediately",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.visualize")(function* (args) {
    const rawTarget = args.target ? String(args.target).toLowerCase() : ""
    const subject = args.subject ? String(args.subject) : ""

    const resolved = resolveTargetDiagram(rawTarget, subject)
    const explicitDest = args.dest ? String(args.dest).toLowerCase() : undefined

    let chosenDest = explicitDest
    if (!args.yes && !explicitDest) {
      UI.empty()
      intro(UI.Style.TEXT_HIGHLIGHT_BOLD + "OpenCode Visualizer" + UI.Style.TEXT_NORMAL)
      const promptResult = yield* Effect.promise(() =>
        select({
          message: `Would you like to visualize ${resolved.title}?`,
          options: [
            { label: "Open interactive diagram in browser (Mermaid canvas)", value: "browser" },
            { label: "Render Mermaid directly in terminal", value: "terminal" },
            { label: "Render Unicode / ASCII box-drawing graph", value: "ascii" },
            { label: "Export persistent file artifact", value: "file" },
            { label: "Skip (No)", value: "skip" },
          ],
        }),
      )

      if (isCancel(promptResult) || promptResult === "skip") {
        outro(UI.Style.TEXT_DIM + "Visualization cancelled." + UI.Style.TEXT_NORMAL)
        return
      }
      chosenDest = String(promptResult)
    }

    const finalDest = chosenDest || "browser"

    // When running in CLI, always generate the interactive HTML file and present as output to end user
    const artifactDir = path.join(process.cwd(), ".opencode", "artifacts")
    const fallbackDir = os.tmpdir()
    const hasPkg = yield* Effect.promise(() => Bun.file(path.join(process.cwd(), "package.json")).exists())
    const targetDir = hasPkg ? artifactDir : fallbackDir
    const htmlFile = path.join(targetDir, `visualize-${resolved.key}-${Date.now()}.html`)
    const htmlContent = buildInteractiveHtml(resolved.title, resolved.mermaid)

    yield* Effect.promise(() => Bun.write(htmlFile, htmlContent))
    const fileUri = "file:///" + htmlFile.replace(/\\/g, "/")

    if (finalDest === "browser") {
      UI.empty()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✔ " + UI.Style.TEXT_NORMAL + "Generated interactive HTML diagram")
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Output File:   " + UI.Style.TEXT_NORMAL + htmlFile)
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Browser View:  " + UI.Style.TEXT_NORMAL + fileUri)
      UI.empty()
      yield* Effect.promise(() => open(htmlFile).catch(() => { }))
      return
    }

    if (finalDest === "ascii") {
      UI.empty()
      UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + `── ${resolved.title} (ASCII / Unicode) ──` + UI.Style.TEXT_NORMAL)
      UI.empty()
      UI.println(resolved.ascii)
      UI.empty()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✔ " + UI.Style.TEXT_NORMAL + "Interactive HTML diagram presented:")
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Output File:   " + UI.Style.TEXT_NORMAL + htmlFile)
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Browser Link:  " + UI.Style.TEXT_NORMAL + fileUri)
      UI.empty()
      return
    }

    if (finalDest === "file") {
      const outputPath = args.output || path.join("docs", "diagrams", `${resolved.key}.mmd`)
      yield* Effect.promise(() => Bun.write(outputPath, resolved.mermaid))
      UI.empty()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✔ " + UI.Style.TEXT_NORMAL + "Saved diagram artifact: " + outputPath)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✔ " + UI.Style.TEXT_NORMAL + "Interactive HTML diagram presented:")
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Output File:   " + UI.Style.TEXT_NORMAL + htmlFile)
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Browser Link:  " + UI.Style.TEXT_NORMAL + fileUri)
      UI.empty()
      return
    }

    // Inline terminal
    UI.empty()
    UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + `── ${resolved.title} (Mermaid) ──` + UI.Style.TEXT_NORMAL)
    UI.println("```mermaid")
    UI.println(resolved.mermaid)
    UI.println("```")
    UI.empty()
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✔ " + UI.Style.TEXT_NORMAL + "Interactive HTML diagram presented:")
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Output File:   " + UI.Style.TEXT_NORMAL + htmlFile)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Browser Link:  " + UI.Style.TEXT_NORMAL + fileUri)
    UI.empty()
  }),
})

export interface DiagramPayload {
  key: string
  title: string
  mermaid: string
  ascii: string
}

export function resolveTargetDiagram(target: string, subject: string): DiagramPayload {
  if (target === "context" || target === "system-context") {
    return {
      key: "context",
      title: "OpenCode Session Runtime & System Context",
      mermaid: `flowchart TD
    subgraph Sources["Context Sources (Location-Scoped)"]
        S1["Instruction Context (AGENTS.md, Rules)"]
        S2["Skills & Custom Guidance"]
        S3["Tools & Location Registry"]
        S4["Environment & Git Metadata"]
    end

    subgraph Registry["System Context Registry"]
        SCR["Location-Scoped Registry"]
    end

    subgraph SessionRuntime["Session Execution Engine"]
        EP["Context Epoch (Immutable Cache Baseline)"]
        DIFF["Safe Provider-Turn Boundary Check"]
        MID["Mid-Conversation System Message"]
        HIST["Session History (Promoted Inputs + Messages)"]
    end

    subgraph ProviderTurn["Model Execution"]
        LLM["Provider Turn (LLM Stream)"]
        DRAIN["Session Drain (Process-Local)"]
    end

    Sources --> SCR
    SCR --> EP
    EP --> DIFF
    DIFF -->|Context Changed| MID
    MID --> HIST
    DIFF -->|No Change| HIST
    HIST --> LLM
    LLM --> DRAIN`,
      ascii: `┌─────────────────────────────────────────────────────────────┐
│                   CONTEXT SOURCES                           │
│  [AGENTS.md]  [Skills & Plugins]  [Tools]  [Environment]    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 SYSTEM CONTEXT REGISTRY                     │
│  Assembles stable-keyed scoped context contributions        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             CONTEXT EPOCH (Provider Cache Baseline)         │
│  Maintains immutable baseline until session compaction      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                 [Safe Provider-Turn Boundary]
                ┌──────────────┴─────────────┐
                │ Changed?                   │
                ▼ (Yes)                      ▼ (No)
   ┌──────────────────────────┐    ┌──────────────────────────┐
   │ Mid-Conversation Message │    │ Existing Baseline Cached │
   └────────────┬─────────────┘    └─────────────┬────────────┘
                └──────────────┬─────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             SESSION HISTORY & PROVIDER TURN                 │
│  llm.stream(request) ──► Model Tool Output ──► Next Turn    │
└─────────────────────────────────────────────────────────────┘`,
    }
  }

  if (target === "architecture") {
    return {
      key: "architecture",
      title: "OpenCode System Architecture Topology",
      mermaid: `flowchart TD
    subgraph ClientLayer["Presentation & Clients"]
        TUI["OpenCode TUI (@opencode-ai/tui)"]
        CLI["OpenCode CLI (packages/opencode)"]
        WEB["OpenCode Web / Desktop"]
        SDK["SDK & Generated Client"]
    end

    subgraph ServerLayer["Server & Network"]
        SERVER["HttpApi Server (@opencode-ai/server)"]
        ROUTER["Router & In-Memory Transport"]
    end

    subgraph CoreLayer["Runtime Core (@opencode-ai/core)"]
        SESSION["SessionV2 & Execution Coordinator"]
        SYSCTX["System Context & Sources"]
        PLUGIN["Plugin & Command Host"]
        STORE["Session & Database Store (SQLite)"]
    end

    subgraph ProtocolLayer["Protocols & Contracts"]
        PROTO["@opencode-ai/protocol"]
        SCHEMA["@opencode-ai/schema"]
    end

    TUI --> CLI
    CLI --> SERVER
    WEB --> SERVER
    SDK --> PROTO
    SERVER --> CoreLayer
    CoreLayer --> ProtocolLayer`,
      ascii: `┌─────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                      │
│   [OpenCode TUI]      [OpenCode CLI]      [Desktop / Web]   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 SERVER & PROTOCOL ADAPTERS                  │
│       HttpApi Server  ──  Generated Client Transport        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     CORE RUNTIME ENGINE                     │
│   Session Execution  │  System Context  │  Plugin Host      │
│   Durable Storage    │  Tool Registry   │  Location Scope   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     SCHEMA & PROTOCOLS                      │
│            Drizzle ORM Tables  │  Effect Schema             │
└─────────────────────────────────────────────────────────────┘`,
    }
  }

  if (target === "schema") {
    return {
      key: "schema",
      title: "Data Models & Schema Relationships (ERD)",
      mermaid: `erDiagram
    PROJECT ||--o{ SESSION : owns
    SESSION ||--o{ MESSAGE : contains
    SESSION ||--o{ SESSION_INPUT : queues
    SESSION ||--o{ CONTEXT_EPOCH : tracks
    MESSAGE ||--o{ MESSAGE_PART : composed_of

    PROJECT {
        string id PK
        string directory
        integer created_at
    }
    SESSION {
        string id PK
        string project_id FK
        string location
        integer created_at
    }
    SESSION_INPUT {
        string id PK
        string session_id FK
        string mode
        string content
    }
    MESSAGE {
        string id PK
        string session_id FK
        string role
        integer sequence
    }
    MESSAGE_PART {
        string id PK
        string message_id FK
        string type
        string text
    }`,
      ascii: `┌──────────────┐          1..n ┌──────────────┐
│   PROJECT    │ ───────────── │   SESSION    │
│  id (PK)     │               │  id (PK)     │
│  directory   │               │  project_id  │
└──────────────┘               └──────┬───────┘
                                      │ 1..n
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  SESSION_INPUT   │         │     MESSAGE      │         │  CONTEXT_EPOCH   │
│  id (PK)         │         │  id (PK)         │         │  id (PK)         │
│  mode (admitted) │         │  role            │         │  snapshot_json   │
└──────────────────┘         └────────┬─────────┘         └──────────────────┘
                                      │ 1..n
                                      ▼
                             ┌──────────────────┐
                             │   MESSAGE_PART   │
                             │  id (PK)         │
                             │  type, content   │
                             └──────────────────┘`,
    }
  }

  if (target === "flow") {
    const flowTitle = subject ? `Execution Flow: ${subject}` : "Prompt Admission & Execution Flow"
    return {
      key: "flow",
      title: flowTitle,
      mermaid: `sequenceDiagram
    autonumber
    actor Dev as Developer
    participant Inbox as Durable Session Inbox
    participant Coord as SessionRunCoordinator
    participant Runner as Location SessionRunner
    participant LLM as Provider Turn (Stream)

    Dev->>Inbox: Submit Prompt (SessionV2.prompt)
    Inbox->>Coord: Advisory Wake (SessionExecution.wake)
    Coord->>Runner: Coordinate Placement & Lock
    Runner->>Runner: Safe Provider-Turn Boundary Check
    Runner->>LLM: Stream Provider Request (llm.stream)
    LLM-->>Runner: Yield Response Chunks & Tool Calls
    Runner-->>Dev: Real-time TUI Projection
    Runner->>Inbox: Durable Completion & State Update`,
      ascii: `Developer           Durable Inbox       Coordinator         SessionRunner       LLM Provider
    │                    │                   │                   │                   │
    ├─ 1. Submit Prompt ─►                   │                   │                   │
    │                    ├─ 2. Advisory Wake─►                   │                   │
    │                    │                   ├─ 3. Acquire Lock ─►                   │
    │                    │                   │                   ├─ 4. Boundary Check│
    │                    │                   │                   ├─ 5. llm.stream ───►
    │                    │                   │                   │                   │
    │                    │                   │                   │◄── 6. Stream Chunk─┤
    │◄── 7. Projected UI ────────────────────────────────────────┤                   │
    │                    │                   │                   │                   │
    │                    │                   │                   ├─ 8. Settle Tools ─┤
    │                    │◄── 9. State Saved ────────────────────┤                   │`,
    }
  }

  if (target === "deps") {
    return {
      key: "deps",
      title: "Workspace Package Dependency Graph",
      mermaid: `flowchart LR
    CLI["packages/opencode"]
    TUI["packages/tui"]
    SERVER["packages/server"]
    CORE["packages/core"]
    PROTO["packages/protocol"]
    SCHEMA["packages/schema"]

    CLI --> SERVER
    TUI --> CLI
    SERVER --> CORE
    SERVER --> PROTO
    CORE --> PROTO
    CORE --> SCHEMA
    PROTO --> SCHEMA`,
      ascii: `[packages/tui] ──► [packages/opencode] ──► [packages/server]
                                                        │
                                                        ▼
                                                [packages/core]
                                                        │
                                      ┌─────────────────┴─────────────────┐
                                      ▼                                   ▼
                            [packages/protocol] ────────────────► [packages/schema]`,
    }
  }

  if (target === "state") {
    return {
      key: "state",
      title: "Session Execution & Drain State Machine",
      mermaid: `stateDiagram-v2
    [*] --> Idle
    Idle --> AdmittingPrompt : User Input Received
    AdmittingPrompt --> PendingInInbox : Durable Row Persisted
    PendingInInbox --> RunningDrain : Advisory Wakeup
    RunningDrain --> EvaluatingBoundary : Next Provider Turn
    EvaluatingBoundary --> StreamingResponse : Boundary Safe
    StreamingResponse --> SettlingTools : Tool Call Requested
    SettlingTools --> EvaluatingBoundary : Tool Output Ready
    StreamingResponse --> RunningDrain : Turn Complete
    RunningDrain --> Idle : Inbox Drained & Complete
    RunningDrain --> Interrupted : User Interrupt
    Interrupted --> Idle : Reset Ownership Chain`,
      ascii: `     [*]
      │
      ▼
┌───────────┐      Input       ┌──────────────────┐
│   Idle    ├─────────────────►│ Admitting Prompt │
└─────▲─────┘                  └────────┬─────────┘
      │                                 │
      │ All Drained                     ▼
┌─────┴──────────┐   Wakeup    ┌──────────────────┐
│  Running Drain │◄────────────┤ Pending In Inbox │
└─────┬──────────┘             └──────────────────┘
      │
      ├───────────────────────┬────────────────────────┐
      ▼                       ▼                        ▼
┌───────────┐           ┌───────────┐            ┌───────────┐
│ Streaming │           │ Settling  │            │ Interupt  │
│ Response  │           │   Tools   │            │  Chain    │
└───────────┘           └───────────┘            └───────────┘`,
    }
  }

  // Default: inspect git status / context
  const diffResult = Bun.spawnSync(["git", "status", "--short"], { stdout: "pipe" })
  const statusText = diffResult.stdout.toString().trim()

  if (statusText.length > 0) {
    const lines = statusText.split("\n").slice(0, 8)
    const formattedFiles = lines
      .map((l, i) => `        F${i}["${l.trim().replace(/["\\]/g, "")}"]`)
      .join("\n")

    return {
      key: "diff-impact",
      title: "Current Working Tree Change Impact",
      mermaid: `flowchart TD
    subgraph WorkingTree["Active Modified Files"]
${formattedFiles}
    end

    subgraph Impact["Validation & Pipeline Impact"]
        TYPE["Typecheck (bun typecheck)"]
        TEST["Test Suite (bun test)"]
        RUNTIME["Runtime & TUI Behavior"]
    end

    WorkingTree --> TYPE
    WorkingTree --> TEST
    TYPE --> RUNTIME
    TEST --> RUNTIME`,
      ascii: `┌─────────────────────────────────────────────────────────────┐
│                ACTIVE WORKING TREE CHANGES                  │
│${lines.map((l) => "  " + l.trim()).join("\n")}
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 VERIFICATION & IMPACT CHAIN                 │
│       bun typecheck  ──►  bun test  ──►  Runtime / TUI      │
└─────────────────────────────────────────────────────────────┘`,
    }
  }

  // If clean, default to OpenCode System Context
  return resolveTargetDiagram("context", "")
}

export function buildInteractiveHtml(title: string, mermaidCode: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} - OpenCode Visualizer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    :root {
      --bg: #121214;
      --panel: #18181b;
      --border: #27272a;
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 10;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .badge {
      background: rgba(99, 102, 241, 0.15);
      color: #818cf8;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid rgba(99, 102, 241, 0.3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    h1 {
      font-size: 16px;
      font-weight: 600;
    }
    .controls {
      display: flex;
      gap: 8px;
    }
    button {
      background: #27272a;
      color: var(--text);
      border: 1px solid #3f3f46;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    button:hover {
      background: #3f3f46;
      border-color: #52525b;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
    }
    button.primary:hover {
      background: var(--accent-hover);
    }
    #viewport {
      flex: 1;
      overflow: hidden;
      position: relative;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at center, #18181b 0%, #121214 100%);
    }
    #viewport:active {
      cursor: grabbing;
    }
    #canvas {
      transform-origin: center center;
      transition: transform 0.05s ease-out;
      display: inline-block;
      padding: 40px;
    }
    .mermaid {
      display: flex;
      justify-content: center;
    }
    footer {
      background: var(--panel);
      border-top: 1px solid var(--border);
      padding: 8px 24px;
      font-size: 12px;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="badge">OpenCode</span>
      <h1>${escapeHtml(title)}</h1>
    </div>
    <div class="controls">
      <button onclick="zoomIn()">Zoom In (+)</button>
      <button onclick="zoomOut()">Zoom Out (-)</button>
      <button onclick="resetZoom()">Reset</button>
      <button class="primary" onclick="downloadSvg()">Download SVG</button>
    </div>
  </header>

  <div id="viewport">
    <div id="canvas">
      <div class="mermaid">
${mermaidCode}
      </div>
    </div>
  </div>

  <footer>
    <span>Tip: Click and drag to pan • Scroll to zoom</span>
    <span>Rendered with Mermaid.js</span>
  </footer>

  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#18181b',
        primaryColor: '#312e81',
        primaryTextColor: '#f4f4f5',
        primaryBorderColor: '#6366f1',
        lineColor: '#6366f1',
        secondaryColor: '#27272a',
        tertiaryColor: '#18181b'
      },
      flowchart: { curve: 'basis' }
    });

    let scale = 1;
    let pointX = 0;
    let pointY = 0;
    let startX = 0;
    let startY = 0;
    let isPanning = false;
    const canvas = document.getElementById('canvas');
    const viewport = document.getElementById('viewport');

    function updateTransform() {
      canvas.style.transform = "translate(" + pointX + "px, " + pointY + "px) scale(" + scale + ")";
    }

    function zoomIn() {
      scale = Math.min(scale * 1.25, 4);
      updateTransform();
    }

    function zoomOut() {
      scale = Math.max(scale * 0.8, 0.25);
      updateTransform();
    }

    function resetZoom() {
      scale = 1;
      pointX = 0;
      pointY = 0;
      updateTransform();
    }

    viewport.addEventListener('mousedown', (e) => {
      isPanning = true;
      startX = e.clientX - pointX;
      startY = e.clientY - pointY;
    });

    window.addEventListener('mouseup', () => {
      isPanning = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      pointX = e.clientX - startX;
      pointY = e.clientY - startY;
      updateTransform();
    });

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const xs = (e.clientX - pointX) / scale;
      const ys = (e.clientY - pointY) / scale;
      const delta = -e.deltaY;
      if (delta > 0) {
        scale = Math.min(scale * 1.15, 4);
      } else {
        scale = Math.max(scale * 0.85, 0.25);
      }
      pointX = e.clientX - xs * scale;
      pointY = e.clientY - ys * scale;
      updateTransform();
    });

    function downloadSvg() {
      const svg = document.querySelector('.mermaid svg');
      if (!svg) return;
      const serializer = new XMLSerializer();
      const source = serializer.serializeToString(svg);
      const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'opencode-diagram.svg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

