---
name: brainstorm
description: "Collaborative requirements discovery session optimized for AI coding workflows. Creates task directories, seeds PRDs, runs codebase research, proposes concrete implementation approaches with trade-offs, and converges on MVP scope through structured Q&A. Use when requirements are unclear, multiple implementation paths exist, trade-offs need evaluation, or a complex feature needs scoping before development."
---

# Brainstorm - Requirements Discovery (AI Coding Enhanced)

Guide AI through collaborative requirements discovery **before implementation**, optimized for AI coding workflows:

* **Task-first** (capture ideas immediately)
* **Action-before-asking** (reduce low-value questions)
* **Research-first** for technical choices (avoid asking users to invent options)
* **Diverge → Converge** (expand thinking, then lock MVP)

---

## When to Use

Triggered from `$start` when the user describes a development task, especially when:

* requirements are unclear or evolving
* there are multiple valid implementation paths
* trade-offs matter (UX, reliability, maintainability, cost, performance)
* the user might not know the best options up front

---

## Core Principles (Non-negotiable)

1. **Task-first (capture early)**
   Always ensure a task exists at the start so the user's ideas are recorded immediately.

2. **Action before asking**
   If you can derive the answer from repo code, docs, configs, conventions, or quick research — do that first.

3. **One question per message**
   Never overwhelm the user with a list of questions. Ask one, update PRD, repeat.

4. **Prefer concrete options**
   For preference/decision questions, present 2–3 feasible, specific approaches with trade-offs.

5. **Research-first for technical choices**
   If the decision depends on industry conventions / similar tools / established patterns, do research first, then propose options.

6. **Diverge → Converge**
   After initial understanding, proactively consider future evolution, related scenarios, and failure/edge cases — then converge to an MVP with explicit out-of-scope.

7. **No meta questions**
   Do not ask "should I search?" or "can you paste the code so I can continue?"
   If you need information: search/inspect. If blocked: ask the minimal blocking question.

---

## Step 0: Ensure Task Exists (ALWAYS)

Before any Q&A, ensure a task exists. If none exists, create one immediately.

* Use a **temporary working title** derived from the user's message.
* It's OK if the title is imperfect — refine later in PRD.

```bash
TASK_DIR=$(python3 ./.trellis/scripts/task.py create "brainstorm: <short goal>" --slug <auto>)
```

Create/seed `prd.md` immediately with what you know:

```markdown
# brainstorm: <short goal>

## Goal

<one paragraph: what + why>

## What I already know

* <facts from user message>
* <facts discovered from repo/docs>

## Assumptions (temporary)

* <assumptions to validate>

## Open Questions

* <ONLY Blocking / Preference questions; keep list short>

## Requirements (evolving)

* <start with what is known>

## Acceptance Criteria (evolving)

* [ ] <testable criterion>

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* <what we will not do in this task>

## Technical Notes

* <files inspected, constraints, links, references>
* <research notes summary if applicable>
```

---

## Step 1: Auto-Context (DO THIS BEFORE ASKING QUESTIONS)

Before asking questions like "what does the code look like?", gather context yourself:

### Repo inspection checklist

* Identify likely modules/files impacted
* Locate existing patterns (similar features, conventions, error handling style)
* Check configs, scripts, existing command definitions
* Note any constraints (runtime, dependency policy, build tooling)

### Documentation checklist

* Look for existing PRDs/specs/templates
* Look for command usage examples, README, ADRs if any

Write findings into PRD:

* Add to `What I already know`
* Add constraints/links to `Technical Notes`

---

## Step 2: Classify Complexity (still useful, not gating task creation)

| Complexity   | Criteria                                               | Action                                      |
| ------------ | ------------------------------------------------------ | ------------------------------------------- |
| **Trivial**  | Single-line fix, typo, obvious change                  | Skip brainstorm, implement directly         |
| **Simple**   | Clear goal, 1–2 files, scope well-defined              | Ask 1 confirm question, then implement      |
| **Moderate** | Multiple files, some ambiguity                         | Light brainstorm (2–3 high-value questions) |
| **Complex**  | Vague goal, architectural choices, multiple approaches | Full brainstorm                             |

