<!-- BEGIN axiomic-dev base — synced from axiomic-dev/CLAUDE.base.md. Do not edit
     between these markers; change it in axiomic-dev and re-sync. Repo-specific rules
     go BELOW the END marker and are preserved across syncs. -->

# Axiomic dev workflow

## This repo
<!-- Filled in per-repo by `sync` from targets.toml + shared.toml. Do not edit by hand —
     these lines are regenerated on every sync; change the source, not this. -->
- **Repo:** `opencode` — GitHub `axiomic-agents/opencode`, stack `node`.
- **Linear team:** Axiomic Dev (`AXI`). One team serves every Axiomic
  repo; this repo is identified by the ticket label `repo:opencode`. Tickets and branches
  are `AXI-<n>`.

## First principles
1. **Tests are the source of truth for behavior.** If a behavior matters, a test
   asserts it. Never describe in prose a behavior that a test could assert.
2. **Code is self-documenting.** Documentation of code lives *inside* the code — clear
   names, type hints, and short docstrings on public surfaces. There are no external
   code docs.
3. **Guardrails, not trust.** Conventions are enforced by hooks, CI, and review — not
   by remembering them.

## The three memory files — the ONLY markdown allowed
This repo keeps exactly three durable docs. Creating any other `.md`, or a doc that
explains code, is a convention violation (the no-stray-docs hook blocks it). Delete
stale docs rather than add.

- **CLAUDE.md** (this file) — how to work here. Edited only when a convention changes.
- **STORIES.md** — what the system does, and must not do. The behavior spec.
- **DEFERRED.md** — backlog: anything punted, with the reason.

### STORIES.md — the behavior spec
Grouped by **user type**; every story links to the test that proves it.
- **Functional (can-do)** — what a user can do → a passing test.
- **Security (cannot-do)** — what a user must NOT do (authz, isolation, forbidden
  actions) → a **negative** test proving it is blocked.

A story without a passing test is incomplete. **Any change to a story is called out in
the ticket and the PR.**

### DEFERRED.md — the backlog sink
When you decide "not now" — out of scope, an edge case, a known limitation, a
follow-up, tech debt — write it here **instead of** leaving a `TODO` in code or
dropping it silently. One dated entry: **what · why deferred · ticket (if any)**.
Remove an item once it is promoted to a ticket.

## Self-documentation standard
- Public functions / classes / modules carry a short docstring focused on *usage* (an
  example beats prose). Let type hints carry the types — don't repeat them in prose.
- Names explain intent; comments explain *why*, never restate the code.
- Never write a markdown file to explain code. If code needs a doc to be understood,
  simplify the code.

## Operating mode: first principles
Every skill that thinks — `/write-ticket`, `/plan`, `/implement`, `/auto-implement` —
operates from **first principles**, not pattern-matching:
- **Derive the questions before asking them.** Before reaching for `AskUserQuestion`,
  reason from the actual constraints and the desired outcome to figure out which unknowns
  are genuinely *load-bearing*. Ask only those. Don't ask what you can derive; don't ask
  what doesn't change the answer.
- **Offer first-principles options, not a menu.** When a decision needs the user, present
  options you derived from the problem's structure — each with its trade-off — and a
  reasoned recommendation. Not a laundry list.
- **Reason, don't imitate.** Resolve design and implementation choices from the problem
  itself (the constraints, the invariants, the behavior we want), using existing code as
  evidence — not as a template to copy blindly.

This is the mindset; the per-skill sections say where it bites hardest (ticket altitude
in `/write-ticket`, implementation questionnaire in `/plan`).

## The workflow
Every change moves through these skills, in order. Each is one step with one job:

