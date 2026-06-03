<!-- Context: openagents-repo/navigation | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# OpenAgents Control Repository Context

**Purpose**: Context files specific to the OpenAgents Control repository

**Last Updated**: 2026-02-04

---

## Quick Navigation

| Function | Files | Purpose |
|----------|-------|---------|
| **Standards** | 2 files | Agent creation standards |
| **Concepts** | 6 files | Core ideas and principles |
| **Examples** | 9 files | Working code samples |
| **Guides** | 14 files | Step-by-step workflows |
| **Lookup** | 11 files | Quick reference tables |
| **Errors** | 2 files | Common issues + solutions |
| **Features** | 3 files | Feature documentation and refactoring |
| **Plugins** | Context plugin system | Plugin architecture and capabilities |

---

## Standards (Agent Creation)

| File | Topic | Priority |
|------|-------|----------|
| `standards/agent-frontmatter.md` | Valid OpenCode YAML frontmatter | ⭐⭐⭐⭐⭐ |
| `standards/subagent-structure.md` | Standard subagent file structure | ⭐⭐⭐⭐⭐ |

**When to read**: Before creating or modifying any agent files

---

## Concepts (Core Ideas)

| File | Topic | Priority |
|------|-------|----------|
| `concepts/compatibility-layer.md` | Adapter pattern for AI coding tools | ⭐⭐⭐⭐⭐ |
| `concepts/subagent-testing-modes.md` | Standalone vs delegation testing | ⭐⭐⭐⭐⭐ |
| `concepts/hooks-system.md` | User-defined lifecycle commands | ⭐⭐⭐⭐ |
| `concepts/agent-skills.md` | Skills that teach Claude tasks | ⭐⭐⭐⭐ |
| `concepts/subagents-system.md` | Specialized AI assistants | ⭐⭐⭐⭐ |

**When to read**: Before testing any subagent or working with tool adapters

---

## Examples (Working Code)

| File | Topic | Priority |
|------|-------|----------|
| `examples/baseadapter-pattern.md` | Template Method pattern for tool adapters | ⭐⭐⭐⭐⭐ |
| `examples/zod-schema-migration.md` | Migrating TypeScript to Zod schemas | ⭐⭐⭐⭐ |
| `examples/subagent-prompt-structure.md` | Optimized subagent prompt template | ⭐⭐⭐⭐ |

**When to read**: When creating adapters, schemas, or optimizing subagent prompts

---

## Guides (Step-by-Step)

| File | Topic | Priority |
|------|-------|----------|
| `guides/compatibility-layer-workflow.md` | Developing compatibility layer for AI tools | ⭐⭐⭐⭐⭐ |
| `guides/testing-subagents.md` | How to test subagents standalone | ⭐⭐⭐⭐⭐ |
| `guides/adding-agent-basics.md` | How to add new agents (basics) | ⭐⭐⭐⭐ |
| `guides/adding-agent-testing.md` | How to add agent tests | ⭐⭐⭐⭐ |
| `guides/adding-skill-basics.md` | How to add OpenCode skills | ⭐⭐⭐⭐ |
| `guides/creating-skills.md` | How to create Claude Code skills | ⭐⭐⭐⭐ |
| `guides/creating-subagents.md` | How to create Claude Code subagents | ⭐⭐⭐⭐ |
| `guides/testing-agent.md` | How to test agents | ⭐⭐⭐⭐ |
| `guides/external-libraries-workflow.md` | How to handle external library dependencies | ⭐⭐⭐⭐ |
| `guides/github-issues-workflow.md` | How to work with GitHub issues and project board | ⭐⭐⭐⭐ |
| `guides/npm-publishing.md` | How to publish package to npm | ⭐⭐⭐ |
| `guides/updating-registry.md` | How to update registry | ⭐⭐⭐ |
| `guides/debugging.md` | How to debug issues | ⭐⭐⭐ |
| `guides/resolving-installer-wildcard-failures.md` | Fix wildcard context install failures | ⭐⭐⭐ |
| `guides/creating-release.md` | How to create releases | ⭐⭐ |

**When to read**: When performing specific tasks

---

