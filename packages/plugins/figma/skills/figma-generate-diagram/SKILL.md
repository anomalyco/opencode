---
name: figma-generate-diagram
description: "MANDATORY prerequisite — load this skill BEFORE every `generate_diagram` tool call. NEVER call `generate_diagram` directly without loading this skill first. Trigger whenever the user asks to create, generate, draw, render, sketch, or build a diagram — flowchart, architecture diagram, sequence diagram, ERD or entity-relationship diagram, state diagram or state machine, gantt chart, or timeline. Also trigger when the user mentions Mermaid syntax or wants a system architecture, decision tree, dependency graph, API call flow, auth handshake, schema, or pipeline visualized in FigJam. Routes to type-specific guidance, sets universal Mermaid constraints, and tells you when to use a different diagram type or skip the tool entirely (mindmaps, pie charts, class diagrams, etc.)."
---

# generate-diagram

**You MUST load this skill before every `generate_diagram` tool call.** Skipping it causes preventable rendering failures and low-quality output.

`generate_diagram` takes Mermaid.js syntax and produces an editable FigJam diagram. This skill routes you to the right per-type guidance and sets universal constraints.

## Step 1: Is `generate_diagram` the right tool?

### Supported diagram types

`flowchart`, `sequenceDiagram`, `stateDiagram` / `stateDiagram-v2`, `gantt`, `erDiagram`.

### Unsupported — don't call the tool

If the user wants any of these, tell them directly that `generate_diagram` doesn't support it instead of calling the tool and failing:
- **Pie chart, mindmap, venn diagram, class diagram, journey, timeline, quadrant, C4, git graph, requirement diagram**

### When to push the user to edit in Figma

The tool cannot:
- Change fonts on an existing diagram
- Move individual shapes
- Edit a diagram node-by-node after generation

If the user asks for any of those on an existing diagram, recommend they open the diagram in Figma and edit there. For content-level changes, it's usually faster to regenerate.

## Step 2: Pick the diagram type

Lightweight routing — use the first match.

| User wants… | Type | Next step |
|---|---|---|
| Services + datastores + queues + integrations | **Architecture flowchart** | Read [references/architecture.md](./references/architecture.md) |
| Decision tree, process flow, pipeline, dependency graph, user journey | **Flowchart** | Read [references/flowchart.md](./references/flowchart.md) |
| Interactions between parties over time (API calls, auth, messaging) | **Sequence diagram** | Read [references/sequence.md](./references/sequence.md) |
| Data model, tables, keys, cardinality | **ER diagram** | Read [references/erd.md](./references/erd.md) |
| Named states with transitions between them | **State diagram** | Read [references/state.md](./references/state.md) |
| Project schedule with dates, milestones | **Gantt chart** | Read [references/gantt.md](./references/gantt.md) |

If a flowchart is requested and it describes software infrastructure (services, datastores, queues, external integrations), route to `architecture.md` — not `flowchart.md`. When in doubt, ask the user.

## Step 3: Universal constraints (apply to every diagram type)

1. **No emojis** in any part of the Mermaid source. The tool rejects them.
2. **No `\n`** in labels. Use newlines only when absolutely required and only via actual line breaks (not the escape sequence).
3. **No HTML tags** in labels.
4. **Reserved words** — don't use `end`, `subgraph`, `graph` as node IDs.
5. **Node IDs**: camelCase (`userService`), no spaces. Underscores can break edge routing in some processors.
6. **Special characters in labels** must be wrapped in quotes: `A["Process (main)"]`, `-->|"O(1) lookup"|`.
7. **Sequence diagrams** — Mermaid `Note over X` / `Note left of X` / `Note right of X` are silently stripped by the renderer; don't put them in the source. If the user wants annotations on a sequence diagram, generate the base diagram first and add stickies/text via the hybrid workflow ([references/workflow.md](references/workflow.md)).
8. **Gantt charts** — `classDef`, `class`, and any other styling are stripped by preprocessing; the rendered chart will not have colors. If the user wants color-coded phases, milestones, or tasks, generate the base chart first and add color/annotations via the hybrid workflow ([references/workflow.md](references/workflow.md)) — or, for diagrams that fundamentally need styling, build the timeline directly with `use_figma` instead (see [references/gantt.md](references/gantt.md) §11).
9. **Use FigJam-only APIs in any `use_figma` extension.** `generate_diagram` output lands in a FigJam file (`figma.com/board/...`), so hybrid extensions must stick to FigJam-supported APIs. Do NOT call `figma.createPage()` — it's Design-only (`figma.com/design/...`) and throws `TypeError: figma.createPage no such property 'createPage' on the figma global object` in FigJam. Organize content with FigJam sections instead (see [figma-use-figjam](../figma-use-figjam/SKILL.md)).