1. **/write-ticket** — requirement → Linear ticket. Fixes the ***what***: FRs, NFRs,
   Success Criteria, story impact. Deliberately altitude-limited — **no
   implementation-detail questions here** (those are `/plan`'s job).
2. **/worktree** — ticket → branch + worktree + `workspace/` context. Convention:
   ticket-id == branch name == worktree dir name.
3. **/plan** — ticket → a TDD plan in `workspace/plans/<ticket>.md`. Owns the ***how***:
   the implementation-detail questionnaire (data models, layout, algorithms, libraries)
   is asked and answered here.
4. **/plan-review** — adversarial gate on the plan, before any code: fresh-context
   skeptics, given only the ticket + plan file + repo, try to refute it. **Never edits
   the plan.** Skipped for trivial plans.
5. **/implement** — TDD: update STORIES.md + write failing tests, then code to green.
6. **/pr** — open the PR keyed to the ticket branch (format, lint, typecheck, test
   first).
7. **/adversarial-review** — skeptical pre-merge review. **Only reviews and reports —
   never fixes, never merges.** Comments on the PR, records the verdict in Linear, and
   returns pass / changes-needed.
8. **/merge** — merge, set Linear status, clean up the worktree.

### Execution topology — who runs each step
The workflow is designed to run **one fresh Claude Code instance per worktree**. There
are two ways to drive it:

- **Manual (you drive).** You run `/write-ticket` and `/worktree` in the main checkout,
  then **`cd` into the new worktree and start a fresh Claude Code session there** to run
  `/plan` → `/plan-review` → `/implement` → `/pr` → `/adversarial-review` → `/merge`.
  The worktree is the implementation's isolated home; the fresh session keeps its
  context scoped to that one ticket.
- **Automated (`/auto-implement` drives).** For lower-stakes work, `/auto-implement`
  runs the same chain for you. You approve the ticket up front and review the finished
  PR — nothing in between. Instead of *you* opening a session in the worktree, the main
  instance spawns a **background subagent** that does `/plan` (gated by the main
  instance running `/plan-review`) → `/implement` → `/pr`
  inside the worktree autonomously; the main instance runs `/adversarial-review`, feeds
  the findings back to that same subagent, and loops until a **blind** review — a fresh
  context given only the PR number + repo — passes; then it leaves the PR open for you.
  It never merges. (See `/auto-implement`.)

The skills read **`.axiomic.toml`** at the repo root (ticket label, default base,
test/lint/typecheck/format commands, stack). Convention: **the Linear ticket-id IS the
branch name AND the worktree directory name** (e.g. `AXI-123`).

## Tickets
Every ticket has **FRs** (functional requirements), **NFRs** (non-functional
requirements), **Success Criteria** (verifiable checkboxes), and a **user-story
impact** note (which functional/security stories are added or changed). One Linear team
serves all repos; the repo is identified by a label (`repo:<name>`).

## Branch naming
Every working branch is the Linear ticket id — `AXI-<n>` (e.g.
`AXI-2`). The ticket id is the branch name AND the worktree directory name; no
other branch naming. Branches target the repo's `default_base` (from `.axiomic.toml`).

## Testing
- **TDD is mandatory.** Red → green → refactor; tests before implementation.
- **Everything is covered.** Every story maps to a test; new code is fully covered.
- **No real external calls in tests.** Mock at the boundary; use a test database.
  Tests run in CI without a live stack.

## CI/CD & deployment
Implementations differ per repo and each migrates to this standard at its own pace; the
standard (canonical implementation: `agents-platform`) is:

- **PR gate** — every PR runs and must pass before merge: format-check, lint,
  typecheck, test (the `.axiomic.toml` commands), plus a tooling drift check that the
  repo's synced `.claude/` matches `axiomic-dev` (compare `.claude/.sync-version` to
  `axiomic-dev` HEAD).
- **Image build (CI)** — on merge to the integration branch, build **immutable
  `sha-<gitsha>`** images and push to ECR via a **GitHub OIDC role scoped to ECR-push
  only** (no ECS/Terraform perms). Single-arch, provenance/SBOM off so digests pin
  cleanly; path-filter to build only what changed. CI never deploys.
- **Deploy (CD)** — not in CI. Bump the image tag in the environment's `*.auto.tfvars`
  and `terraform apply` (tag→digest, pin the task def, health-gated rollout). The
  `/deploy-staging` skill drives this for a merged PR. **Rollback = re-pin the prior
  `sha` and apply.**
- **Migrations** — expand/contract only: every migration keeps the schema readable by
  the previous image (deploys auto-migrate on startup; rollback re-pins the prior image).
- **Infra as code** — every AWS/GitHub resource CI/CD needs (ECR repo, OIDC role,
  branch protection, secrets) is Terraform-managed (`terraform/0-core`), never click-opsed.

## Guardrails (enforced by hooks — do not work around them)
- **Never read credentials/variables.** `*.tfvars`, `*.tfstate`, `.env*`, `secrets/`,
  and private keys are blocked from Read/Grep/Glob. Terraform **source** (`*.tf`) IS
  readable; variable values (`*.tfvars`) are not — secrets live in SSM, never in the
  repo. If a task truly needs a secret value, stop and ask the user.
- **No stray docs.** Only `CLAUDE.md` / `STORIES.md` / `DEFERRED.md`. Never create a
  markdown file to document code.

<!-- END axiomic-dev base -->

## Repo-specific (edit freely — preserved across syncs)

<!-- Stack-specific rules, commands, and architecture notes for THIS repo go here. -->
