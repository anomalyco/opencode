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
1. **A proof decides success; tests defend against regression.** These are different
   jobs and conflating them is expensive.
   - **Success** is decided by the ticket's **proof**: something you run against a
     running system, through the real entry point, that prints an observation. Red
     before the change, green after, green again on staging. The same artifact, three
     times.
   - **Regression** is defended by tests. If a behavior matters, a test asserts it, and
     never describe in prose a behavior a test could assert.

   Why the split: a test written by the same agent, from the same understanding, at the
   same time as the code cannot falsify that agent's model of the problem. If the model
   is wrong the test is wrong in the same direction, and green proves only
   self-consistency. Only contact with a running system breaks that loop. A suite that
   silently skips is worse than none — green must never be able to mean "did not run".
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
Every skill that thinks — `/design`, `/write-ticket`, `/implement` — operates from
**first principles**, not pattern-matching:
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
naming the proof in `/write-ticket`, sorting the open questions in `/design`).

## The workflow

```
/design            only when /write-ticket's checklist fails
/write-ticket      outcome + proof; you confirm the proof is real     <- gate 1
/worktree
/implement         red -> green -> regression tests -> gates -> PR
/adversarial-review  you invoke it. one pass. reports, you decide     <- gate 2
/merge             -> Merged to Staging
/deploy-staging    -> Deployed -> runs the proof -> Verified on Staging
                   -> you set Done                                    <- gate 3
```

1. **/write-ticket** — requirement → ticket carrying an **outcome** (one sentence of
   world-state change) and a **proof** (what you run, what you look at, red vs green).
   Runs the design checklist first and routes to `/design` when the work isn't decided.
   Still altitude-limited: the *what*, never the *how*.
2. **/worktree** — ticket → branch + worktree + `workspace/` context. Convention:
   ticket-id == branch name == worktree dir name. Run `/stack up` after, if the repo
   has one.
3. **/implement** — build the proof, **watch it fail**, make it pass, add the
   regression tests, run the gates, open the PR. Stops for exactly three reasons:
   can't get red · can't get green · needs a human to press something. Never reviews.
4. **/adversarial-review** — **you** invoke it, after the proof is green. One blind
   pass over what no proof covers: is the abstraction right, does the diff falsify prose
   elsewhere, does it widen a security boundary, is something dangerous sitting beside
   the change. No rounds, never blocks — it reports and you decide.
5. **/merge** — merge, set "Merged to Staging", clean up the worktree. **Never writes
   Done.**
6. **/deploy-staging** — deploy, then run the ticket's proof a third time against the
   deployed build. Writes "Verified on Staging". You set Done.

**There is no `/plan`, `/plan-review` or `/auto-implement`.** Architecture moved *up*
into `/design`, where a probe can settle it; implementation shape moved *down* past the
red run, where a real failing signal constrains it. `/plan` sat between them anchored to
nothing, which is why its output became prose that an adversarial gate then argued
about. The red run **is** the design gate — a plan is prose about code that does not
exist and cannot be falsified; a failing observation can.

`/auto-implement`'s complexity — an unbounded review loop, a blind exit gate, a
non-convergence safeguard — existed entirely because there was no decidable criterion.
Give the loop ground truth and the machinery has nothing to do.

### Execution topology — who runs each step
**One pipeline, not two.** There is no manual-vs-automated split any more: the same
steps run either way, and the only difference is whether you are watching.

You run `/write-ticket` and `/worktree` in the main checkout, then `/implement
<TICKET>` — locally, or dispatched to a cloud agent. It is the same command; a flag
decides where it runs.

That works because `/implement` has a **termination condition**: the proof goes green,
or it stops for one of three named reasons. A cloud agent cannot run a procedure full
of judgment calls about when to escalate — it can absolutely run *red? → fix → green?*.
Which is also the whole answer to "which tickets can be dispatched": attempt the red
run. If you get red, the ticket qualifies. A red run is empirical, so unlike a
classifier it cannot be talked into a yes.

Two steps stay yours by choice: invoking `/adversarial-review`, and setting Done after
the proof passes on staging.

The skills read **`.axiomic.toml`** at the repo root (ticket label, default base,
test/lint/typecheck/format commands, stack). Convention: **the Linear ticket-id IS the
branch name AND the worktree directory name** (e.g. `AXI-123`).

### Subagent model — by what the subagent does
**Always pass `model` explicitly on the `Agent` call.** Never rely on inheritance and
never Fable — inheritance is exactly how the session's model leaks into a subagent that
shouldn't have it. Two tiers, chosen by the work, not by the caller:

- **`model: "opus"` — judging and writing.** The blind skeptic in
  `/adversarial-review`, and any implementation subagent. These run where no human is
  watching, and a weak reviewer is worse than no reviewer because it returns a pass.
- **`model: "sonnet"` — gathering.** The Explore agents in `/write-ticket` and
  `/design`. They find and summarize what exists; their output is read by an Opus
  context that does the judging.

The tiers are aliases, so each always resolves to the latest model of that family.
The line is **judgment vs. retrieval**: if the subagent's verdict can gate work or its
output lands in the repo, it's Opus.

## Tickets
Every ticket has an **Outcome** (one sentence of world-state change, confirmable by
someone who does not read code) and a **Proof** (what you run, what you look at, red
today vs green after). FRs, NFRs and the **user-story impact** note are subordinate
detail — useful for implementing, not what decides done.

Never write *deterministically · always · never · under all conditions · reliably* into
a criterion without a bound that makes it observable. A universal claim cannot be
observed, only un-falsified, and "failed to falsify" is what six review rounds looks
like. One Linear team serves all repos; the repo is identified by a label
(`repo:<name>`).

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

## Guardrails (do not work around them)
- **NEVER create a Linear issue without the owner's explicit go-ahead.** Not "I inferred
  approval", not "they said start" — they have to say *file it*. This is a consultation
  rule, not a ban: tickets absolutely still get created, the owner is simply asked
  first. Found a bug mid-flow? **Surface it and wait.** Do not file it, and do not
  quietly bury it in `DEFERRED.md` either — `DEFERRED.md` is for *not now*, and a real
  finding routed there is a finding lost. Scope is **issue creation only**: updating an
  issue, commenting, moving status, and writing `/design` documents are all fine. The
  case this exists for is an unattended `/implement` noticing something and helpfully
  filing it.
- **Never read credentials/variables.** `*.tfvars`, `*.tfstate`, `.env*`, `secrets/`,
  and private keys are blocked from Read/Grep/Glob. Terraform **source** (`*.tf`) IS
  readable; variable values (`*.tfvars`) are not — secrets live in SSM, never in the
  repo. If a task truly needs a secret value, stop and ask the user. Checking whether a
  credential *exists* is fine and does not need the value — `aws ssm describe-parameters`
  lists names, `[ -n "$KEY" ]` answers yes/no.
- **No stray docs.** Only `CLAUDE.md` / `STORIES.md` / `DEFERRED.md`. Never create a
  markdown file to document code.
- **Every subagent names its model.** An `Agent` call with no `model`, or one naming a
  tier below Opus/Sonnet, is blocked. Pick the tier per "Subagent model" above — the
  hook enforces that a choice was made, not which one.

<!-- END axiomic-dev base -->

## Repo-specific (edit freely — preserved across syncs)

<!-- Stack-specific rules, commands, and architecture notes for THIS repo go here. -->
