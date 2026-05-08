<!-- Context: project/project-context | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

<!-- DEPRECATED: 2026-01-12 - Replaced by project-intelligence/technical-domain.md -->
<!-- REPLACED BY: ../project-intelligence/technical-domain.md -->

# ⚠️ DEPRECATED: OpenCode Agent System Project Context

> ⛔ This file is deprecated. See `project-intelligence/technical-domain.md` for the current technical domain documentation.

## Technology Stack

**Primary Language:** TypeScript
**Runtime:** Node.js/Bun
**Package Manager:** npm/pnpm/yarn
**Build Tools:** TypeScript Compiler (tsc)
**Testing:** Jest/Vitest (if configured)
**Linting:** ESLint (if configured)

## Project Structure

```
.opencode/
├── agent/           # AI agents for specific tasks
│   ├── subagents/   # Specialized subagents
│   └── *.md         # Primary agents
├── command/         # Slash commands
├── context/         # Knowledge base for agents
└── plugin/          # Extensions and integrations

tasks/               # Task management files
```

## Core Patterns

### Agent Structure Pattern
```markdown
---
description: "What this agent does"
mode: primary|subagent
tools: [read, edit, bash, etc.]
permissions: [security restrictions]
---

# Agent Name

[Direct instructions for behavior]

**EXECUTE** this [process type] for every [task type]:

**1. [ACTION]** the [subject]:
- [Specific instruction 1]
- [Specific instruction 2]

**RULES:**
- **ALWAYS** [critical requirement]
- **NEVER** [forbidden action]
```

### Command Structure Pattern
```markdown
---
name: command-name
agent: target-agent
---

You are [doing specific task].

**Request:** $ARGUMENTS

**Context Loaded:**
@/Users/apple/.config/opencode/context/core/essential-patterns.md
@[additional context files]

Execute [task] now.
```

### Context Loading Rules
- Commands load context immediately using @ references
- Agents can look up additional context deterministically
- Maximum 4 context files per command (250-450 lines total)
- Keep context files focused (50-150 lines each)

## Security Guidelines

- Agents have restricted permissions by default
- Sensitive operations require explicit approval
- No direct file system modifications without validation
- Build commands limited to safe operations

## Development Workflow

1. **Planning:** Create detailed task plans for complex work
2. **Implementation:** Execute one step at a time with validation
3. **Review:** Code review and security checks
4. **Testing:** Automated testing and build validation
5. **Documentation:** Update docs and context files

## Quality Gates

- TypeScript compilation passes
- Code review completed
- Build process succeeds
- Tests pass (if available)
- Documentation updated