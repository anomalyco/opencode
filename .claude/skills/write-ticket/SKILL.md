---
name: write-ticket
description: Turn a requirement into a Linear ticket carrying an outcome and a runnable proof. Runs the design checklist first and routes to /design when the work is not yet decided. Use when starting new work from a requirement, feature request, or bug.
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Agent, WebSearch, WebFetch, mcp__linear-axiomic__*
---

# write-ticket

Turn the requirement in `$ARGUMENTS` into a ticket the rest of the workflow can drive.

A ticket is two things:

- **Outcome** — one sentence of world-state change, phrased so someone who does not
  read code could confirm it. *"Leo's org can start runs again after clients
  disconnect."* Not a list of behaviours.
- **Proof** — what you run to see it, and what you look at. Red before the fix, green
  after, green again on staging. **The same artifact, three times.**

Everything else — FRs, NFRs, story impact — is subordinate detail that helps someone
implement. It is not what decides done.

**Why this and not success criteria.** A criterion like *"an abandoned stream releases
its slot deterministically"* is universally quantified: it cannot be observed, only
un-falsified. Six review rounds is what "failed to falsify" looks like. A proof is
bounded — *"abandon 50 streams; `current_count` returns to baseline within 60s"* — same
intent, decidable.

**Altitude.** Still the *what*, never the *how*. No data models, file layout,
algorithms or library choices. Those are settled after the red run, where a real
failing signal constrains them.

## 1. Config discovery
Read `.axiomic.toml` (`ticket_label`, `github_repo`, `default_base`) and
`.claude/axiomic-shared.toml` (`linear_team`). Skim `STORIES.md`.

## 2. The design checklist — run this FIRST

Design is **not** something the user invokes. It is what happens when this checklist
fails. Ask, in order:

1. **Can you name the proof?** What command, and what do you look at?
2. Is this net-new — is there nothing yet to modify?
3. Does it introduce or reshape a persistent data model?
4. Does it create a new boundary between services or components?
5. Is it more than one ticket's worth of work?
6. Is there a real "which way" question with two or more defensible answers?

**Any yes to 2–6, or a no to 1 → stop and run `/design`.** Items 2–6 are mostly
predictors of item 1; **the inability to say what you would run is the real detector.**

Bugs almost never trip this. Something exists and behaves wrong: the design is
settled, the proof is "reproduce it".

## 3. Ground it in the code
For anything beyond a trivial change, spawn Explore agents **in parallel** with
`model: "sonnet"` (they gather; see "Subagent model" in `CLAUDE.md`):
- where this lives, what it touches, which files change
- which `STORIES.md` entries and tests it affects
- external docs, only if a new dependency or API is involved

Use the findings to write a **concrete** proof — a real command against real paths, not
a placeholder.

## 4. Write the proof

For each thing the outcome asserts, name:

| | |
|---|---|
| **Run** | the literal command |
| **Red** | what you see today — the bad state |
| **Green** | what you see after — the good state |
| **Stack** | in-process app + real DB · local stack · deployed staging · browser+login · external |

Rules that make a proof real:

- It runs against a **running system**, not an import of a module.
- It goes through the **real entry point** — HTTP, UI, queue, CLI — not a function call.
- It **prints an observation** a human could read.
- It is the **same artifact** before and after.

**The agents doing this work have a browser and can log in** (Playwright MCP is
configured in every repo's `.mcp.json`, no setup). Staging is reachable via
`/impersonate-customer`, `/staging-db` and `AWS_PROFILE=axiomic-terraform` (region
`us-east-2`; the profile carries no default region). So "click it and look" is a
machine-runnable proof — do not fall back to asking a human for anything a browser can
observe.

**Banned in a proof:** *deterministically · always · never · under all conditions ·
reliably*, unless followed by a bound that makes them observable. If you catch yourself
writing one, the criterion is not yet decidable — bound it, or send it to `/design`.

**When the outcome is a judgment.** Some things genuinely resist — "does this read as
one product family". Do not fake a threshold. Say plainly that a human reads the
result, and still name the measurement they will read. What must never happen is
agents arguing about something nobody measured.

## 5. Can the proof actually be run? Check, do not assume

A proof nobody can run is not better than no proof. Work out what this one needs, and
**look up whether it is there** — do not guess, and do not defer the discovery to
`/implement`, where the owner is no longer in the room.

Things that have actually been needed:

| Needs | Typically for |
|---|---|
| An LLM provider key | any proof that runs an agent end-to-end — the most common by far |
| AWS (`AWS_PROFILE=axiomic-terraform`, region `us-east-2`) | anything touching staging, KMS, SSM, ECS |
| A GitHub or Linear token | a real talos dispatch |
| `PLATFORM_INTERNAL_TOKEN` | mitmproxy's egress policy — **empty locally means every CONNECT is allowed**, so a proof about egress rules silently proves nothing |
| A running stack | anything hitting a database (`/stack up`) |
| Clerk | forge auth. spine has a dev bypass (`env == "dev"` + `clerk_jwt_enforce=False`) and does not |

**Check existence, never read values.** `aws ssm describe-parameters` lists names
without values; `[ -n "$SOME_KEY" ]` answers yes/no. `.env` is blocked from Read/Grep by
`block-infra-secrets.py` and that guardrail stays — if you find yourself wanting to
`cat` it "just to check", that is the hook working, not an obstacle.

**If something is missing, ask the owner.** They provide it, then the ticket is created.
This is the whole reason the check lives here rather than in `/implement`: the owner is
already present for the gate in §7, so asking costs one sentence — whereas the same
question at implementation time stalls an unattended lane.

**Record the requirement in the ticket — the requirement, never the value.** One line:
*"proof needs an LLM key for fireworks and a GitHub token with repo scope."* That makes
a failure six days later legible instead of mysterious, and it is exactly what a
dispatcher would check before picking the ticket up.

Availability is a snapshot, not a guarantee — a key present today can be rotated before
anyone implements this. That is fine and expected; `/implement` still fails loudly if
something has gone.

## 6. Draft

```markdown
## Outcome
[one sentence of world-state change]

## Proof
| # | Run | Red today | Green |
|---|---|---|---|
| 1 | `<command>` | <bad state> | <good state> |

Stack: <what it needs to run against>
Needs: <credentials/access the proof requires — names only, never values; "nothing" is a valid answer>

## Detail
- FRs / NFRs / constraints worth knowing — subordinate to the proof above.

## Story impact
- Functional (can-do): [new/changed stories, or "none"]
- Security (cannot-do): [new/changed negative stories, or "none"]

## Key files (best guess)
- `path` — [why]
```

## 7. The gate — required, every ticket

Show the draft and ask the one question no machine can answer:

> **Does this proof actually decide the outcome?**

This is the only place a human is irreplaceable, and it is one read. A proof can be
technically runnable and still miss the point; a person spots that in seconds. Getting
it right here is worth more than every downstream gate combined — criteria quality
predicted review-round count 5 times out of 5 across the AXI-142 / AXI-65 retrospective.

`AskUserQuestion`: **Approve / Revise / Send to design**. Only on approve:

```
mcp__linear-axiomic__save_issue(team: "<linear_team>", title: "<title>",
  description: "<body>", labels: ["<ticket_label>"])
```

## 8. Output
Report the ticket id + URL. Next step: `/worktree create <TICKET>`, then
`/implement <TICKET>`. Do not create a branch here.

---

$ARGUMENTS