> Note: Task already exists from Step 0. Classification only affects depth of brainstorming.

---

## Step 3: Question Gate (Ask ONLY high-value questions)

Before asking ANY question, run the following gate:

### Gate A — Can I derive this without the user?

If answer is available via:

* repo inspection (code/config)
* docs/specs/conventions
* quick market/OSS research

→ **Do not ask.** Fetch it, summarize, update PRD.

### Gate B — Is this a meta/lazy question?

Examples:

* "Should I search?"
* "Can you paste the code so I can proceed?"
* "What does the code look like?" (when repo is available)

→ **Do not ask.** Take action.

### Gate C — What type of question is it?

* **Blocking**: cannot proceed without user input
* **Preference**: multiple valid choices, depends on product/UX/risk preference
* **Derivable**: should be answered by inspection/research

→ Only ask **Blocking** or **Preference**.

---

## Step 4: Research-first Mode (Mandatory for technical choices)

### Trigger conditions (any → research-first)

* The task involves selecting an approach, library, protocol, framework, template system, plugin mechanism, or CLI UX convention
* The user asks for "best practice", "how others do it", "recommendation"
* The user can't reasonably enumerate options

### Research steps

1. Identify 2–4 comparable tools/patterns
2. Summarize common conventions and why they exist
3. Map conventions onto our repo constraints
4. Produce **2–3 feasible approaches** for our project

### Research output format (PRD)

Add a section in PRD (either within Technical Notes or as its own):

```markdown
## Research Notes

### What similar tools do

* ...
* ...

### Constraints from our repo/project

* ...

### Feasible approaches here

**Approach A: <name>** (Recommended)

* How it works:
* Pros:
* Cons:

**Approach B: <name>**

* How it works:
* Pros:
* Cons:

**Approach C: <name>** (optional)

* ...
```

Then ask **one** preference question:

* "Which approach do you prefer: A / B / C (or other)?"

---

## Step 5: Expansion Sweep (DIVERGE) — Required after initial understanding

After you can summarize the goal, proactively broaden thinking before converging.

### Expansion categories (keep to 1–2 bullets each)

1. **Future evolution**

   * What might this feature become in 1–3 months?
   * What extension points are worth preserving now?

2. **Related scenarios**

   * What adjacent commands/flows should remain consistent with this?
   * Are there parity expectations (create vs update, import vs export, etc.)?

3. **Failure & edge cases**

   * Conflicts, offline/network failure, retries, idempotency, compatibility, rollback
   * Input validation, security boundaries, permission checks

### Expansion message template (to user)

```markdown
I understand you want to implement: <current goal>.

Before diving into design, let me quickly diverge to consider three categories (to avoid rework later):

1. Future evolution: <1–2 bullets>
2. Related scenarios: <1–2 bullets>
3. Failure/edge cases: <1–2 bullets>

For this MVP, which would you like to include (or none)?

1. Current requirement only (minimal viable)
2. Add <X> (reserve for future extension)
3. Add <Y> (improve robustness/consistency)
4. Other: describe your preference
```

Then update PRD:

* What's in MVP → `Requirements`
* What's excluded → `Out of Scope`

---

## Step 6: Q&A Loop (CONVERGE)

### Rules

* One question per message
* Prefer multiple-choice when possible
* After each user answer:

  * Update PRD immediately
  * Move answered items from `Open Questions` → `Requirements`
  * Update `Acceptance Criteria` with testable checkboxes
  * Clarify `Out of Scope`

### Question priority (recommended)

1. **MVP scope boundary** (what is included/excluded)
2. **Preference decisions** (after presenting concrete options)
3. **Failure/edge behavior** (only for MVP-critical paths)
4. **Success metrics & Acceptance Criteria** (what proves it works)

