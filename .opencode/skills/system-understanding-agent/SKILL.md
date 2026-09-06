---
name: system-understanding-agent
description: Consume Understand Anything outputs and create a concise, reviewable system overview that gives agents sufficient context before modifying code (Gate 0).
license: CC-BY-SA-4.0
compatibility: opencode
metadata:
  version: "1.1"
  standard: "Agile V"
  author: agile-v.org
---

# Instructions

## Purpose

Use this skill when Agile V is applied to an existing codebase, documentation set, or knowledge
base. The skill consumes Understand Anything outputs and creates a concise, reviewable system
overview that gives agents sufficient context before modifying code.

This is **Gate 0** of the integrated Agile V lifecycle. No requirements should be generated,
and no code should be built, until this skill has run and the system overview has been reviewed.

---

## Trigger conditions

Activate this skill when:

- The task modifies an existing repository.
- The task involves unknown architecture.
- The user asks for change-impact analysis.
- The user asks for an onboarding guide or system overview.
- The task is multi-file or dependency-heavy.
- Regulatory or audit evidence requires traceable system context.
- A `.understand-anything/knowledge-graph.json` file exists in the repository.
- The user says "what does this system do?" or "what will this change affect?"

---

## Inputs

```text
- change_request.md              required
- repository root path           required
- .understand-anything/knowledge-graph.json   optional but strongly preferred
- .understand-anything/diff-overlay.json      optional
- existing README or architecture docs        optional
- task requirements (if already exist)        optional
```

---

## Outputs

All outputs are written to canonical `.agile-v/phases/00-understanding/`.

```text
system_overview.md
architecture_map.md
domain_flow_summary.md
knowledge_graph_summary.md
known_constraints.md
system_understanding_confidence.md
understanding_gate_decision.md
normalized_graph.json          (when graph is available)
knowledge_graph_hash.txt       (when graph is available)
```

---

## Required behavior

### Step 1: Detect the knowledge graph

Check for `.understand-anything/knowledge-graph.json`. Record whether it was found.

If found:
- Hash the file. Record the hash.
- Load and normalize via the Agile V graph adapter.
- Record node count, edge count, and detected languages.

If not found:
- Record `graph_available: false` in `system_understanding_confidence.md`.
- Continue with available context (README, docs, code inspection).
- Note reduced confidence.

### Step 2: Generate the system overview

Produce `system_overview.md` covering:

1. What the system does (1–3 sentences).
2. Main architectural layers (API, service, data, UI, utility, etc.).
3. Key entry points (main endpoints, CLI commands, event handlers).
4. Key dependencies (internal and external).
5. Domain flows (the primary business/domain processes).
6. Known constraints (performance limits, platform assumptions, compliance requirements).
7. Areas requiring caution (complex modules, legacy code, safety-critical paths).
8. Unknowns and missing context.
9. Confidence level: High / Medium / Low with rationale.

### Step 3: Generate the architecture map

Produce `architecture_map.md` as a structured table and Mermaid diagram (if feasible) showing
layers and their key components.

### Step 4: Generate the understanding gate decision

Produce `understanding_gate_decision.md` that records:

- Graph available: yes/no.
- Graph hash.
- System overview generated: yes.
- Impacted component identification: complete/partial/not_started.
- Confidence: High/Medium/Low.
- Blocking issues: none or list.
- Gate decision: **PASS** / **FAIL** / **PASS_WITH_FINDINGS**.

---

## Output template: system_overview.md

```markdown
# System Overview

## Source

- Repository: `<repo>`
- Knowledge graph path: `.understand-anything/knowledge-graph.json`
- Graph hash: `sha256:<hex>`
- Generated at: `<ISO-8601 timestamp>`

## Summary

<Plain-English system summary in 1–3 sentences.>

## Main Architectural Layers

| Layer | Components | Notes |
|---|---|---|
| API | ... | ... |
| Service | ... | ... |
| Data | ... | ... |
| UI | ... | ... |
| Utility | ... | ... |

## Key Entry Points

| Entry point | Type | Purpose |
|---|---|---|
| ... | endpoint/CLI/event | ... |

## Key Dependencies

| Component | Depends on | Risk |
|---|---|---|
| ... | ... | High/Medium/Low |

## Domain Flows

| Flow | Components | Notes |
|---|---|---|
| ... | ... | ... |

## Known Constraints

- ...

## Areas Requiring Caution

- ...

## Unknowns / Missing Context

- ...

## Confidence

- Confidence: High / Medium / Low
- Reason: ...
```

---

## Anti-patterns to avoid

- Do not hallucinate file contents. If the graph or README does not confirm something, say so.
- Do not generate requirements in this step. The goal is understanding, not specification.
- Do not begin implementation. This is a read-only analysis step.
- Do not pass a Low-confidence gate without explicit human acknowledgment.
- Do not include raw source code in the system overview.

Inherited obligations: apply `agile-v-core` halt, decision-log, and typed-lineage rules; if AI materially influences these outputs at any risk level, create/update the task manifest under `.agile-v/aibom/<task_id>/` per `agile-v-aibom`.

---

## Gate 0 acceptance criteria

| Criterion | Required |
|---|---|
| Knowledge graph found or absence explicitly documented | Yes |
| Graph hash recorded | Yes |
| System summary generated | Yes |
| Key entry points identified | Yes |
| Key dependencies identified | Yes |
| Risks and caution areas identified | Yes |
| Confidence level assigned and justified | Yes |
| Gate decision recorded in `understanding_gate_decision.md` | Yes |

Gate 0 fails if:
- No system context can be found (graph missing and no README/docs available).
- Confidence is Low and no human has explicitly accepted it.
- A critical blocking issue is identified (e.g., ambiguous change request with no clarification).

---

## Compatible tools

Claude Code, Cursor, Copilot, Codex, Gemini CLI, OpenCode, Cline, and any tool that can read
Markdown skill files.
