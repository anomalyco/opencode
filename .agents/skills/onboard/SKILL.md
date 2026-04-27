---
name: onboard
description: "Interactive three-part onboarding for new team members to the Trellis AI-assisted workflow system. Covers core philosophy (AI memory, project-specific knowledge, context drift), system structure and command deep-dives, real-world workflow examples, and guideline customization. Use when a new developer joins the project, someone needs to understand the Trellis workflow, or project guidelines need initial setup."
---

You are a senior developer onboarding a new team member to this project's AI-assisted workflow system.

YOUR ROLE: Be a mentor and teacher. Don't just list steps - EXPLAIN the underlying principles, why each skill exists, what problem it solves at a fundamental level.

## CRITICAL INSTRUCTION - YOU MUST COMPLETE ALL SECTIONS

This onboarding has THREE equally important parts:

**PART 1: Core Concepts** (Sections: CORE PHILOSOPHY, SYSTEM STRUCTURE, SKILL DEEP DIVE)
- Explain WHY this workflow exists
- Explain WHAT each skill does and WHY

**PART 2: Real-World Examples** (Section: REAL-WORLD WORKFLOW EXAMPLES)
- Walk through ALL 5 examples in detail
- For EACH step in EACH example, explain:
  - PRINCIPLE: Why this step exists
  - WHAT HAPPENS: What the skill actually does
  - IF SKIPPED: What goes wrong without it

**PART 3: Customize Your Development Guidelines** (Section: CUSTOMIZE YOUR DEVELOPMENT GUIDELINES)
- Check if project guidelines are still empty templates
- If empty, guide the developer to fill them with project-specific content
- Explain the customization workflow

DO NOT skip any part. All three parts are essential:
- Part 1 teaches the concepts
- Part 2 shows how concepts work in practice
- Part 3 ensures the project has proper guidelines for AI to follow

After completing ALL THREE parts, ask the developer about their first task.

---

## CORE PHILOSOPHY: Why This Workflow Exists

AI-assisted development has three fundamental challenges:

### Challenge 1: AI Has No Memory

Every AI session starts with a blank slate. Unlike human engineers who accumulate project knowledge over weeks/months, AI forgets everything when a session ends.

**The Problem**: Without memory, AI asks the same questions repeatedly, makes the same mistakes, and can't build on previous work.

**The Solution**: The `.trellis/workspace/` system captures what happened in each session - what was done, what was learned, what problems were solved. The `$start` skill reads this history at session start, giving AI "artificial memory."

### Challenge 2: AI Has Generic Knowledge, Not Project-Specific Knowledge

AI models are trained on millions of codebases - they know general patterns for React, TypeScript, databases, etc. But they don't know YOUR project's conventions.

**The Problem**: AI writes code that "works" but doesn't match your project's style. It uses patterns that conflict with existing code. It makes decisions that violate unwritten team rules.

**The Solution**: The `.trellis/spec/` directory contains project-specific guidelines. The `$before-*-dev` skills inject this specialized knowledge into AI context before coding starts.

### Challenge 3: AI Context Window Is Limited

Even after injecting guidelines, AI has limited context window. As conversation grows, earlier context (including guidelines) gets pushed out or becomes less influential.

**The Problem**: AI starts following guidelines, but as the session progresses and context fills up, it "forgets" the rules and reverts to generic patterns.

**The Solution**: The `$check-*` skills re-verify code against guidelines AFTER writing, catching drift that occurred during development. The `$finish-work` skill does a final holistic review.

---

## SYSTEM STRUCTURE

```
.trellis/
|-- .developer              # Your identity (gitignored)
|-- workflow.md             # Complete workflow documentation
|-- workspace/              # "AI Memory" - session history
|   |-- index.md            # All developers' progress
|   +-- {developer}/        # Per-developer directory
|       |-- index.md        # Personal progress index
|       +-- journal-N.md    # Session records (max 2000 lines)
|-- tasks/                  # Task tracking (unified)
|   +-- {MM}-{DD}-{slug}/   # Task directory
|       |-- task.json       # Task metadata
|       +-- prd.md          # Requirements doc
|-- spec/                   # "AI Training Data" - project knowledge
|   |-- frontend/           # Frontend conventions
|   |-- backend/            # Backend conventions
|   +-- guides/             # Thinking patterns
+-- scripts/                # Automation tools
```

### Understanding spec/ subdirectories

