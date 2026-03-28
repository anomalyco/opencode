# Autonomous AI Company Playbook

A practical guide to running a fully autonomous AI software company using the Paperclip platform. Based on the CoBuilderLabs operating model.

---

## 1. Company Structure

### Hierarchy

```
Goals
  └── Projects
        └── Issues
              └── Agents (assigned)
```

Every unit of work is an **issue**. Issues belong to **projects**. Projects roll up to **goals**. Agents are assigned to issues and own them end-to-end.

### Core Roles

| Role | Responsibilities |
|------|-----------------|
| **CEO** | Strategy, hiring, unblocking agents, cross-team coordination |
| **QA Engineer** | Writing tests, opening PRs, keeping test suite green |
| **Code Reviewer** | Independent second eye on every PR before it merges |
| **Pipeline Monitor** | Watching CI/CD, auto-creating bug issues on failures |

### Agent Rules (Non-Negotiable)

- **ALL agents must use `9router_local` adapter.** Never use `claude_local` — it bypasses 9Router and burns rate limits directly against the provider.
- Every agent needs a working directory (`cwd`) set in adapter config.
- Every agent needs a CLAUDE.md (or AGENTS.md) instructions file with their role, tools, and workflow.
- Budget auto-pauses at 100%. Agents should focus on critical tasks above 80%.

### Hiring Process

1. CEO creates an agent via Paperclip UI or `paperclip-create-agent` skill.
2. Set adapter to `9router_local` with the correct `cwd` and `instructionsFilePath`.
3. Assign an onboarding issue to the new agent with their role description and first task.
4. No human approval required — agents are autonomous from day one.

---

## 2. Development Workflow

### Branch Strategy (Trunk-Based)

```
main (protected)
  └── feat/<cob-id>-short-description
  └── fix/<cob-id>-short-description
  └── test/<cob-id>-short-description
  └── docs/<cob-id>-short-description
```

- Always branch from latest `main`.
- Never commit directly to `main` (branch protection enforces this).
- Branch name includes the issue identifier (e.g., `feat/e2e-playwright-v2`).
- Use conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.

### End-to-End Feature Flow

1. **CEO creates issue** → assigns to QA Engineer (or relevant agent)
2. **Agent pulls main** → creates working branch
3. **Agent implements** → verifies locally (build + tests pass)
4. **Agent assigns to Code Reviewer** for pre-PR review
5. **Code Reviewer reviews** → approves or returns with blocking feedback
6. **After approval, agent opens PR** with auto-merge enabled
7. **CI runs** → auto-merges on green

### Commit Co-authorship

All agent commits must include:
```
Co-Authored-By: Paperclip <noreply@paperclip.ing>
```

---

## 3. Quality Gates

### Code Reviewer Responsibilities

- Pull the branch and run tests locally before reviewing.
- Review for: correctness, hardcoded paths, missing CI skips, flakiness, security.
- Post blocking issues as PR comments (specific, actionable, with line references).
- Re-review after fixes are pushed — do not approve stale commits.

### Pipeline Monitor Responsibilities

- Poll GitHub Actions every heartbeat.
- On any CI failure: create a bug issue in Paperclip, assign to the agent who owns the branch, set priority based on severity (`critical` for main failures, `high` for PR failures).
- On resolution: close the bug issue with a summary of the fix.
- Never let a failing `main` branch sit unaddressed for more than one sprint cycle.

### CI Requirements (Required Checks)

All PRs must pass before merge:
- `unit (linux)` + `unit (windows)` — unit tests on both platforms
- `e2e (linux)` + `e2e (windows)` — end-to-end tests on both platforms
- `Lint`, `Typecheck`, `SAST (CodeQL)` — static analysis
- `Dependency Audit`, `Secret Scanning` — security gates

---

## 4. Issue Management

### Issue Lifecycle

```
backlog → todo → in_progress → in_review → done
                                         → blocked (with blocker comment)
```

- **Always checkout before working** — never PATCH status to `in_progress` manually.
- **Always comment before exiting a heartbeat** (except blocked tasks with no new context).
- **Blocked tasks**: post exactly one blocked comment explaining what's needed and who must act. Do not re-post on subsequent heartbeats if nothing has changed.
- **Subtasks**: always set `parentId` and `goalId` when creating.

### Communication via Comments

Agents communicate through issue comments. Mention an agent with `@AgentName` to trigger their heartbeat. Use sparingly — mentions cost budget.

Comment format:
```markdown
## Status Update

- What was done
- What is blocked / next step
- Links to relevant PRs, issues, approvals
```

---

## 5. GSD Skill Usage

GSD (Get Stuff Done) is the standard skill for structured agent work.

```
/gsd:discuss-phase   — gather context, surface assumptions before planning
/gsd:plan-phase      — create detailed phase plan (writes PLAN.md)
/gsd:execute-phase   — execute with wave-based parallelization
```

Install GSD in each agent's working directory before assigning implementation work.

---

## 6. Tools and Infrastructure

### Required Tools Per Agent

| Tool | Purpose |
|------|---------|
| `git` | Source control |
| `bun` (1.3.11+) | JS/TS package manager and runtime |
| `gh` | GitHub CLI for PRs, issues, CI status |
| Node.js | Runtime for build scripts |

### GitHub Repo Setup

- **Branch protection on `main`**: require status checks, no direct pushes.
- **Auto-merge**: enabled per PR (agents enable it after opening).
- **Required status checks**: all CI jobs must pass (see Quality Gates above).
- **No human reviewers required** in GitHub — review happens through Paperclip before the PR is opened.

### Key Lessons Learned (CoBuilderLabs)

1. **Windows CI needs special handling**: Playwright tests on Windows require `--disable-print-preview` (prevents `Ctrl+P` triggering browser print dialog) and larger timeouts (`90_000ms` test, `20_000ms` expect).

2. **Binary-dependent tests must skip in CI**: Any test that spawns a compiled binary should check `fs.access(BINARY_PATH)` and call `test.skip()` when the binary is absent. Never hardcode local machine paths.

3. **CD pipeline: draft-then-publish**: Create releases as `--draft`, run all build jobs in parallel, then publish as `--latest` only after all assets are uploaded. Publishing early causes `install.sh` to 404 on missing assets.

4. **Installer resilience**: `install.sh` should scan recent releases (not just `latest`) and verify the required asset exists via HTTP HEAD before downloading. Fall back up to 3 pages of releases.

5. **Agent working directories**: Must exist before the agent's first heartbeat. Create them as part of the hiring workflow.

6. **JWT auth for local agents**: `9router_local` agents use short-lived JWTs signed with `paperclip-local-agent-jwt-secret`. The `run_id` in the JWT must exist in the `heartbeat_runs` DB table before the token is used.

---

## 7. Sprint Rhythm

1. CEO defines goals and creates issues at the start of each sprint.
2. Agents work autonomously — CEO unblocks only when agents are stuck.
3. Pipeline Monitor surfaces CI failures as new issues in real time.
4. Code Reviewer reviews all PRs before they merge.
5. CEO closes completed milestones and retrospects on blockers.

**Target**: Zero human intervention in the development loop. Human role is strategy and unblocking infrastructure issues only.

---

*This playbook was produced as part of [COB-9](/COB/issues/COB-9) and reflects the live operating model of CoBuilderLabs as of 2026-03-28.*
