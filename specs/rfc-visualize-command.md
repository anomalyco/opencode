# RFC: `/visualize` Command & Interactive Confirmation Loop

- **Author**: Feature Proposal
- **Target**: `anomalyco/opencode` (TUI, Core, Commands)
- **Status**: Draft / Proposed

---

## 1. Problem Statement

Textual explanations of complex workflows, distributed pipelines, and schemas often overload the terminal context and dramatically increase cognitive load. Conversely, blindly dumping massive ASCII schemas or 150+ lines of raw Mermaid markup into the terminal when a developer only needed a quick summary produces distracting noise and scroll fatigue.

In CLI and TUI coding agents, developers face an all-or-nothing dichotomy:
- **Wall of prose**: Difficulty conceptualizing complex multi-service flows, state machine transitions, or database relationships.
- **Unsolicited markup dumps**: Terminal clutter when raw diagram syntax is emitted without checking user intent or terminal capabilities.

## 2. Proposed Solution

Introduce a native `/visualize` command paired with an **ambient, intent-aware confirmation loop**.

1. **Explicit Invocation (`/visualize`)**: Direct command execution by the user with flexible targets (e.g. `/visualize architecture`, `/visualize flow <module>`, `/visualize schema <path>`).
2. **Ambient Proactive Confirmation**: When standard conversations detect multi-hop routing, high-cardinality state transitions, or relational schemas, the agent offers a non-intrusive interactive confirmation prompt before rendering.
3. **Multi-Target Rendering**: Flexible outputs supporting inline terminal Mermaid, clean Unicode/ASCII flowcharts, browser-based interactive canvas (zoom/pan), or persistent committed file artifacts.

---

## 3. Workflow Specification

```mermaid
flowchart TD
    A[Invocation] -->|Explicit /visualize| B[Inspect Target / Diff / Context]
    A -->|Proactive Agent Detection| B
    B --> C{Flags Provided?}
    C -->|--help / -h| D[Display visualizer manual & exit]
    C -->|--yes / -y or direct target| E[Render Diagram to Target]
    C -->|No explicit flags| F["Interactive Confirmation Picker
    [1] Browser Canvas
    [2] Terminal Mermaid
    [3] ASCII Box-Drawing
    [4] File Artifact
    [5] Skip"]
    F -->|Option [1]| G[Open Ephemeral Browser View]
    F -->|Option [2]| H[Inline Mermaid Block in TUI]
    F -->|Option [3]| I[Inline Unicode/ASCII Graph]
    F -->|Option [4]| J[Write .mmd / .svg File]
    F -->|Option [5]| K[Abort / Continue Chat]
```

### Step 1: Context & Entity Detection
- For explicit invocations: Agent scans specified modules, ORM models, or git diffs.
- For ambient triggers: Triggered only when cardinality threshold is reached (e.g., ≥3 services interacting, ≥4 state transitions, or ≥3 relational models).

### Step 2: Interactive Terminal Confirmation Picker
The agent prompts the user with an interactive terminal selection:
```text
Would you like to visualize this flow?
> [1] Open interactive sequence diagram (Browser)
  [2] Render Mermaid directly in terminal
  [3] Render Unicode / ASCII graph
  [4] Export persistent file artifact
  [5] Skip (No)
```

### Step 3: Destination Dispatch
- **Browser Popout**: Spins up an ephemeral local server (`http://localhost:<port>`) or creates a self-contained HTML artifact opened via the default browser (`open` / `xdg-open` / `start`). Uses Mermaid.js or D3 with dark-mode aesthetic, pan/zoom, and SVG export.
- **Terminal Mermaid**: Renders ````mermaid ... ```` directly in the TUI stream for terminals with native markdown/diagram support.
- **Unicode/ASCII**: Renders box-drawing flowcharts using standard Unicode glyphs (`┌─┐`, `└─┘`, `│`, `▼`, `──►`).
- **File Artifact**: Writes diagram source or SVG directly to disk (e.g., `docs/diagrams/auth-pipeline.mmd`).

---

## 4. Supported Diagram Types & Heuristics

| Diagram Type | Best Trigger Context | Primary Target |
| :--- | :--- | :--- |
| **Sequence Diagram** | Multi-service calls, async message passing, auth flows | Trace execution across services or functions |
| **Entity Relationship (ERD)** | DB migrations, ORM schemas, type definitions | Visualizing table relations and foreign keys |
| **Dependency / Import Graph** | Refactoring, circular dependency checks | Package/module hierarchy and blast radius |
| **State Machine Diagram** | Finite state machines, checkout/order lifecycles | Visualizing states, transitions, and edge cases |

---

## 5. Implementation Strategy

1. **Phase 1 (Custom Command)**:
   - Shipped via `.opencode/command/visualize.md` (or `.opencode/commands/visualize.md`).
   - Supports `$ARGUMENTS`, parsing `--help`, targets (`architecture`, `flow`, `schema`, `deps`, `state`), and output formats.
2. **Phase 2 (Core / TUI Integration)**:
   - Register `/visualize` as a first-class built-in command in `@opencode-ai/core/plugin/command.ts`.
   - Add native TUI component for interactive single-key selection `[1-5]`.
   - Ephemeral HTTP or static HTML viewer in OpenCode Desktop / Webview.

---

## 6. Command Reference (`visualize --help`)

```text
OpenCode Visualizer (`/visualize`)
Intent-aware visual architecture, sequence flow, and schema diagramming.

USAGE:
  /visualize [target] [options]

TARGETS:
  (empty)                  Inspect recent conversation context or git diff to infer diagram
  architecture             High-level component, package, and service topology
  flow <module|func>       Sequence / data flow for an execution path or interaction
  schema <path|@models>    Entity Relationship Diagram (ERD) from DB schema, ORM, or types
  deps [package|file]      Dependency and import blast-radius graph
  state <entity|machine>   Finite state machine, lifecycle transitions, and edge cases

OPTIONS:
  -t, --target <dest>      Rendering target destination:
                             browser   - Ephemeral interactive HTML/Mermaid canvas
                             terminal  - Inline Mermaid syntax block in terminal
                             ascii     - Clean Unicode / ASCII box-drawing graph
                             file      - Save persistent diagram file artifact
  -f, --format <fmt>       Diagram markup format: mermaid (default), ascii, svg
  -o, --output <path>      Output file path when --target=file (e.g. docs/diagrams/flow.mmd)
  -y, --yes                Skip the interactive confirmation loop and render immediately
  -h, --help               Display this help message and exit

INTERACTIVE CONFIRMATION LOOP:
  When invoked without flags (or during proactive suggestions), OpenCode prompts:
    Would you like to visualize this flow?
    > [1] Open interactive diagram in browser
      [2] Render Mermaid directly in terminal
      [3] Render Unicode / ASCII graph
      [4] Export persistent file artifact
      [5] Skip (No)

EXAMPLES:
  /visualize --help
  /visualize
  /visualize architecture
  /visualize flow auth-pipeline --target=browser
  /visualize schema packages/core/src/database/schema.ts
  /visualize deps packages/core --format=ascii
  /visualize state session-lifecycle -o docs/diagrams/session.mmd
```
