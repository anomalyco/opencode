# Agent Guidelines for oclite

> Lightweight fork of OpenCode by Anomaly, optimized for agentic workflows.

**Stack:** Bun 1.3+, TypeScript, SolidJS, Tauri, Turborepo monorepo  
**Default branch:** dev

---

## Context7 Protocol

**MANDATORY: Use context7 before ANY programming task.**

```
Before writing code:
1. Resolve library ID with context7
2. Query documentation for current API patterns
3. Verify syntax and best practices

Training data may be outdated. Context7 is authoritative.
```

When to use: Library APIs, framework patterns, configuration options, any code involving external dependencies.

---

## Agent Hierarchy

### Project Manager

- Orchestrates work across specialists
- Delegates tasks, never executes code
- Coordinates multi-agent workflows

### Specialists

| Agent                  | Domain                | Capabilities                     |
| ---------------------- | --------------------- | -------------------------------- |
| developer              | Code implementation   | Write, refactor, test code       |
| git-agent              | Version control       | Commits, branches, PRs           |
| code-review-specialist | Quality assurance     | Review PRs, enforce standards    |
| research-specialist    | Information gathering | Research, documentation          |
| adversarial-developer  | Security testing      | Find vulnerabilities, edge cases |
| explore                | Codebase navigation   | Search, understand architecture  |

### Delegation Rules

PM delegates → Specialists execute → Report back to PM. All work traces back to GitHub issues.

---

## Issue-Driven Development

**All work must match GitHub issue content exactly.**

```bash
# Before starting work
gh issue view #123
```

Validate: Does task match issue? Am I adding unrequested features? Refuse work not explicitly listed. If scope needs expansion, update the issue first.

---

## Quality Gates

### Zero Bypasses

**Forbidden in source code:**

```typescript
// @ts-ignore
// @ts-expect-error
// eslint-disable
as any
```

If the type system complains, fix the underlying issue.

### Zero Technical Debt

**Forbidden in source code:**

```typescript
// TODO
// FIXME
// HACK
// XXX
```

If work must be deferred, create a GitHub issue. The issue IS the TODO.

---

## Pre-Push Verification

**CI is for VERIFICATION, not DISCOVERY.**

Before ANY `git push`, all checks must pass locally:

```bash
# In packages/opencode directory
bun run typecheck   # 0 errors (uses tsgo --noEmit)
bun test            # 0 failures

# From repo root
bun typecheck       # Runs turbo typecheck across workspace
```

Never push to "see if CI catches anything." Fix locally first.

---

## Minimalist Engineering

**Every line of code is a liability.**

Before creating anything:

1. **Is this explicitly required** by the GitHub issue?
2. **Can existing code/tools** solve this instead?
3. **What's the SIMPLEST** solution?
4. **Am I building for hypothetical** future needs?

If you cannot justify necessity, DO NOT CREATE IT.

```
❌ "This might be useful later"
❌ "Future-proofing"
✅ "The issue explicitly requires this"
✅ "Simplest working solution"
```

---

## Module Size Limits

| Type         | Hard Limit | Ideal     |
| ------------ | ---------- | --------- |
| Source files | 500 lines  | 300 lines |
| Test files   | 800 lines  | 500 lines |

Refactor trigger: File exceeds 500 lines OR has 3+ distinct responsibilities.

---

## Monorepo Structure

```
packages/
├── opencode/     # Core CLI and TUI
├── app/          # Web UI (SolidJS)
├── desktop/      # Tauri desktop app
├── web/          # Documentation site
├── ui/           # Shared UI components
├── util/         # Shared utilities
├── sdk/js/       # JavaScript SDK
├── plugin/       # Plugin system
├── function/     # Cloud functions
├── identity/     # Auth services
├── console/      # Admin console
└── enterprise/   # Enterprise features
```

---

## Development Commands

### From repo root

