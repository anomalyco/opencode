# Skill Registry — opencode

**Generated**: 2026-04-21  
**Mode**: engram

## User Skills

| Name | Description | Trigger | Location |
|------|-------------|---------|----------|
| effect | Answer questions about the Effect framework | Effect-related questions | `.opencode/skills/effect` (project) |
| go-testing | Go testing patterns for Gentleman.Dots, including Bubbletea TUI testing | Writing Go tests, using teatest, or adding test coverage | `~/.claude/skills/go-testing` |
| judgment-day | Parallel adversarial review protocol — dual blind judge sub-agents | "judgment day", "review adversarial", "dual review" | `~/.claude/skills/judgment-day` |
| skill-creator | Creates new AI agent skills following the Agent Skills spec | Creating a new skill, adding agent instructions, documenting patterns | `~/.claude/skills/skill-creator` |
| issue-creation | Issue creation workflow for Agent Teams Lite (issue-first enforcement) | Creating a GitHub issue, reporting a bug, requesting a feature | `~/.claude/skills/issue-creation` |
| branch-pr | PR creation workflow for Agent Teams Lite (issue-first enforcement) | Creating a pull request, opening a PR, preparing changes for review | `~/.claude/skills/branch-pr` |

## SDD Skills (internal, not auto-loaded)

| Name | Phase | Location |
|------|-------|----------|
| sdd-init | Project initialization | `~/.claude/skills/sdd-init` |
| sdd-explore | Investigation before committing to a change | `~/.claude/skills/sdd-explore` |
| sdd-propose | Change proposal with intent, scope, approach | `~/.claude/skills/sdd-propose` |
| sdd-spec | Specifications with requirements and scenarios | `~/.claude/skills/sdd-spec` |
| sdd-design | Technical design document | `~/.claude/skills/sdd-design` |
| sdd-tasks | Implementation task checklist | `~/.claude/skills/sdd-tasks` |
| sdd-apply | Code implementation following specs/design | `~/.claude/skills/sdd-apply` |
| sdd-verify | Validate implementation against specs | `~/.claude/skills/sdd-verify` |
| sdd-archive | Sync and archive completed change | `~/.claude/skills/sdd-archive` |
| sdd-onboard | Guided SDD workflow walkthrough | `~/.claude/skills/sdd-onboard` |

## Project Conventions

| File | Role | Key Rules |
|------|------|-----------|
| `AGENTS.md` (root) | Style guide + repo rules | Bun APIs preferred, no `try`/`catch`, functional array methods, self-export pattern in `src/config`, snake_case for Drizzle schemas, tests from package dirs only |
| `packages/opencode/AGENTS.md` | Database + Effect + module conventions | Drizzle schema in `**/*.sql.ts`, snake_case columns, no `export namespace Foo {}`, use `export * as Foo from "./foo"`, Effect v4 patterns (`Effect.gen`, `Effect.fn`, `makeRuntime`, `InstanceState`), `Instance.bind` for native callbacks |
| `packages/opencode/test/AGENTS.md` | Test fixtures + Effect testing | `tmpdir()` fixture with `await using`, `testEffect(...)` for Effect tests, `it.live` vs `it.effect`, `provideTmpdirInstance` pattern |

## Deduplication Notes

- Both `~/.claude/skills/` and `~/.config/opencode/skills/` contain identical skill sets. User-level dir (`~/.claude/skills/`) is the canonical source.
- `.opencode/skills/` contains one project-specific skill: `effect`.