## Step 4: Garbage in, garbage out

The quality of the generated diagram is bounded by the quality of the Mermaid you produce, which is bounded by the context you have. Before writing Mermaid, make sure you have enough real information to describe the subject accurately — and use whatever the current environment gives you to gather it.

Depending on what's available, useful sources of context include:

- **Source code** — grep/read the relevant files so the diagram reflects real service names, real edge labels, real data stores, real entry points. Walking actual routes/handlers/consumers beats recreating from memory.
- **User-provided documents** — a PRD, spec, meeting notes, transcript, research synthesis, onboarding doc, process write-up. Ask the user to paste or attach it if the subject isn't code.
- **Existing Figma or FigJam files** — if the new diagram should align with one the user already has, read it with `get_figjam` or `get_design_context` (see the `figma-use` and `figma-use-figjam` skills).
- **Other MCP servers or tools you have available** — issue trackers, docs sites, CRMs, analytics, internal wikis, design systems, database schemas, etc. If a connected tool holds the ground truth for what you're diagramming, pull from it rather than guessing.
- **The user themselves** — when the description is thin or ambiguous (unclear direction of flow, unclear scope, unclear which entities matter), ask one or two focused questions before generating. Examples: "What are the 3–5 main steps?", "Who owns each step?", "What triggers the next step?". One good question beats one wasted diagram.

Don't invent edges, labels, or entities to "round out" a diagram. Missing information is better than hallucinated information — leave a gap and flag it to the user.

## Step 5: Will the diagram need more than Mermaid can express?

Mermaid can't do everything. Sticky-note annotations tied to specific nodes, per-node domain coloring on ERDs, callouts with attached data — these all require composing `generate_diagram` with `use_figma` (via the [figma-use-figjam](../figma-use-figjam/SKILL.md) skill). This is the **hybrid workflow**.

It's a judgment call, not a default. Deploy it when the user's ask clearly benefits — skip it when the base diagram is obviously enough. Signals that say yes: user explicitly asked for notes, colors, callouts, or "X attached to each node"; they shared data that maps to specific nodes; the diagram is a shareable artifact, not a thinking sketch. Signals that say no: short/self-explanatory request, small diagram, user exploring or testing.

**If hybrid is warranted, read [references/workflow.md](./references/workflow.md) before calling `generate_diagram`** — it covers the pattern, two core recipes (annotations + color-coding), communication style, and failure handling. If not, proceed directly to Step 6.

## Step 6: Calling the tool

Required:
- `name`: a descriptive title (shown to the user)
- `mermaidSyntax`: the Mermaid source

Optional:
- `userIntent`: a short sentence describing what the user is trying to accomplish — helps telemetry and downstream tuning
- `useArchitectureLayoutCode`: **only for architecture diagrams**; value is specified in `references/architecture.md`
- `fileKey`: if the user wants the diagram added to an existing FigJam file instead of a new one

Do **not** call `create_new_file` before `generate_diagram` — the tool creates its own file.

## Step 7: After generation

- The tool returns a link (or widget) the user can click to open the diagram in FigJam. Show it as a markdown link unless the client renders an inline widget.
- If extensions are warranted (see Step 5), compose with `use_figma` now — the pattern and recipes are in [references/workflow.md](./references/workflow.md).
- If the user is dissatisfied after 2 attempts at the same diagram, stop regenerating. Ask what specifically is wrong, or suggest they open it in Figma and edit manually rather than burning more tool calls.

### Reuse the same file when iterating or adding related diagrams

Every call to `generate_diagram` without a `fileKey` creates a new FigJam file in the user's drafts. Regenerating 4 times = 4 draft files to clean up. Prefer reusing the existing file when:

- The user is iterating on the same diagram ("try again with…", "change the labels…").
- The user wants a follow-up diagram that lives alongside the first (e.g. a sequence diagram next to a flowchart of the same system).

How to reuse:

1. **Pass `fileKey`** on subsequent `generate_diagram` calls. Extract from a `figma.com/board/{fileKey}/...` URL. The diagram is added to the existing file rather than creating a new one.
2. If you want to replace the previous diagram rather than adding next to it, use the `use_figma` tool (see the `figma-use-figjam` skill) to delete the old diagram's nodes first, then call `generate_diagram` with the same `fileKey`. Or leave the old diagram and place the new one beside it — readers often benefit from seeing the history of attempts.

Ask the user which they prefer the first time you iterate — "regenerate over the old one, or keep both side-by-side?" — and remember their answer for subsequent iterations in the session.