```bash
bun install              # Install all dependencies
bun typecheck            # Type check entire workspace
bun dev                  # Run TUI (defaults to packages/opencode)
```

### From packages/opencode

```bash
bun dev                  # Run TUI
bun dev -- serve         # Headless API server (port 4096)
bun run typecheck        # Type check (tsgo --noEmit)
bun test                 # Run tests
bun run build            # Build binaries
```

### From packages/app

```bash
bun dev                  # Start web UI dev server
bun test:e2e:local       # Run Playwright E2E tests
```

---

## TypeScript Style Guide

Reference: `STYLE_GUIDE.md`

### Prefer const over let

```typescript
// Good
const value = condition ? 1 : 2

// Bad
let value
if (condition) value = 1
else value = 2
```

### Avoid else statements

```typescript
// Good
function process(input: string) {
  if (!input) return null
  return input.trim()
}
```

### Single word naming

```typescript
// Good
const result = calculate(input)

// Bad
const calculatedResult = calculate(userInput)
```

### Avoid destructuring

```typescript
// Good - preserves context
console.log(user.name, user.email)

// Bad - loses context
const { name, email } = user
```

### Use Bun APIs

```typescript
// Good
const content = await Bun.file(path).text()
await Bun.write(path, content)
```

### Avoid any type

```typescript
// Good
function process(data: unknown): Result {
  if (isValid(data)) return transform(data)
  throw new Error("Invalid data")
}
```

### No semicolons, minimal trailing commas

```typescript
const config = {
  name: "opencode",
  version: "1.0.0",
}
```

---

## Conventional Commits

Format: `type(scope): description`

| Type     | Use Case                    |
| -------- | --------------------------- |
| feat     | New feature                 |
| fix      | Bug fix                     |
| docs     | Documentation only          |
| refactor | Code change, no feature/fix |
| test     | Adding or updating tests    |
| chore    | Maintenance tasks           |
| ci       | CI configuration            |
| perf     | Performance improvement     |

Examples:

```bash
feat(opencode): add file watcher for hot reload
fix(app): prevent crash on empty session
refactor(util): simplify path resolution
chore: update dependencies
```

---

## Git Workflow

### Branch Strategy

```
main ← production releases
dev ← active development (default)
feature/* ← feature branches
fix/* ← bug fix branches
```

### Standard Flow

```bash
# 1. Create branch from dev
git checkout dev && git pull origin dev
git checkout -b feature/issue-123-description

# 2. Implement with TDD
# Write tests → Write code → Refactor

# 3. Verify locally
bun run typecheck && bun test

# 4. Commit with conventional format
git add . && git commit -m "feat(opencode): implement feature (#123)"

# 5. Push and create PR
git push -u origin feature/issue-123-description
gh pr create --base dev --title "feat(opencode): implement feature (#123)" --body "Fixes #123"
# Code review happens on the PR before merge
```

---

## PR Workflow

### Code Review Requirements

- PRs require code-review-specialist approval before merge
- Code review happens via GitHub PR review functionality
- Reviews check: style compliance, test coverage, security, architecture
- If CHANGES_REQUESTED: fix issues and re-request review
- If APPROVED: proceed with merge when CI passes

### Auto-Merge Policy

- PRs in APPROVED state with all CI checks passing:
  - PR creator: Squash merge immediately
  - GitHub: Auto-deletes feature branch
  - Close linked issue
- PRs in PENDING or CHANGES_REQUESTED: MUST NOT be merged
- If CI fails after approval: Fix issues, re-push, approval must be re-requested
- Do not wait for additional approvals on reviewed PRs

### PR Batching

- Related issues can be combined into single PR when:
  - They share a logical unit of work
  - Combined changes are under 500 lines
  - All issues are from same epic
- Each PR must reference all included issues with "Fixes #X" syntax

---

## No Deprecated Code

**Unreleased software has no backward compatibility requirements.**