### Preferred question format (multiple choice)

```markdown
For <topic>, which approach do you prefer?

1. **Option A** — <what it means + trade-off>
2. **Option B** — <what it means + trade-off>
3. **Option C** — <what it means + trade-off>
4. **Other** — describe your preference
```

---

## Step 7: Propose Approaches + Record Decisions (Complex tasks)

After requirements are clear enough, propose 2–3 approaches (if not already done via research-first):

```markdown
Based on current information, here are 2–3 feasible approaches:

**Approach A: <name>** (Recommended)

* How:
* Pros:
* Cons:

**Approach B: <name>**

* How:
* Pros:
* Cons:

Which direction do you prefer?
```

Record the outcome in PRD as an ADR-lite section:

```markdown
## Decision (ADR-lite)

**Context**: Why this decision was needed
**Decision**: Which approach was chosen
**Consequences**: Trade-offs, risks, potential future improvements
```

---

## Step 8: Final Confirmation + Implementation Plan

When open questions are resolved, confirm complete requirements with a structured summary:

### Final confirmation format

```markdown
Here's my understanding of the complete requirements:

**Goal**: <one sentence>

**Requirements**:

* ...
* ...

**Acceptance Criteria**:

* [ ] ...
* [ ] ...

**Definition of Done**:

* ...

**Out of Scope**:

* ...

**Technical Approach**:
<brief summary + key decisions>

**Implementation Plan (small PRs)**:

* PR1: <scaffolding + tests + minimal plumbing>
* PR2: <core behavior>
* PR3: <edge cases + docs + cleanup>

Does this look correct? If yes, I'll proceed with implementation.
```

### Subtask Decomposition (Complex Tasks)

For complex tasks with multiple independent work items, create subtasks:

```bash
# Create child tasks
CHILD1=$(python3 ./.trellis/scripts/task.py create "Child task 1" --slug child1 --parent "$TASK_DIR")
CHILD2=$(python3 ./.trellis/scripts/task.py create "Child task 2" --slug child2 --parent "$TASK_DIR")

# Or link existing tasks
python3 ./.trellis/scripts/task.py add-subtask "$TASK_DIR" "$CHILD_DIR"
```

---

## PRD Target Structure (final)

`prd.md` should converge to:

```markdown
# <Task Title>

## Goal

<why + what>

## Requirements

* ...

## Acceptance Criteria

* [ ] ...

## Definition of Done

* ...

## Technical Approach

<key design + decisions>

## Decision (ADR-lite)

Context / Decision / Consequences

## Out of Scope

* ...

## Technical Notes

<constraints, references, files, research notes>
```

---

## Anti-Patterns (Hard Avoid)

* Asking user for code/context that can be derived from repo
* Asking user to choose an approach before presenting concrete options
* Meta questions about whether to research
* Staying narrowly on the initial request without considering evolution/edges
* Letting brainstorming drift without updating PRD

---

## Integration with Start Workflow

After brainstorm completes (Step 8 confirmation approved), the flow continues to the Task Workflow's **Phase 2: Prepare for Implementation**:

```text
Brainstorm
  Step 0: Create task directory + seed PRD
  Step 1–7: Discover requirements, research, converge
  Step 8: Final confirmation → user approves
  ↓
Task Workflow Phase 2 (Prepare for Implementation)
  Code-Spec Depth Check (if applicable)
  → Research codebase (based on confirmed PRD)
  → Configure code-spec context (jsonl files)
  → Activate task
  ↓
Task Workflow Phase 3 (Execute)
  Implement → Check → Complete
```

The task directory and PRD already exist from brainstorm, so Phase 1 of the Task Workflow is skipped entirely.

---

## Related Commands

| Command | When to Use |
|---------|-------------|
| `$start` | Entry point that triggers brainstorm |
| `$finish-work` | After implementation is complete |
| `$update-spec` | If new patterns emerge during work |
