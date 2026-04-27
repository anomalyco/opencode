---
name: start
description: "Initializes an AI development session by reading workflow guides, developer identity, git status, active tasks, and project guidelines from .trellis/. Classifies incoming tasks and routes to brainstorm, direct edit, or task workflow. Use when beginning a new coding session, resuming work, starting a new task, or re-establishing project context."
---

# Start Session

Initialize your AI development session and begin working on tasks.

---

## Operation Types

| Marker | Meaning | Executor |
|--------|---------|----------|
| `[AI]` | Bash scripts or tool calls executed by AI | You (AI) |
| `[USER]` | Skills executed by user | User |

---

## Initialization `[AI]`

### Step 1: Understand Development Workflow

First, read the workflow guide to understand the development process:

```bash
cat .trellis/workflow.md
```

**Follow the instructions in workflow.md** - it contains:
- Core principles (Read Before Write, Follow Standards, etc.)
- File system structure
- Development process
- Best practices

### Step 2: Get Current Context

```bash
python3 ./.trellis/scripts/get_context.py
```

This shows: developer identity, git status, current task (if any), active tasks.

### Step 3: Read Guidelines Index

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

This shows available packages and their spec layers. Read the relevant spec indexes:

```bash
cat .trellis/spec/<package>/<layer>/index.md   # Package-specific guidelines
cat .trellis/spec/guides/index.md              # Thinking guides (always read)
```

> **Important**: The index files are navigation — they list the actual guideline files (e.g., `error-handling.md`, `conventions.md`, `mock-strategies.md`).
> At this step, just read the indexes to understand what's available.
> When you start actual development, you MUST go back and read the specific guideline files relevant to your task, as listed in the index's Pre-Development Checklist.

### Step 4: Report and Ask

Report what you learned and ask: "What would you like to work on?"

---

## Task Classification

When user describes a task, classify it:

| Type | Criteria | Workflow |
|------|----------|----------|
| **Question** | User asks about code, architecture, or how something works | Answer directly |
| **Trivial Fix** | Typo fix, comment update, single-line change, < 5 minutes | Direct Edit |
| **Simple Task** | Clear goal, 1-2 files, well-defined scope | Quick confirm → Task Workflow |
| **Complex Task** | Vague goal, multiple files, architectural decisions | **Brainstorm → Task Workflow** |

### Decision Rule

> **If in doubt, use Brainstorm + Task Workflow.**
>
> Task Workflow ensures code-specs are injected to the right context, resulting in higher quality code.
> The overhead is minimal, but the benefit is significant.

> **Subtask Decomposition**: If brainstorm reveals multiple independent work items,
> consider creating subtasks using `--parent` flag or `add-subtask` command.
> See the brainstorm skill's Step 8 for details.

---

## Question / Trivial Fix

For questions or trivial fixes, work directly:

1. Answer question or make the fix
2. If code was changed, remind user to run `$finish-work`

---

## Simple Task

For simple, well-defined tasks:

1. Quick confirm: "I understand you want to [goal]. Shall I proceed?"
2. If no, clarify and confirm again
3. **If yes: execute ALL steps below without stopping. Do NOT ask for additional confirmation between steps.**
   - Create task directory (Phase 1 Path B, Step 2)
   - Write PRD (Step 3)
   - Research codebase (Phase 2, Step 5)
   - Configure context (Step 6)
   - Activate task (Step 7)
   - Implement (Phase 3, Step 8)
   - Check quality (Step 9)
   - Complete (Step 10)

---

## Complex Task - Brainstorm First

For complex or vague tasks, **automatically start the brainstorm process** — do NOT skip directly to implementation.

See `$brainstorm` for the full process. Summary:

1. **Acknowledge and classify** - State your understanding
2. **Create task directory** - Track evolving requirements in `prd.md`
3. **Ask questions one at a time** - Update PRD after each answer
4. **Propose approaches** - For architectural decisions
5. **Confirm final requirements** - Get explicit approval
6. **Proceed to Task Workflow** - With clear requirements in PRD

---

## Task Workflow (Development Tasks)

**Why this workflow?**
- Run a dedicated research pass before coding
- Configure specs in jsonl context files
- Implement using injected context
- Verify with a separate check pass
- Result: Code that follows project conventions automatically

### Overview: Two Entry Points

```
From Brainstorm (Complex Task):
  PRD confirmed → Research → Configure Context → Activate → Implement → Check → Complete

From Simple Task:
  Confirm → Create Task → Write PRD → Research → Configure Context → Activate → Implement → Check → Complete
```

**Key principle: Research happens AFTER requirements are clear (PRD exists).**

---

### Phase 1: Establish Requirements

#### Path A: From Brainstorm (skip to Phase 2)

PRD and task directory already exist from brainstorm. Skip directly to Phase 2.