## Lookup (Quick Reference)

| File | Topic | Priority |
|------|-------|----------|
| `lookup/tool-feature-parity.md` | AI coding tool feature comparison | ⭐⭐⭐⭐⭐ |
| `lookup/compatibility-layer-structure.md` | Compatibility package file structure | ⭐⭐⭐⭐⭐ |
| `lookup/subagent-test-commands.md` | Subagent testing commands | ⭐⭐⭐⭐⭐ |
| `lookup/hook-events.md` | All hook events reference | ⭐⭐⭐⭐ |
| `lookup/skill-metadata.md` | SKILL.md frontmatter fields | ⭐⭐⭐⭐ |
| `lookup/skills-comparison.md` | Skills vs other options | ⭐⭐⭐⭐ |
| `lookup/builtin-subagents.md` | Default subagents (Explore, Plan) | ⭐⭐⭐⭐ |
| `lookup/subagent-frontmatter.md` | Subagent configuration fields | ⭐⭐⭐⭐ |
| `lookup/file-locations.md` | Where files are located | ⭐⭐⭐⭐ |
| `lookup/commands.md` | Available slash commands | ⭐⭐⭐ |

**When to read**: Quick command lookups and feature comparisons

---

## Errors (Troubleshooting)

| File | Topic | Priority |
|------|-------|----------|
| `errors/tool-permission-errors.md` | Tool permission issues | ⭐⭐⭐⭐⭐ |
| `errors/skills-errors.md` | Skills not triggering/loading | ⭐⭐⭐⭐ |

**When to read**: When tests fail with permission errors

---

## Core Concepts (Foundational)

| File | Topic | Priority |
|------|-------|----------|
| `core-concepts/agents.md` | How agents work | ⭐⭐⭐⭐⭐ |
| `core-concepts/evals.md` | How testing works | ⭐⭐⭐⭐⭐ |
| `core-concepts/registry.md` | How registry works | ⭐⭐⭐⭐ |
| `core-concepts/categories.md` | How organization works | ⭐⭐⭐ |

**When to read**: First time working in this repo

---

## Loading Strategy

### For Subagent Testing:
1. Load `concepts/subagent-testing-modes.md` (understand modes)
2. Load `guides/testing-subagents.md` (step-by-step)
3. Reference `lookup/subagent-test-commands.md` (commands)
4. If errors: Load `errors/tool-permission-errors.md`

### For Agent Creation:
1. Load `standards/agent-frontmatter.md` (valid YAML frontmatter)
2. Load `standards/subagent-structure.md` (file structure)
3. Load `core-concepts/agents.md` (understand system)
4. Load `guides/adding-agent-basics.md` (step-by-step)
5. **If using external libraries**: Load `guides/external-libraries-workflow.md` (fetch docs)
6. Load `examples/subagent-prompt-structure.md` (if subagent)
7. Load `guides/testing-agent.md` (validate)

### For Issue Management:
1. Load `guides/github-issues-workflow.md` (understand workflow)
2. Create issues with proper labels and templates
3. Add to project board for tracking
4. Process requests systematically

### For Debugging:
1. Load `guides/debugging.md` (general approach)
2. Load specific error file from `errors/`
3. Reference `lookup/file-locations.md` (find files)

---

## File Size Compliance

All files follow MVI principle (<200 lines):

- ✅ Standards: <200 lines
- ✅ Concepts: <100 lines
- ✅ Examples: <100 lines
- ✅ Guides: <150 lines
- ✅ Lookup: <100 lines
- ✅ Errors: <150 lines

---

## Related Context

- `../core/` - Core system context (standards, patterns)
- `../core/context-system/` - Context management system
- `quick-start.md` - 2-minute repo orientation
- `../content-creation/navigation.md` - Content creation principles
- `plugins/context/navigation.md` - Plugin system context
- `features/navigation.md` - Feature documentation and refactoring guides

---

## Contributing

When adding new context files:

1. Follow MVI principle (<200 lines)
2. Use function-based organization (concepts/, examples/, guides/, lookup/, errors/)
3. Update this README.md navigation
4. Add cross-references to related files
5. Validate with `/context validate`
