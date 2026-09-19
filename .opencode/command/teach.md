---
description: Teach and onboard codebase insights, new commands, and patterns to AGENTS.md for long-term memory persistence
---

Analyze this session or the provided subject, and onboard the learnings and commands into `AGENTS.md` files for long-term memory persistence.

AGENTS.md files can exist at any directory level, not just the project root. When an agent reads a file, any AGENTS.md in parent directories are automatically loaded into the context of the tool read. Place learnings as close to the relevant code as possible:

- Project-wide learnings & global commands → root `AGENTS.md`
- Package/module-specific → `packages/<pkg>/AGENTS.md`
- Feature-specific → `src/<feature>/AGENTS.md`

What counts as a learning:
- Newly introduced commands, workflows, or CLI capabilities (e.g. `/visualize`, `opencode visualize`)
- Execution flows and non-obvious architecture relationships
- Output targets, file artifact behaviors, and default conventions
- Testing and typecheck invariants
- Core constraints and design patterns

Process:
1. Review session for discoveries, new commands, or architectural conventions
2. Determine scope - which AGENTS.md file is responsible
3. Update the target AGENTS.md with concise, high-signal rules
4. Summarize the onboarding updates

$ARGUMENTS