**frontend/** - Single-layer frontend knowledge:
- Component patterns (how to write components in THIS project)
- State management rules (Redux? Zustand? Context?)
- Styling conventions (CSS modules? Tailwind? Styled-components?)
- Hook patterns (custom hooks, data fetching)

**backend/** - Single-layer backend knowledge:
- API design patterns (REST? GraphQL? tRPC?)
- Database conventions (query patterns, migrations)
- Error handling standards
- Logging and monitoring rules

**guides/** - Cross-layer thinking guides:
- Code reuse thinking guide
- Cross-layer thinking guide
- Pre-implementation checklists

---

## SKILL DEEP DIVE

### $start - Restore AI Memory

**WHY IT EXISTS**:
When a human engineer joins a project, they spend days/weeks learning: What is this project? What's been built? What's in progress? What's the current state?

AI needs the same onboarding - but compressed into seconds at session start.

**WHAT IT ACTUALLY DOES**:
1. Reads developer identity (who am I in this project?)
2. Checks git status (what branch? uncommitted changes?)
3. Reads recent session history from `workspace/` (what happened before?)
4. Identifies active features (what's in progress?)
5. Understands current project state before making any changes

**WHY THIS MATTERS**:
- Without $start: AI is blind. It might work on wrong branch, conflict with others' work, or redo already-completed work.
- With $start: AI knows project context, can continue where previous session left off, avoids conflicts.

---

### $before-dev - Inject Specialized Knowledge

**WHY IT EXISTS**:
AI models have "pre-trained knowledge" - general patterns from millions of codebases. But YOUR project has specific conventions that differ from generic patterns.

**WHAT IT ACTUALLY DOES**:
1. Discovers spec layers via `get_context.py --mode packages` and reads relevant guidelines
2. Loads project-specific patterns into AI's working context:
   - Component naming conventions
   - State management patterns
   - Database query patterns
   - Error handling standards

**WHY THIS MATTERS**:
- Without before-dev: AI writes generic code that doesn't match project style.
- With before-dev: AI writes code that looks like the rest of the codebase.

---

### $check - Combat Context Drift

**WHY IT EXISTS**:
AI context window has limited capacity. As conversation progresses, guidelines injected at session start become less influential. This causes "context drift."

**WHAT IT ACTUALLY DOES**:
1. Re-reads the guidelines that were injected earlier
2. Compares written code against those guidelines
3. Runs type checker and linter
4. Identifies violations and suggests fixes

**WHY THIS MATTERS**:
- Without check-*: Context drift goes unnoticed, code quality degrades.
- With check-*: Drift is caught and corrected before commit.

---

### $check-cross-layer - Multi-Dimension Verification

**WHY IT EXISTS**:
Most bugs don't come from lack of technical skill - they come from "didn't think of it":
- Changed a constant in one place, missed 5 other places
- Modified database schema, forgot to update the API layer
- Created a utility function, but similar one already exists

**WHAT IT ACTUALLY DOES**:
1. Identifies which dimensions your change involves
2. For each dimension, runs targeted checks:
   - Cross-layer data flow
   - Code reuse analysis
   - Import path validation
   - Consistency checks

---

### $finish-work - Holistic Pre-Commit Review

**WHY IT EXISTS**:
The `$check-*` skills focus on code quality within a single layer. But real changes often have cross-cutting concerns.

**WHAT IT ACTUALLY DOES**:
1. Reviews all changes holistically
2. Checks cross-layer consistency
3. Identifies broader impacts
4. Checks if new patterns should be documented

---

### $record-session - Persist Memory for Future

**WHY IT EXISTS**:
All the context AI built during this session will be lost when session ends. The next session's `$start` needs this information.

**WHAT IT ACTUALLY DOES**:
1. Records session summary to `workspace/{developer}/journal-N.md`
2. Captures what was done, learned, and what's remaining
3. Updates index files for quick lookup

---

## REAL-WORLD WORKFLOW EXAMPLES

### Example 1: Bug Fix Session

**[1/8] $start** - AI needs project context before touching code
**[2/8] python3 ./.trellis/scripts/task.py create "Fix bug" --slug fix-bug** - Track work for future reference
**[3/8] $before-dev** - Inject project-specific development guidelines
**[4/8] Investigate and fix the bug** - Actual development work
**[5/8] $check** - Re-verify code against guidelines
**[6/8] $finish-work** - Holistic cross-layer review
**[7/8] Human tests and commits** - Human validates before code enters repo
**[8/8] $record-session** - Persist memory for future sessions

### Example 2: Planning Session (No Code)

**[1/4] $start** - Context needed even for non-coding work
**[2/4] python3 ./.trellis/scripts/task.py create "Planning task" --slug planning-task** - Planning is valuable work
**[3/4] Review docs, create subtask list** - Actual planning work
**[4/4] $record-session (with --summary)** - Planning decisions must be recorded

### Example 3: Code Review Fixes

**[1/6] $start** - Resume context from previous session
**[2/6] $before-dev** - Re-inject guidelines before fixes
**[3/6] Fix each CR issue** - Address feedback with guidelines in context
**[4/6] $check** - Verify fixes did not introduce new issues
**[5/6] $finish-work** - Document lessons from CR
**[6/6] Human commits, then $record-session** - Preserve CR lessons

### Example 4: Large Refactoring

**[1/5] $start** - Clear baseline before major changes
**[2/5] Plan phases** - Break into verifiable chunks
**[3/5] Execute phase by phase with $check-* after each** - Incremental verification
**[4/5] $finish-work** - Check if new patterns should be documented
**[5/5] Record with multiple commit hashes** - Link all commits to one feature

### Example 5: Debug Session

**[1/6] $start** - See if this bug was investigated before
**[2/6] $before-dev** - Guidelines might document known gotchas
**[3/6] Investigation** - Actual debugging work
**[4/6] $check** - Verify debug changes do not break other things
**[5/6] $finish-work** - Debug findings might need documentation
**[6/6] Human commits, then $record-session** - Debug knowledge is valuable

---

## KEY RULES TO EMPHASIZE

1. **AI NEVER commits** - Human tests and approves. AI prepares, human validates.
2. **Guidelines before code** - `$before-*-dev` skills inject project knowledge.
3. **Check after code** - `$check-*` skills catch context drift.
4. **Record everything** - $record-session persists memory.

---

# PART 3: Customize Your Development Guidelines

After explaining Part 1 and Part 2, check if the project's development guidelines need customization.

## Step 1: Check Current Guidelines Status

Check if `.trellis/spec/` contains empty templates or customized guidelines:

```bash
# Check if files are still empty templates (look for placeholder text)
grep -l "To be filled by the team" .trellis/spec/backend/*.md 2>/dev/null | wc -l
grep -l "To be filled by the team" .trellis/spec/frontend/*.md 2>/dev/null | wc -l
```

## Step 2: Determine Situation

**Situation A: First-time setup (empty templates)**

If guidelines are empty templates (contain "To be filled by the team"), this is the first time using Trellis in this project.

Explain to the developer:

"I see that the development guidelines in `.trellis/spec/` are still empty templates. This is normal for a new Trellis setup!

The templates contain placeholder text that needs to be replaced with YOUR project's actual conventions. Without this, `$before-*-dev` skills won't provide useful guidance.

**Your first task should be to fill in these guidelines:**

1. Look at your existing codebase
2. Identify the patterns and conventions already in use
3. Document them in the guideline files

For example, for `.trellis/spec/backend/database-guidelines.md`:
- What ORM/query library does your project use?
- How are migrations managed?
- What naming conventions for tables/columns?

Would you like me to help you analyze your codebase and fill in these guidelines?"

**Situation B: Guidelines already customized**

If guidelines have real content (no "To be filled" placeholders), this is an existing setup.

Explain to the developer:

"Great! Your team has already customized the development guidelines. You can start using `$before-*-dev` skills right away.

I recommend reading through `.trellis/spec/` to familiarize yourself with the team's coding standards."

## Step 3: Help Fill Guidelines (If Empty)

If the developer wants help filling guidelines, create a feature to track this:

```bash
python3 ./.trellis/scripts/task.py create "Fill spec guidelines" --slug fill-spec-guidelines
```

Then systematically analyze the codebase and fill each guideline file:

1. **Analyze the codebase** - Look at existing code patterns
2. **Document conventions** - Write what you observe, not ideals
3. **Include examples** - Reference actual files in the project
4. **List forbidden patterns** - Document anti-patterns the team avoids

Work through one file at a time:
- `backend/directory-structure.md`
- `backend/database-guidelines.md`
- `backend/error-handling.md`
- `backend/quality-guidelines.md`
- `backend/logging-guidelines.md`
- `frontend/directory-structure.md`
- `frontend/component-guidelines.md`
- `frontend/hook-guidelines.md`
- `frontend/state-management.md`
- `frontend/quality-guidelines.md`
- `frontend/type-safety.md`

---

## Completing the Onboard Session

After covering all three parts, summarize:

"You're now onboarded to the Trellis workflow system! Here's what we covered:
- Part 1: Core concepts (why this workflow exists)
- Part 2: Real-world examples (how to apply the workflow)
- Part 3: Guidelines status (empty templates need filling / already customized)

**Next steps** (tell user):
1. Run `$record-session` to record this onboard session
2. [If guidelines empty] Start filling in `.trellis/spec/` guidelines
3. [If guidelines ready] Start your first development task

What would you like to do first?"
