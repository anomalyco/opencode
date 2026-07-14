---
name: write-ticket
description: Turn a requirement into a well-formed Linear ticket with FRs, NFRs, success criteria, and user-story impact. Use when starting new work from a requirement, feature request, or bug.
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Agent, WebSearch, WebFetch, mcp__linear-axiomic__*
---

# write-ticket

Turn a requirement (in `$ARGUMENTS`) into a Linear ticket the rest of the workflow can
drive. The ticket is the contract: it states **FRs**, **NFRs**, **Success Criteria**,
and which **user stories** change. Do not start implementing here — this only produces
the ticket.

**Altitude — the "what," never the "how."** A ticket describes the *problem and the
outcome*: what we want to achieve, functional requirements, non-functional requirements,
which user stories change. It does **not** describe *how* to build it. **Never ask
implementation-detail questions here** (data models, file layout, algorithms, library
choices, API shapes). Those belong to `/plan`, which owns the implementation
questionnaire. If an implementation question surfaces while writing the ticket, note it
for `/plan` and move on — do not resolve it in the ticket.

**Operate from first principles.** Before asking anything, derive from first principles
which unknowns are actually *load-bearing* for defining the outcome — and ask only those.
When you present options, present first-principles-derived options with a reasoned
recommendation, not a menu. (See "Operating mode: first principles" in `CLAUDE.md`.)

## 1. Config discovery
Read `.axiomic.toml` (repo root): `ticket_label`, `github_repo`, `default_base`. Read
`.claude/axiomic-shared.toml`: `linear_team` (the one Linear team shared by every repo).
If `linear_team` is still `REPLACE_ME`, stop and ask the user to set it. Skim
`STORIES.md` to see existing user types and stories.

## 2. Understand the requirement
Parse `$ARGUMENTS`. If the ask is vague, ambiguous, or could be scoped several ways,
use `AskUserQuestion` (2–4 per round) to pin down **outcome-level** unknowns only: scope
boundaries (in/out), the user type affected, and acceptance expectations. Ask in
**rounds** until the scope is clear or the user says "no more context". Don't guess on
anything load-bearing — but keep every question at the "what/why" altitude. If a
question is really about *how* to implement, it's out of scope here; defer it to `/plan`.

## 3. Ground it in the code (scale to complexity)
For anything beyond a trivial change, spawn Explore agents **in parallel** to ground
the ticket in reality (skip for one-liners):
- **Code/architecture** — where this lives, what it touches, integration points, files
  likely to change.
- **Stories/tests** — which existing `STORIES.md` entries and `tests/` this affects,
  and what new functional/security stories it implies.
- **External docs** (only if new dependencies/APIs are involved) — web-search/fetch the
  relevant library or framework docs; note constraints and best practices.

Briefly summarize the findings before drafting, then use them to write concrete
requirements and a real file list — not placeholders.

## 4. Draft the ticket
Compose the body in this exact structure:

```markdown
## Overview
[1–2 sentences: what and why.]

## Functional Requirements (FRs)
- FR1: [observable behavior the system must have]

## Non-Functional Requirements (NFRs)
- NFR1: [performance / security / reliability / UX constraint]

## Success Criteria
- [ ] [verifiable, testable condition]

## User-story impact
- Functional (can-do): [new/changed stories, by user type — or "none"]
- Security (cannot-do): [new/changed negative stories — or "none"]

## Key files (best guess)
- `path` — [why]
```

Every FR should map to at least one Success Criterion and one planned test. If the
change adds or alters behavior, the **User-story impact** section must name the stories
— this is how `STORIES.md` stays honest.

## 5. Confirm, then create
Show the draft. On approval, create the Linear issue (team = `linear_team`, apply
`ticket_label` so the repo is identifiable):

```
mcp__linear-axiomic__save_issue(team: "<linear_team>", title: "<title>",
  description: "<body>", labels: ["<ticket_label>"])
```

Use `mcp__linear-axiomic__list_teams` / `mcp__linear-axiomic__list_issue_labels` first if you need to
resolve the team or label to an id.

## 6. Output
Report the ticket id + URL and the next step: `/worktree <TICKET-ID>`. Do not create a
branch or worktree here.

---

$ARGUMENTS