#### Path B: From Simple Task

**Step 1: Confirm Understanding** `[AI]`

Quick confirm:
- What is the goal?
- What type of development? (frontend / backend / fullstack)
- Any specific requirements or constraints?

If unclear, ask clarifying questions.

**Step 2: Create Task Directory** `[AI]`

```bash
TASK_DIR=$(python3 ./.trellis/scripts/task.py create "<title>" --slug <name>)
```

**Step 3: Write PRD** `[AI]`

Create `prd.md` in the task directory with:

```markdown
# <Task Title>

## Goal
<What we're trying to achieve>

## Requirements
- <Requirement 1>
- <Requirement 2>

## Acceptance Criteria
- [ ] <Criterion 1>
- [ ] <Criterion 2>

## Technical Notes
<Any technical decisions or constraints>
```

---

### Phase 2: Prepare for Implementation (shared)

> Both paths converge here. PRD and task directory must exist before proceeding.

**Step 4: Code-Spec Depth Check** `[AI]`

If the task touches infra or cross-layer contracts, do not start implementation until code-spec depth is defined.

Trigger this requirement when the change includes any of:
- New or changed command/API signatures
- Database schema or migration changes
- Infra integrations (storage, queue, cache, secrets, env contracts)
- Cross-layer payload transformations

Must-have before proceeding:
- [ ] Target code-spec files to update are identified
- [ ] Concrete contract is defined (signature, fields, env keys)
- [ ] Validation and error matrix is defined
- [ ] At least one Good/Base/Bad case is defined

**Step 5: Research the Codebase** `[AI]`

Based on the confirmed PRD, run a focused research pass and produce:

1. Relevant spec files in `.trellis/spec/`
2. Existing code patterns to follow (2-3 examples)
3. Files that will likely need modification

Use this output format:

```markdown
## Relevant Specs
- <path>: <why it's relevant>

## Code Patterns Found
- <pattern>: <example file path>

## Files to Modify
- <path>: <what change>
```

**Step 6: Configure Context** `[AI]`

Initialize default context:

```bash
python3 ./.trellis/scripts/task.py init-context "$TASK_DIR" <type>
# type: backend | frontend | fullstack
```

Add specs found in your research pass:

```bash
# For each relevant spec and code pattern:
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" implement "<path>" "<reason>"
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" check "<path>" "<reason>"
```

**Step 7: Activate Task** `[AI]`

```bash
python3 ./.trellis/scripts/task.py start "$TASK_DIR"
```

This sets `.current-task` so hooks can inject context.

---

### Phase 3: Execute (shared)

**Step 8: Implement** `[AI]`

Implement the task described in `prd.md`.

- Follow all specs injected into implement context
- Keep changes scoped to requirements
- Run lint and typecheck before finishing

**Step 9: Check Quality** `[AI]`

Run a quality pass against check context:

- Review all code changes against the specs
- Fix issues directly
- Ensure lint and typecheck pass

**Step 10: Complete** `[AI]`

1. Verify lint and typecheck pass
2. Report what was implemented
3. Remind user to:
   - Test the changes
   - Commit when ready
   - Run `$record-session` to record this session

---

## Continuing Existing Task

If `get_context.py` shows a current task:

1. Read the task's `prd.md` to understand the goal
2. Check `task.json` for current status and phase
3. Ask user: "Continue working on <task-name>?"

If yes, resume from the appropriate step (usually Step 7 or 8).

---

## Skills Reference

### User Skills `[USER]`

| Skill | When to Use |
|---------|-------------|
| `$start` | Begin a session (this skill) |
| `$finish-work` | Before committing changes |
| `$record-session` | After completing a task |

### AI Scripts `[AI]`

| Script | Purpose |
|--------|---------|
| `python3 ./.trellis/scripts/get_context.py` | Get session context |
| `python3 ./.trellis/scripts/task.py create` | Create task directory |
| `python3 ./.trellis/scripts/task.py init-context` | Initialize jsonl files |
| `python3 ./.trellis/scripts/task.py add-context` | Add spec to jsonl |
| `python3 ./.trellis/scripts/task.py start` | Set current task |
| `python3 ./.trellis/scripts/task.py finish` | Clear current task |
| `python3 ./.trellis/scripts/task.py archive` | Archive completed task |

### Workflow Phases `[AI]`

| Phase | Purpose | Context Source |
|-------|---------|----------------|
| research | Analyze codebase | direct repo inspection |
| implement | Write code | `implement.jsonl` |
| check | Review & fix | `check.jsonl` |
| debug | Fix specific issues | `debug.jsonl` |

---

## Key Principle

> **Code-spec context is injected, not remembered.**
>
> The Task Workflow ensures agents receive relevant code-spec context automatically.
> This is more reliable than hoping the AI "remembers" conventions.