```
❌ Mark as deprecated
❌ Keep for compatibility
✅ Delete old code
✅ Update all usages
```

When changing APIs: Find all usages → Update them → Remove old code → Single commit.

---

## Testing Strategy

### Test Organization

```
packages/opencode/
├── src/feature/feature.ts
└── test/feature/feature.test.ts
```

### TDD Workflow

1. Write failing test
2. Write minimal code to pass
3. Refactor
4. Repeat

### Coverage Requirements

- All new code must have tests written BEFORE implementation
- Minimum 80% coverage for new code
- Tests must be in corresponding test/ directory

Run tests: `bun test` or `bun test --coverage`

---

## Documentation Policy

### The 200-PR Test

Before creating documentation, ask: **"Will this be true in 200 PRs?"**

| Answer | Action                       |
| ------ | ---------------------------- |
| YES    | Document the principle (WHY) |
| NO     | Skip or use code comments    |

**Forbidden:** Issue drafts, implementation summaries, fix notes, scratch files.

**Allowed:** README.md, AGENTS.md, STYLE_GUIDE.md, API documentation, ADRs.

---

## Error Handling

### Prefer Result Types

```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

function parse(input: string): Result<Config> {
  if (!input) return { ok: false, error: new Error("Empty input") }
  return { ok: true, value: JSON.parse(input) }
}
```

### Early Returns

```typescript
function process(data: Input) {
  if (!data) return null
  if (!data.valid) return null
  return transform(data)
}
```

---

## Environment Variables

### Required

```bash
ANTHROPIC_API_KEY    # For Anthropic models
OPENAI_API_KEY       # For OpenAI models
```

### Development

```bash
OPENCODE_TEST_HOME             # Test data directory
OPENCODE_DISABLE_MODELS_FETCH  # Skip model API calls
OPENCODE_DISABLE_SHARE         # Disable sharing features
OPENCODE_CLIENT                # Client identifier (app, cli)
```

---

## MCP Server Integration

```json
{
  "mcpServers": {
    "server-name": {
      "command": "path/to/server",
      "args": ["--flag"],
      "env": { "API_KEY": "value" }
    }
  }
}
```

Built-in tools: File operations, shell execution, search (glob, grep), web fetch.

---

## Security Guidelines

**Never Commit:** `.env`, `*.pem`, `*.key`, `credentials.json`

- Use environment variables for secrets
- Never hardcode API keys
- Review dependencies before adding

---

## CI Workflows

| Workflow | Trigger          | Purpose              |
| -------- | ---------------- | -------------------- |
| ci.yml   | PR, push to main | Type check and tests |

Monitor with: `gh run watch [run-id]`

---

## Agent Communication

### Handoff Protocol

1. Provide GitHub issue reference
2. Specify exact scope
3. Define success criteria
4. Request completion report

### Status Reports

Specialists report: What was done, what was tested, any blockers, ready for review?

---

## Common Pitfalls

```
❌ Pushing without local verification
❌ Expanding scope beyond issue
❌ Adding "helpful" features
❌ Leaving TODO comments
❌ Using @ts-ignore
❌ Committing .env files

✅ Local verification before push
✅ Strict issue scope adherence
✅ Minimal viable solution
✅ GitHub issues for future work
✅ Proper type definitions
✅ Environment variables for secrets
```

---

## Quick Reference

### Before Writing Code

```bash
# Check context7 for current documentation
gh issue view #123
```

### Before Pushing

```bash
bun run typecheck && bun test
```

### Before Merging

- PR is in APPROVED state
- All CI checks pass
- Issue requirements met
- Conventional commit used

---

## Summary

1. **Use context7** before any code
2. **Follow issue scope** exactly
3. **Verify locally** before push
4. **No bypasses** or technical debt
5. **Minimalist** - every line justified
6. **Conventional commits** always
7. **Auto-merge** after approval + CI
8. **Delete** don't deprecate
