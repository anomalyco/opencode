# Backlog review: OpenCode coding surface → moks TA surface

**Purpose:** decide *what* to port, hide, or drop — grounded in **current moks/OpenCode implementation**, not abstract product wishes.  
**Companion HTML:** `docs/backlog-coding-to-ta.html` (non-technical decision overview; this file is the review source of truth).  
**Related:** `docs/ROADMAP.md`, `docs/FORK.md`, `docs/gtm.html`.

---

## Thesis (locked 2026-08-11)

> **moks is to Talent Acquisition what OpenCode is to software engineering.**  
> **Code is everything** means the *shape* of agentic work is domain-portable: workspace, plan, tools, permissions, local working copy, remote system of record, review, and push.  
> We do **not** rebuild the harness. We **rewrite the job object** from “ship software” to “fill reqs / move candidates.”

| | Software engineering (OpenCode) | Talent acquisition (moks) |
|--|--------------------------------|---------------------------|
| **Job** | Write and ship software | Fill requisitions; move candidates with evidence |
| **Unit of work** | Repo / project | **Requisition (req)** |
| **Remote / system of record** | GitHub | **ATS (e.g. Ashby)** |
| **Local working tree** | Filesystem clone of the repo | **`.moks/` req workspace** (JD, scorecard, notes, drafts, receipts) |
| **See what changed** | Diff / modified files | **Diff of local candidate & req artifacts** (real-time, like code) |
| **Review before merge** | PR / code review | **Packet review** (resume vs JD/scorecard, outreach, disposition) |
| **Commit locally / stage intent** | `git commit` (and related) | Local artifacts + **`moks commit`** (receipt) |
| **Push to remote** | `git push` / merge to default | **`moks push`** (records push after commit; ATS write path later) |
| **Bootstrap unit of work** | `/init` → project rules (AGENTS.md) | `/init` → **new req workspace** |
| **Primary doer** | `build` | **`recruit`** (`build` = hidden escape hatch) |
| **Strategy mode** | Plan → implement code | Plan → **execute hiring next steps** |
| **Recon subagent** | Explore codebase | Explore **req materials / fixtures / notes** |
| **IDE helpers (LSP, formatters)** | Core coding UX | **Not a TA product surface** — defaults off; keep code for `build` |

### Porting rule (non-negotiable)

> **Mold the harness, don’t rebuild.**  
> Keep session runner, permissions engine, MCP host, skill loader, multi-provider, plan-mode *machinery*.  
> Change **prominence, defaults, copy, agent wiring, and workspace paths**.

A **wrong port** renames surface labels but leaves the *workflow semantics* as “write code / review PR / implement plan.”  
A **correct port** preserves the *machinery* and rewrites the *job* to eng-TA: load req → score → outreach → **commit** → **push**.

### Metaphor guardrails (do not overfit)

| Tempting map | Stance |
|--------------|--------|
| Diff *only* = remote ATS fields | **No** — diff shows **local** working-tree + pending commit deltas (like uncommitted + staged). Remote ATS truth updates on **push** (when write sink exists). |
| Branch = pipeline stage | **Don’t force** git-branch UX onto ATS stages |
| “Candidates are code” | **No** — *workflow shape* is portable; people aren’t files. Working set = materials + records + drafts |
| Delete LSP/diff subsystems | **No** — hide/demote on `recruit`; full chrome on `build` dogfood |

---

## How to review this doc

For each item, answer three questions:

1. **Is the “Current” section accurate?** (files + behavior match what you see in code)
2. **Is the “Correct port” the right *semantic* mapping?** (TA equivalent of the OpenCode concept — not a naive string swap)
3. **Do we GO / DEFER / DROP?** (product call; recommendations are marked **Rec:**)

Use the decision boxes at the bottom of each card. Flip them when agreed.

---

## OpenCode surface map (what we are porting *from*)

Understanding these layers is required for correct ports. Product path today is still largely **V1** (`packages/opencode` agents + session). **V2** seeds live in `packages/core` and still default to coding.

```
┌─────────────────────────────────────────────────────────────────┐
│  SURFACE (user-felt)                                            │
│  TUI tips, sidebars, slash commands, CLI help, upsells, themes  │
├─────────────────────────────────────────────────────────────────┤
│  PERSONAS                                                       │
│  primary: recruit | plan   (build = hidden escape hatch)        │
│  subagents: general | explore                                   │
│  hidden: build | compaction | title | summary                   │
├─────────────────────────────────────────────────────────────────┤
│  WORKFLOWS                                                      │
│  plan_enter → plan agent → plan file → plan_exit → recruit      │
│  /init → .moks/req · /review → packet · skills · MCP            │
├─────────────────────────────────────────────────────────────────┤
│  WORKSPACE IDENTITY                                             │
│  opencode.json · .opencode/ · ~/.config/opencode · OPENCODE_*    │
├─────────────────────────────────────────────────────────────────┤
│  KERNEL (do not rebuild)                                        │
│  session, permissions, tools, MCP, providers, receipts/verbs    │
└─────────────────────────────────────────────────────────────────┘
```

### Agent system prompt selection (critical)

From `session/llm/request.ts`:

```
system = [ agent.prompt ?? SystemPrompt.provider(model), ...env/skills, ... ]
```

| Agent | Custom `agent.prompt`? | Effective persona today |
|-------|------------------------|-------------------------|
| **recruit** | Yes — `product/agents/recruit.txt` | Hiring (correct); product default doer |
| **build** | No | Provider SE prompts — coding; **hidden** unless `default_agent: build` / `--agent build` |
| **plan** | No custom agent.prompt; **hiring** reminders injected | `plan-mode.txt` / `plan.txt` are hiring strategy (done G3) |
| **general** | No | Provider SE prompts → **spawns as coding agent** (open) |
| **explore** | Yes — `agent/prompt/explore.txt` | Still codebase-flavored (open BL-005) |
| **compaction / title / summary** | Yes | Coding/PR-flavored copy (open BL-006) |

**Port implication:** doer + plan exit/copy are hiring-native. Explore, general, and hidden summarizers still reintroduce coding semantics mid-loop.

### Plan mode machinery (shipped G3 — keep; do not rebuild)

| Piece | Role now | File(s) |
|-------|----------|---------|
| `plan` agent | Primary; edit only plan markdown (`.moks/plans` + legacy `.opencode/plans`) | `agent/agent.ts` |
| Plan path | Prefer `.moks/plans/{created}-{slug}.md`; dual-read legacy `.opencode/plans` | `session/session.ts` `plan()` |
| `plan_exit` tool | Question → synthetic user msg with **`agent: "recruit"`** + hiring execute text | `tool/plan.ts` |
| Reminders | Inject hiring plan-mode; on leave-to-`recruit`, inject `doer-switch.txt` | `session/reminders.ts` |
| Plan workflow text | Explore **req materials** → hiring strategy → artifacts → `plan_exit` | `session/prompt/plan-mode.txt` |
| Flag | `experimentalPlanMode` gates richer path | `session/reminders.ts`, tool registry |

### Default permissions (`recruit` path-scoped — BL-015 shipped)

`Permission.fromConfig` defaults (`agent/agent.ts`):

- `"*": "allow"` (broad baseline)
- `question` / `plan_enter` / `plan_exit` denied by default, then **allowed on recruit/build/plan** as appropriate
- `recruit` **adds**: `question`, `plan_enter`, Ashby read allow / write deny, **`edit: * → ask`**, **`.moks/*` + fixtures + `.gitignore` → allow**
- **Residual:** bash still broadly allow (decision verbs via shell); destructive bash patterns still open

### Already correct (baseline — do not re-open)

| Surface | From (upstream coding) | To (moks now) | Where |
|---------|------------------------|---------------|-------|
| Default primary agent | `build` | **`recruit`** (unless `default_agent` config) | `agent/agent.ts` |
| Product doer persona | SE system only | `product/agents/recruit.txt` | agent prompt field |
| Build agent | default coding doer | **hidden** escape hatch (`--agent build` / `default_agent: build` unhides) | `agent/agent.ts` |
| Plan exit target | `build` | **`recruit`** + hiring execute synthetic | `tool/plan.ts`, TUI, `doer-switch.txt` |
| Plan workflow copy | SE design / codebase explore | **Hiring strategy** (req materials, artifacts, skills/verbs) | `plan-mode.txt`, `plan.txt`, plan agent desc |
| Plan path | `.opencode/plans` | **`.moks/plans`** prefer + dual-read/allow legacy | `session/session.ts`, plan edit globs |
| Hiring skills | none | `req-context`, `score-candidate`, `draft-outreach`, `commit-disposition` | `product/skills/*`, registered in `skill/index.ts` |
| Write authority | raw ATS | **`commit`** → receipt → **`push`** (receipt; ATS sink later) | CLI + decision layer |
| Fixtures | none | JD/resume/scorecard + Ashby mock MCP | `product/fixtures/` |
| User-facing bin | `opencode` | **`moks`** | `cli` / `index.ts` `scriptName` |

**Still coding by design (keep):** monorepo `.opencode/` with `default_agent: build` (+ unhide) configures the *installed* agent that builds moks — not the product.

**Locked product decisions (2026-08-11):**

- **Cast:** OpenCode Build doer → **`recruit`**; Plan stays; **`build` hidden** escape hatch (not deleted).
- **G3 plan wave:** BL-001, BL-002, BL-022 **done** — exit/copy/path are hiring-native.
- **Domain ontology:** req = repo; ATS = GitHub/remote; `.moks/` = local working tree; diff = local candidate/req changes; **`moks commit` / `moks push`** (git metaphor); `/init` = new req; `/review` = packet review skill (not git/PR).
- **LSP:** not a TA product surface (defaults off; chrome hidden when off; code kept for `build`).
- **Diff:** keep and lean into — real-time visibility of local hiring deltas (like code changes).
- **Shipped 2026-08-11 (this wave):** BL-004, BL-007, BL-008, BL-013, BL-015 + verb rename propose→**commit**, apply→**push**.

---

## Legend

| Tag | Meaning |
|-----|---------|
| **PORT** | Rewrite coding *semantics* into TA equivalent; keep machinery |
| **DONE** | Shipped on product path; “Current” below is historical unless noted |
| **HIDE** | Soft-remove from default `recruit` UX; keep code for `build` / dogfood |
| **DROP** | Quarantine from TA GTM / help / slash defaults |
| **KEEP** | Already correct or pure kernel |
| **IDENTITY** | Paths/names/schemas still say OpenCode |
| **V2** | Required when Session V2 is the product runtime |

| P | Band |
|---|------|
| P0 | Felt path — TA loop must not feel like a coding agent |
| P1 | Front-doors and defaults still advertising coding |
| P2 | Identity so moks doesn’t collide with installed OpenCode |
| P3 | Hard-fork polish only |

---

# P0 — Felt product path

## BL-001 · Plan exit still targets implementer `build`

| | |
|--|--|
| **Action** | PORT → **DONE** |
| **Priority** | P0 |
| **Decision** | ☑ GO (shipped) |
| **Rec** | **GO** — rewire exit to `recruit`; do not delete plan machinery |

### Shipped (implementation)

1. `PlanExitTool` (`packages/opencode/src/tool/plan.ts`):
   - Asks: switch to **recruit** and execute hiring plan (score / outreach / propose)
   - On Yes: synthetic user message with **`agent: "recruit"`** + hiring execute instructions
2. Tool description (`tool/plan-exit.txt`): recruit executes hiring plan
3. `SessionReminders`: leave-plan → **`recruit`** injects `doer-switch.txt`
4. TUI `plan_exit` handler sets local agent to `recruit`
5. `meta.txt`: plan mode → switch to **recruit** for execution

### Was (OpenCode coding)

Plan exit → `build` + “implement / edit files.”

### Acceptance (met)

Default product path post-exit agent is `recruit` with hiring execute language. `build` remains available via `--agent build` / config.

---

## BL-002 · `plan` agent is a software design mode

| | |
|--|--|
| **Action** | PORT → **DONE** |
| **Priority** | P0 |
| **Decision** | ☑ GO with BL-001 (shipped) |
| **Rec** | **GO** — same wave as BL-001 |

### Shipped (implementation)

1. **Agent** (`agent/agent.ts` `plan`):
   - Description: hiring strategy without recording decisions / mass-editing workspace
   - `edit`: deny `*`, allow `.moks/plans/*.md` + legacy `.opencode/plans/*.md` + global data plans
   - `task.general`: **deny**; explore still allowed
2. **`plan-mode.txt`**: explore req materials → hiring strategy → artifacts (scores/outreach/dispositions) → verification via fixtures/skills/`moks status` → `plan_exit`
3. **`plan.txt`**: read-only hiring strategy reminder
4. **`plan-enter.txt` / `plan-exit.txt`**: hiring strategy enter/exit copy
5. **Path** — BL-022

### Residual

- Dead/unused `plan-reminder-anthropic.txt` still has coding copy (not imported on V1 path) — optional cleanup
- Explore subagent prompt still codebase-flavored (BL-005) — can still bias parallel research from plan

### Acceptance (met)

Default plan mode reads as **req strategy**, not implementation design.

---

## BL-003 · Home tips / onboarding teach coding agent

| | |
|--|--|
| **Action** | PORT |
| **Priority** | P0 (W1) |
| **Decision** | ☐ GO (still open — not this ship) |
| **Rec** | **GO** |

### Current (implementation)

`packages/tui/src/feature-plugins/home/tips-view.tsx` — large `TIPS` array. Examples still coding/OpenCode-shaped:

- `/init` to generate project rules from **codebase**
- Commit **AGENTS.md**
- `/review` for uncommitted / branches / **PRs**
- `opencode.json`, `~/.config/opencode/tui.json`, `.opencode/commands|agents|tools|plugins`
- `formatter` / `lsp` enable tips
- `NO_MODELS_TIP` still says “start coding”

**Partial:** agent cycle tip says Recruit/Plan; plan tip mentions hiring strategy; some tips say `moks run`.

### Coding intent

Onboard users into the coding-agent power-user surface (config dirs, LSP, AGENTS.md, PR review).

### Correct port

Split tips into **generic harness** (sessions, models, keybinds, MCP) vs **product loop**:

| Remove / demote as hero | TA tips to prefer |
|-------------------------|-------------------|
| `/init` → AGENTS.md from codebase | `/init` → **new req** under `.moks/`; run **req-context** |
| `/review` PR | `/review` → **packet review** (skill-backed) |
| Build/Plan cycle only | **recruit** default; plan for strategy; build = escape hatch |
| LSP/formatter config | Decision verbs: `moks commit` / `status` / **`push`** |
| `.opencode/*` pedagogy | `.moks/` workspace + hiring skills |
| AGENTS.md commit | Optional notes; not the hero instruction file |

**Prefer:** agent-aware tips (`recruit` vs `build`) or a product tip pack selected by default agent.

### Wrong-port risks

- Global search-replace `opencode`→`moks` in tips while keeping AGENTS.md/LSP pedagogy → still trains coding workflow.
- Deleting all tips → worse empty state.

### Touches

`packages/tui/src/feature-plugins/home/tips-view.tsx`, status dialog empty-state copy if any

### Acceptance

Fresh `recruit` session tips never lead with AGENTS.md, git PR review, or LSP as the primary lesson.

---

## BL-004 · Coding chrome always on (diff / modified files / LSP)

| | |
|--|--|
| **Action** | HIDE LSP; **KEEP + lean into diff** → **DONE** |
| **Priority** | P0 (W1) |
| **Decision** | ☑ Soft-hide LSP when config off; **keep Diff** for local candidate/req changes |
| **Rec** | **GO** — shipped |

### Shipped (implementation)

1. TUI sidebar LSP plugin renders nothing when `config.lsp` is falsy (`feature-plugins/sidebar/lsp.tsx`)
2. Session footer hides `N LSP` when `config.lsp` falsy
3. Status dialog hides empty LSP / formatter chrome when disabled
4. Diff / Modified Files **unchanged** (still show local hiring file mutations)
5. Runtime already no-ops LSP/formatters when config omitted (BL-013)

### Was (historical)

| UI | Behavior | File |
|----|----------|------|
| Modified Files sidebar | Lists `session.diff` | `tui/.../sidebar/files.tsx` |
| LSP sidebar | Shows LSP clients; “activate as files are read” | `tui/.../sidebar/lsp.tsx` |
| Diff viewer | Full diff feature plugin | `tui/.../system/diff-viewer*` |

Always part of session chrome regardless of agent. Empty LSP still occupies “IDE” mental model.

### Coding intent

Session = IDE-adjacent workspace: see mutations and language servers.

### Correct port (ontology-aligned)

| Piece | Stance |
|-------|--------|
| **Diff / Modified Files** | **KEEP and lean in.** Same muscle as watching code change: show **local candidate & req artifact** mutations in real time (notes, scores, outreach drafts, proposal receipts under `.moks/`). Later: surface pending ATS deltas from propose. |
| **LSP sidebar** | **HIDE** on `recruit` (not useful for TA product). Full on `build`. |
| **`build` agent** | Full coding chrome |

**Note:** Modified Files already hides when `session.diff` is empty. Real pain today = empty LSP always visible — not Diff itself.

**Keep:** all components and session.diff plumbing. Do not delete.

### Wrong-port risks

- Deleting diff code → dogfooding/`build` regresses **and** loses the TA “see local candidate changes” loop.
- Hiding diffs when `recruit` wrote notes → user can’t see what changed.
- Treating Diff as “only remote ATS fields” → wrong; remote updates on **apply (push)**.

### Touches

sidebar plugins, session layout visibility, possibly agent name from session state

### Acceptance (met)

Default product install (no `lsp` config) shows **no LSP chrome**. Diff/Modified Files remain for local hiring deltas. Re-enable `"lsp": true` for coding dogfood.

---

## BL-005 · `explore` subagent assumes codebases

| | |
|--|--|
| **Action** | PORT (prompt + description) |
| **Priority** | P0 |
| **Decision** | ☐ GO |
| **Rec** | **GO** |

### Current (implementation)

| Layer | Content |
|-------|---------|
| Description (`agent/agent.ts`) | “exploring **codebases**”, examples `*.tsx`, “API endpoints”, “how do API endpoints work?” |
| Prompt (`agent/prompt/explore.txt`) | “file search specialist… navigating and exploring **codebases**” |
| Permissions | Read-only tool allowlist: grep/glob/list/bash/webfetch/websearch/read — **already domain-agnostic** |
| V2 twin | Same copy in `packages/core/src/plugin/agent.ts` |

### Coding intent

Fast parallel codebase reconnaissance for implementation planning.

### Correct port

| Keep | Change |
|------|--------|
| Tool permissions (read-only search) | Description + system prompt |
| Thoroughness levels (quick/medium/very thorough) | Domain: **hiring materials & local files** |

**New description intent:**  
“Explore hiring materials and local files — JD, scorecard, notes, fixtures, ATS dumps, public company/candidate pages. Use when finding evidence across req folders or attached resumes.”

**Prompt:** file-search specialist for **req/fixture trees and notes**, not “codebases / implementations.”

### Wrong-port risks

- Restricting tools further “for safety” → breaks web research for companies.
- Renaming agent to `research` without prompt change → same codebase behavior.
- Forcing explore to only `.moks/` → can’t read user-attached paths outside.

### Touches

`agent/agent.ts`, `agent/prompt/explore.txt`, task-tool description if it hardcodes coding explore; V2 plugin when relevant

### Acceptance

Spawning explore from `recruit` never instructs “search the codebase for implementations.”

---

## BL-006 · Hidden prompts: compaction / summary / title

| | |
|--|--|
| **Action** | PORT |
| **Priority** | P0 (W1) |
| **Decision** | ☐ GO |
| **Rec** | **GO** |

### Current (implementation)

| Agent | File | Coding bias |
|-------|------|-------------|
| compaction | `agent/prompt/compaction.txt` | “summarization assistant for **coding sessions**” |
| summary | `agent/prompt/summary.txt` | “Write like a **pull request description**”; “changes made” |
| title | `agent/prompt/title.txt` | Examples: debug 500s, refactor service, React hooks, dark mode |

Same strings duplicated in V2 `packages/core/src/plugin/agent.ts`.

### Coding intent

Session UX helpers tuned for SE work products (PR summaries, code task titles).

### Correct port

| Helper | OpenCode | TA / neutral |
|--------|----------|--------------|
| compaction | coding sessions | **session history** (domain-neutral is OK) |
| summary | PR description | **hiring session brief** (what was scored, drafted, proposed) — *not* “PR” |
| title examples | SE tasks | Mix: “Score Jordan Lee for SWE II”, “Outreach draft — Northline”, keep some generic |

**Keep:** hidden agents, no tools, short outputs, language-matching rules.

### Wrong-port risks

- Over-specific TA-only titles when user is on `build` dogfooding → prefer **neutral + mixed examples**.
- Changing structure/format of compaction sections the runner expects.

### Touches

`packages/opencode/src/agent/prompt/{compaction,summary,title}.txt` (+ V2 copies when shipping V2)

### Acceptance

Auto titles/summaries on `recruit` sessions don’t sound like PR bots.

---

# P1 — Front doors still advertising coding

## BL-007 · `/init` → AGENTS.md from repo

| | |
|--|--|
| **Action** | PORT → **DONE** |
| **Priority** | P1 |
| **Decision** | ☑ **PORT default `/init`** → new **req workspace** |
| **Rec** | **PORT** — shipped |

### Shipped (implementation)

1. `command/index.ts`: `/init` description *scaffold a new requisition workspace under .moks*
2. `command/template/initialize.txt`: scaffolds `.moks/req/{jd,scorecard,notes}.md`, gitignore `.moks/`, hiring skills + `moks commit|status|push`
3. Escape hatch: **`/init-code`** + `initialize-code.txt` keeps AGENTS.md coding setup

### Acceptance (met)

Default `/init` bootstraps a **req**, not AGENTS.md-as-hero.

---

## BL-008 · `/review` → git / PR code review

| | |
|--|--|
| **Action** | PORT → **DONE** |
| **Priority** | P1 |
| **Decision** | ☑ **PORT** default `/review` → **packet review** (skill-backed) |
| **Rec** | **PORT** — shipped |

### Shipped (implementation)

1. `command/index.ts`: description *review candidate/req packet before commit/push*
2. `command/template/review.txt`: packet review (JD/scorecard/resume/outreach/disposition); orchestrates `score-candidate` / `commit-disposition`; does **not** lead with `git`/`gh pr`
3. Escape hatch: explicit code review only when user asks and agent is `build`

### Acceptance (met)

Default `/review` is **packet review**, not PR review.

---

## BL-009 · Built-in skill `customize-opencode`

| | |
|--|--|
| **Action** | PORT |
| **Priority** | P1 |
| **Decision** | ☐ GO |
| **Rec** | **GO** (content now; paths dual-load can trail identity work) |

### Current (implementation)

- Name: `customize-opencode` (`skill/index.ts`)
- Body: `packages/core/src/plugin/skill/customize-opencode.md`
- Teaches: `opencode.json`, `.opencode/`, `~/.config/opencode`, schema `https://opencode.ai/config.json`, restart **opencode**
- Registered before disk skills; user can override by name

### Coding intent

Self-serve configuration skill for the OpenCode product.

### Correct port

| From | To |
|------|-----|
| Skill id `customize-opencode` | **`customize-moks`** (optional alias for old name) |
| Primary docs opencode.ai | moks workspace config, **`recruit` permissions**, Ashby edge, hiring skills layout |
| Paths only `.opencode` / `opencode.json` | Document **`.moks/` + `moks.json`**, note dual-load with OpenCode names |

**Keep:** skill-loader mechanism, built-in registration pattern.

### Wrong-port risks

- Rename only → content still sends users to opencode.ai as source of truth for *moks*.
- Teaching only new paths before dual-load ships → broken advice.

### Touches

`skill/index.ts`, `core/src/plugin/skill/customize-opencode.md` (or new md)

### Acceptance

Skill picker shows moks-oriented customize skill; content doesn’t make opencode.ai the primary moks config authority.

---

## BL-010 · CLI `github` / `pr`

| | |
|--|--|
| **Action** | DROP from TA help/GTM |
| **Priority** | P1 |
| **Decision** | ☐ HIDE from help &nbsp; ☐ delete commands |
| **Rec** | **HIDE** — keep code |

### Current (implementation)

- Registered in `packages/opencode/src/index.ts`: `GithubCommand`, `PrCommand`
- GitHub Actions coding-agent install + PR checkout workflows
- Deep links to opencode.ai docs / api.opencode.ai

### Coding intent

Ship OpenCode as a GitHub-native coding agent.

### Correct port

| From | To |
|------|-----|
| Featured in `moks --help` / GTM | **Unlisted** for TA install |
| Code | **Keep** for contributor dogfood |
| Docs | “Contributor” only, not eng-TA |

**Ontology note:** GitHub is the *SWE* remote. Our remote is the **ATS**. Do not PORT these commands into “GitHub recruiting.”

### Wrong-port risks

- Deleting handlers while monorepo still uses them → pain.
- PORT to “GitHub recruiting” — out of scope / wrong product.

### Touches

`index.ts` registration / help grouping, README

### Acceptance

TA-facing help does not feature GitHub coding agent.

---

## BL-011 · CLI `generate` / `console` (account)

| | |
|--|--|
| **Action** | DROP from TA help |
| **Priority** | P1 |
| **Decision** | ☐ HIDE |
| **Rec** | **HIDE** |

### Current (implementation)

- `GenerateCommand` — OpenAPI sample generator
- `ConsoleCommand` / account — `defaultConsoleUrl = https://console.opencode.ai`
- Both registered on root CLI

### Coding intent

SDK/console ecosystem for OpenCode cloud/org.

### Correct port

Hide or mark dev-only. No console.opencode.ai as **moks identity**.  
TA help list: run / TUI / verbs / MCP / providers / session.

### Touches

`cli/cmd/generate.ts`, `cli/cmd/account.ts`, help presentation

### Acceptance

TA-facing help is not SDK generate or upstream console.

---

## BL-012 · Provider / commercial upsells → OpenCode

| | |
|--|--|
| **Action** | PORT (copy + CTAs) |
| **Priority** | P1 |
| **Decision** | ☐ GO |
| **Rec** | **GO** |

### Current (implementation)

| Location | Behavior |
|----------|----------|
| `tui/.../dialog-retry-action.tsx` | `GO_URL = https://opencode.ai/go` |
| `tui/.../session/index.tsx` | Go upsell free-tier / rate-limit KV keys |
| `cli/cmd/providers.ts` | Links to opencode.ai/auth, docs |
| `cli/cmd/account.ts` | console.opencode.ai |
| Config writes | `$schema: https://opencode.ai/config.json` |

### Coding intent

Monetize / onboard onto OpenCode’s hosted models and console.

### Correct port

| From | To |
|------|-----|
| Primary CTA OpenCode Go | **“Connect a provider”** (neutral) |
| Free models via OpenCode as moks default identity | Optional backend, **labeled third-party** |
| Failed auth → opencode.ai/go | Failed auth → provider setup for moks |

**Keep:** multi-provider machinery; optional Zen/OpenCode backend as *one* choice.

### Wrong-port risks

- Shipping moks that funnels eng-TAs into OpenCode commercial as if moks *is* that product (affiliation + support liability).

### Touches

TUI upsell components, provider dialogs, CLI provider copy

### Acceptance

Failed-auth / empty-provider UX does not push users into OpenCode Go *as moks*.

---

## BL-013 · Default product: LSP + formatters on

| | |
|--|--|
| **Action** | HIDE via defaults → **DONE** |
| **Priority** | P1 (W1 with chrome) |
| **Decision** | ☑ **GO** — LSP/formatters **not a TA product surface**; defaults off |
| **Rec** | **GO** — shipped |

### Shipped (implementation)

- Runtime: `!cfg.lsp` / `!cfg.formatter` → no servers / formatters (omit = off)
- TUI chrome gated on truthy config (BL-004)
- Subsystems kept for `build` dogfood (`"lsp": true` re-enables)

### Acceptance (met)

Fresh eng-TA install does not spawn language servers; no empty LSP chrome.

---

## BL-014 · Tools: `lsp`, `apply_patch` prominence

| | |
|--|--|
| **Action** | HIDE for `recruit` |
| **Priority** | P1 |
| **Decision** | ☐ GO |
| **Rec** | **GO** |

### Current (implementation)

`tool/registry.ts`:

- Full tool list includes edit/write/bash/… 
- `apply_patch` (`patch`) participates in code-mode filtering with edit/write
- `lsp` tool gated by `experimentalLspTool` flag but is a coding analysis tool
- **No agent-specific stripping** for `recruit` beyond permissions

### Coding intent

Multi-file patch apply + IDE intelligence tools for SE agents.

### Correct port

| Agent | Tools |
|-------|-------|
| **`recruit`** | Prefer read / skill / bash(for verbs) / light edit-write for notes; **no LSP tool**; apply_patch not primary |
| **`build`** | Full coding tool set |

Implement via **agent permission / tool filter**, not deleting tools from registry.

### Wrong-port risks

- Global disable of apply_patch → `build` suffers.
- Denying all edit on `recruit` without path exceptions → can’t draft notes (see BL-015).

### Touches

`tool/registry.ts` filtering, `agent/agent.ts` recruit permissions

### Acceptance

`recruit` tool list does not include LSP; apply_patch is not the primary edit path.

---

## BL-015 · `recruit` permission profile still coding-wide

| | |
|--|--|
| **Action** | PORT → **DONE** (edit path-scoped; bash residual) |
| **Priority** | P1 |
| **Decision** | ☑ **Path-scoped allow under `.moks/**` + fixtures** |
| **Rec** | **Path-scoped** — edit shipped |

### Shipped (implementation)

`recruit` permissions (`agent/agent.ts`):

```
defaults (*: allow, …)
+ question / plan_enter / ashby reads allow, ashby writes deny
+ edit: * → ask
+ edit: .moks/* , fixtures, .gitignore → allow
+ user config merge
```

`edit` also gates **write** and **apply_patch**. Prompt (`recruit.txt`) matches enforcement.

### Residual

- **Bash** still broadly allow (needed for `moks commit|status|push` via shell). Destructive bash patterns not yet ask/deny.
- BL-014 tool prominence (hide LSP tool / demote apply_patch) still open.

### Acceptance (edit path — met)

Note drafts under `.moks/` stay easy; edits outside ask first. Remote ATS still only via **push** authority (receipts today).

---

## BL-016 · `general` subagent has no TA bias

| | |
|--|--|
| **Action** | PORT (light) |
| **Priority** | P1 |
| **Decision** | ☐ Domain-neutral prompt &nbsp; ☐ Inherit parent persona |
| **Rec** | **Domain-neutral prompt + optional parent-recruit hint** |

### Current (implementation)

- `general` in `agent/agent.ts`: description for multi-step tasks; **no `prompt` field**
- Therefore `session/llm/request.ts` uses **`SystemPrompt.provider(model)`**
- Provider prompts (`session/prompt/default.txt`, `anthropic.txt`, `codex.txt`, …) are explicitly **coding agents** (“helps users with software engineering tasks”, “best coding agent on the planet”)
- Plan mode currently **denies** `task`→`general` (hiring plan path uses explore)

### Coding intent

Parallel multi-step worker without a specialized niche.

### Correct port

| Approach | Effect |
|----------|--------|
| **A. Short domain-neutral system prompt on `general`** | Never auto-becomes “software engineer” |
| **B. When parent session agent is `recruit`, inject hiring-safe addendum** | Subtasks stay in hiring vocabulary |
| Avoid | Full duplicate of `recruit.txt` on every general spawn (heavy, may fight tools) |

### Wrong-port risks

- Leaving provider SE prompts → `task` from `recruit` **revives coding persona** mid-hiring loop.
- Copying entire `recruit.txt` into general → confused permissions/skill assumptions.

### Touches

`agent/agent.ts`, possibly task tool / system assembly in `session/llm/request.ts`

### Acceptance

`task` from `recruit` does not revive full coding persona mid-hiring loop.

---

## BL-017 · UI theme names `v2-agent-build/plan/explore`

| | |
|--|--|
| **Action** | PORT (cosmetic) |
| **Priority** | P3 |
| **Decision** | ☐ DEFER |
| **Rec** | **DEFER** |

### Current

Theme assets/IDs centered on coding agent cast (`packages/ui` / tui themes).

### Correct port

Neutral or TA-flavored **display names**; keep IDs for compat.

### Acceptance

Theme picker doesn’t read only as “pick your coding agent skin.”

---

# P2 — Identity & paths (OpenCode → moks)

## BL-018 · Config filename `opencode.json` only

| | |
|--|--|
| **Action** | IDENTITY |
| **Priority** | P2 |
| **Decision** | ☐ Dual-load |
| **Rec** | **Dual-load; prefer moks** |

### Current (implementation)

- Loads `opencode.json` / `opencode.jsonc` (project + global) — `config/config.ts`
- Writes `$schema: https://opencode.ai/config.json` on create/update
- Candidates include `config.json` under global dir; **no `moks.json`**
- Error copy still references opencode.json (TUI)

### Correct port

| From | To |
|------|-----|
| Only `opencode.json(c)` | Dual-load **`moks.json(c)` + `opencode.json(c)`** |
| Prefer | **moks when both present** |
| Schema URL | moks-hosted or local package schema; tips say moks |
| Compat | Old file still works |

### Wrong-port risks

- Hard cutover without dual-load → breaks existing configs and monorepo.
- Writing only new schema without dual-load readers → silent ignore.

### Touches

`config/config.ts`, TUI errors, provider dialogs

### Acceptance

Documented TA setup uses `moks.json` or `.moks/`; `opencode.json` still works.

---

## BL-019 · Project dir `.opencode/` only

| | |
|--|--|
| **Action** | IDENTITY |
| **Priority** | P2 |
| **Decision** | ☐ Dual-discover |
| **Rec** | **Dual-discover `.moks/` + `.opencode/`** |

### Current (implementation)

- `config/paths.ts`: `targets: [".opencode"]` only
- Skills under `.opencode/skill(s)`, agents, commands, tools, plugins discovered from those dirs
- Global: `~/.config/opencode/...`

### Correct port

| From | To |
|------|-----|
| Discover `.opencode/` | Discover **`.moks/` and `.opencode/`** |
| Docs | Teach **`.moks/`** for product workspaces |
| Monorepo | **Keep `.opencode/`** for *installed* agent building moks (unchanged) |

### Wrong-port risks

- Replacing `.opencode` globally → breaks this repo’s dev agent config (`.opencode/` in monorepo).
- Not documenting the dual → users put skills in `.moks/` and nothing loads.

### Touches

`config/paths.ts`, skill/agent loaders, FORK/AGENTS clarity

### Acceptance

User can put hiring skills under `.moks/skill` and they load.

---

## BL-020 · Global app dir name `opencode`

| | |
|--|--|
| **Action** | IDENTITY |
| **Priority** | P2 (timing open) |
| **Decision** | ☐ Now &nbsp; ☐ After WAU &nbsp; ☐ Design now / ship mid |
| **Rec** | **Design with 018/019; ship before external install base scales** |

### Current (implementation)

`packages/core/src/global.ts`:

```ts
const app = "opencode"
// → ~/.config/opencode, ~/.local/share/opencode, cache, state, tmp
```

**Collides with installed OpenCode** on the same machine (you use both).

### Correct port

| From | To |
|------|-----|
| App name `opencode` | App name **`moks`** |
| Existing data | One-time **migrate or read-fallback**; never blindly clobber OpenCode install data |
| DB / logs / auth | Live under moks paths after switch |

### Wrong-port risks

- Pointing moks at same dir forever → config/auth/session corruption across products.
- Auto-move without backup → data loss.
- Doing this before dual-load story is clear → half-migrated mess.

### Touches

`packages/core/src/global.ts`, path helpers, install docs

### Acceptance

Running moks and OpenCode on the same machine uses different config/data dirs.

---

## BL-021 · Env vars `OPENCODE_*`

| | |
|--|--|
| **Action** | IDENTITY |
| **Priority** | P2 |
| **Decision** | ☐ Dual-accept |
| **Rec** | **GO** (`MOKS_*` primary, `OPENCODE_*` fallback) |

### Current

Feature flags and paths via `OPENCODE_*` (e.g. `OPENCODE_CONFIG`, `OPENCODE_PURE`, log flags in `index.ts` middleware).

### Correct port

Accept **`MOKS_*` primary**; fall back `OPENCODE_*` for fork compat. Docs show `MOKS_`.

### Touches

Env reads across packages

### Acceptance

Docs show `MOKS_`; old env still works.

---

## BL-022 · Plans path `.opencode/plans`

| | |
|--|--|
| **Action** | IDENTITY + PORT → **DONE** |
| **Priority** | P0/P2 (with plan wave) |
| **Decision** | ☑ Shipped with BL-001/002 |
| **Rec** | **Ship with plan PORT** |

### Shipped (implementation)

`session/session.ts` `plan()`:

- Prefer `.moks/plans/{created}-{slug}.md` on VCS worktrees
- Dual-read: if only legacy `.opencode/plans/...` exists, keep using it
- Non-VCS: still `Global.Path.data/plans`
- Plan agent edit allowlist: **both** `.moks/plans/*.md` and `.opencode/plans/*.md`

### Residual

Global data plans still under OpenCode app dir until BL-020 (`app = moks`).

### Acceptance (met)

New hiring plans land under `.moks/plans`.

---

## BL-023 · Instruction discovery = AGENTS.md / CLAUDE.md only

| | |
|--|--|
| **Action** | PORT |
| **Priority** | P2 |
| **Decision** | ☐ GO |
| **Rec** | **GO** for `recruit` |

### Current (implementation)

`session/instruction.ts`:

- Project files: `AGENTS.md`, optional `CLAUDE.md`
- Global: `~/.config/opencode/AGENTS.md`, `~/.claude/CLAUDE.md`
- Plus `config.instructions` globs/URLs

No first-class load of `.moks/req/*`.

**Note:** `recruit.txt` *tells* the model to read `.moks/req/` via tools — but instruction attachment does not auto-inject those files into system context.

### Coding intent

Repo-level agent constitution for SE work.

### Correct port

| Agent | Instructions |
|-------|----------------|
| **`recruit`** | Also treat **`.moks/req/`** (jd, scorecard, notes) as first-class context sources (attach or system paths) |
| **`build`** | Keep AGENTS.md / CLAUDE.md behavior |
| Both | `config.instructions` remains escape hatch |

### Wrong-port risks

- Replacing AGENTS.md entirely → monorepo dogfood and coding escape hatch break.
- Auto-injecting huge resume PDFs into every turn → context blowups; prefer “discover + attach when relevant” with clear rules.

### Touches

`session/instruction.ts`, system context assembly

### Acceptance

Opening a req folder gives hiring context without a coding AGENTS.md.

---

## BL-024 · Models / provider host defaults

| | |
|--|--|
| **Action** | IDENTITY (copy now; catalog later) |
| **Priority** | P2 |
| **Decision** | ☐ Copy now &nbsp; ☐ Own catalog post-WAU |
| **Rec** | **Neutral copy/headers now; own catalog later** |

### Current

Defaults and plugins still oriented to `models.opencode.ai`, OpenCode provider plugin, referers `opencode.ai`.

### Correct port

Product does not imply moks *is* OpenCode’s model service. Zen/OpenCode remains optional labeled backend.

### Acceptance

No implied identity between moks and OpenCode model hosting.

---

# P3 — Defer / hard-fork only

## BL-025 · Mass rename packages / `OPENCODE_*` internals

| | |
|--|--|
| **Action** | DROP (defer) |
| **Rec** | **Do not start** until identity dual-load done and upstream merge strategy chosen |
| **From** | `packages/opencode`, `@opencode-ai/*`, dual bin |
| **To** | Deliberate hard-fork rename per ROADMAP |

---

## BL-026 · Prune desktop / console / web / SST

| | |
|--|--|
| **Action** | DROP (defer) |
| **Rec** | **Leave unmaintained** (ROADMAP locked) |
| **From** | Full monorepo upstream packages |
| **To** | No investment |

---

## BL-027 · Delete `build` agent entirely

| | |
|--|--|
| **Action** | HIDE (not delete) → **DONE (hidden)** |
| **Decision** | ☑ Keep forever as escape hatch; **hidden by default** |
| **Rec** | **YES — keep forever** |
| **From** | Native `build` always registered and visible |
| **To** | `hidden: true`; unhide via `default_agent: build` or config; monorepo `.opencode` unhides for dogfood |
| **Note** | Not deleted; product cast is recruit + plan |

---

## BL-028 · Delete LSP / formatter codebases

| | |
|--|--|
| **Action** | HIDE (not delete) |
| **Rec** | Defaults off via BL-013; delete only at hard fork if weight matters |
| **Note** | LSP is not a TA product surface — never “port” it into a hiring metaphor |

---

## BL-029 · V2 agent plugin still coding-default

| | |
|--|--|
| **Action** | V2 |
| **Rec** | Track; implement when V2 is product runtime |

### Current (implementation)

- `packages/core/src/agent.ts`: `defaultID = "build"`
- `packages/core/src/plugin/agent.ts`: seeds build/plan/general/explore with **BUILD_SYSTEM** coding string; **no `recruit`**
- Compaction/title/summary coding copy duplicated

### Correct port

When V2 is the runtime: default **`recruit`**, seed hiring agent + skills parity, plan→recruit wiring (same semantics as V1 ports above).

### Acceptance

When V2 is the runtime, product default is still hiring-native.

---

## BL-030 · Web docs `agents.mdx` still OpenCode Build/Plan/Scout

| | |
|--|--|
| **Action** | DROP (defer) |
| **Rec** | Ignore until web is in scope; README + `product/headless.md` are SoT |

---

## Explicit non-goals (leave alone)

| Item | Why |
|------|-----|
| Session runner, permission engine, MCP host, skill loader, multi-provider | Kernel — KEEP |
| Decision verbs + receipts (`commit` / **`push`**) | Already TA authority layer |
| Diff / session.diff plumbing | KEEP — local candidate/req change visibility |
| Monorepo `.opencode/` (`default_agent: build`, …) | Configures *installed* agent building moks |
| `packages/opencode` folder name | Inherited; rename is hard-fork (BL-025) |
| Desktop / console / web / SST investment | ROADMAP defer |

---

## Semantic port cheat-sheet (quick reference)

Use this when reviewing any change:

| OpenCode coding concept | Correct moks TA concept | Incorrect “port” |
|-------------------------|-------------------------|------------------|
| **Repo / project** | **Requisition (req)** | “Project” with moks logo still meaning a git repo of product code |
| **GitHub (remote)** | **ATS (Ashby)** | GitHub Actions / “GitHub recruiting” as product |
| **Local working tree** | **`.moks/` req workspace** | Only cloud ATS with no local drafts |
| **Diff / modified files** | **Local candidate & req artifact changes** (real-time) | Delete diff; or only show remote ATS |
| **`git push` / merge** | **`moks push`** | Raw ATS writes from the agent |
| **`git commit` / stage intent** | Local artifacts + **`moks commit`** (receipt) | Commit without push path |
| **PR / code review** | **`/review` → packet review skill** | `/review` that still runs `gh pr` |
| Agent `build` (executor) | Agent **`recruit`** (hiring executor); build hidden | Rename binary only; keep build as default |
| Plan → implement code | Plan → **execute hiring next steps** | Plan → generate recruiting software |
| Explore codebase | Explore **req materials / fixtures / notes** | Explore → web-only OSINT agent |
| `/init` → AGENTS.md | `/init` → **new req workspace** | `/init` → still AGENTS.md with moks logo |
| PR-style summary | **Hiring session brief** | “PR” wording with candidate names |
| `opencode.json` / `.opencode/` | **`moks.json` / `.moks/`** (+ dual-load) | String-replace without dual-load |
| LSP / formatters | **Not TA product** — defaults off; hide chrome | Invent TA-LSP metaphor; or delete subsystem |
| Wide edit permissions | **Path-scoped** `.moks/**` | Ask-every-keystroke *or* leave `*: allow` |
| OpenCode Go upsell | **Connect a provider** | White-label OpenCode commercial as moks |
| `general` w/ SE provider prompt | **Neutral / TA-safe** subagent | Spawn coding agent from recruit tasks |

---

## Decision groups (product chunks)

| Group | Scope | Status |
|-------|--------|--------|
| **Cast** | Doer = `recruit`; plan stays; build hidden | **Done** |
| **G3 Plan→execute** | BL-001, BL-002, BL-022 | **Done** |
| **Ontology** | Req=repo; ATS=remote; commit/push; diff=local hiring deltas; init=new req; review=packet | **Done** (docs + ship) |
| **Verbs** | `propose`/`apply` → **`commit`/`push`** | **Done** |
| **G2 Chrome & defaults** | BL-004, BL-013 | **Done** (BL-014 open) |
| **G5 Front doors** | BL-007, BL-008 | **Done** (BL-009–012 open) |
| **G6 Guardrails** | BL-015 path-scoped edit | **Done** (bash residual; BL-014 open) |
| **G4 Subagents** | BL-005 explore, BL-016 general | Open |
| **G1 Session helpers** | BL-003 tips, BL-006 title/summary/compaction | Open |
| **G7 Identity** | BL-018–021, BL-023–024 | Open |
| **G8 Later** | BL-017, BL-025–030 | Defer |

---

## Suggested implementation order

| Wave | Issues | Outcome | Status |
|------|--------|---------|--------|
| **Cast + G3** | recruit doer, BL-001/002/022, BL-027 hide | Plan→recruit hiring-native | **Done** |
| **Ontology lock** | Thesis + cheat-sheet + 004/007/008/013/015 decisions | Shared SWE↔TA map | **Done (docs)** |
| **Ontology ship** | BL-004/007/008/013/015 + verb rename commit/push | Front doors, chrome, guardrails | **Done** |
| **G4 — Subagents** | BL-005, BL-016 | explore/general don’t pull back to coding | **Next** |
| **G1 — Feel copy** | BL-003, BL-006 | Fresh session doesn’t teach IDE/PR | Open |
| **G5 remainder** | BL-009–012 | customize skill; hide GH/console; neutral CTAs | Open |
| **G6 residual** | BL-014 + bash patterns | tool filters; tighter shell | Open |
| **G7 — Identity** | BL-018–021, BL-023; BL-024 copy | moks paths don’t fight installed OpenCode | Open |
| **G8 — Later** | BL-017, BL-025–030 | Cosmetic, V2, hard-fork | Defer |

---

## Traceability (hot files)

```
packages/opencode/src/agent/agent.ts
packages/opencode/src/agent/prompt/*
packages/opencode/src/product/agents/recruit.txt
packages/opencode/src/product/skills/**
packages/opencode/src/product/ashby-edge.ts
packages/opencode/src/command/index.ts
packages/opencode/src/command/template/{initialize,review}.txt
packages/opencode/src/tool/{plan,registry,lsp,apply_patch}.ts
packages/opencode/src/session/{session,reminders,instruction,system}.ts
packages/opencode/src/session/prompt/{plan-mode,plan,doer-switch,meta,*}.txt
packages/opencode/src/session/llm/request.ts
packages/opencode/src/skill/index.ts
packages/opencode/src/config/{config,paths}.ts
packages/opencode/src/cli/cmd/{github,pr,generate,account}.ts
packages/opencode/src/index.ts
packages/core/src/global.ts
packages/core/src/agent.ts
packages/core/src/plugin/agent.ts
packages/core/src/plugin/skill/customize-opencode.md
packages/tui/src/feature-plugins/home/tips-view.tsx
packages/tui/src/feature-plugins/system/diff-viewer*
packages/tui/src/feature-plugins/sidebar/{files,lsp}.tsx
packages/tui/src/component/dialog-retry-action.tsx
```

---

## Review checklist (product calls)

Mark when decided:

### Done
- [x] **Thesis / ontology** — moks:TA :: OpenCode:SWE; req=repo; ATS=remote; commit/push; diff=local hiring deltas
- [x] **Cast** — `recruit` doer; Plan stays; `build` hidden forever (BL-027)
- [x] **G3 / BL-001** — plan_exit → `recruit` + hiring execute synthetic
- [x] **G3 / BL-002** — plan-mode / plan reminders = hiring strategy
- [x] **G3 / BL-022** — `.moks/plans` prefer + dual-read/allow legacy
- [x] **Verbs** — `propose`/`apply` → **`commit`/`push`** (CLI, receipts, skills, TUI)
- [x] **BL-004 shipped** — Keep Diff; hide LSP chrome when config off
- [x] **BL-007 shipped** — Default `/init` → new req workspace; `/init-code` escape hatch
- [x] **BL-008 shipped** — `/review` → packet review skill (not git/PR)
- [x] **BL-013 shipped** — LSP/formatters defaults off; chrome gated
- [x] **BL-015 shipped** — Path-scoped edit under `.moks/**` + fixtures (+ `.gitignore`)

### Open
- [ ] **G4** — explore (BL-005) + general (BL-016) prompts
- [ ] **G1** — tips (BL-003) + hidden prompts (BL-006)
- [ ] **G5 remainder** — BL-009–012 (customize skill, hide GH/console, neutral CTAs)
- [ ] **G6 residual** — BL-014 tool filters; bash path patterns for recruit
- [ ] **BL-020** — Global dir migrate timing: now / after WAU / design-now-ship-mid (rec mid)
- [ ] **BL-002 residual** — optional delete/port unused `plan-reminder-anthropic.txt`

---

## Change log

| Date | Note |
|------|------|
| 2026-08-11 | **Ontology ship:** BL-004/007/008/013/015 implemented; verbs `commit`/`push` (was propose/apply); skill `commit-disposition`; `/init-code` escape hatch; LSP chrome hidden when off |
| 2026-08-11 | **Ontology lock:** thesis moks:TA::OpenCode:SWE; apply=push metaphor; `/init`=new req; `/review`=packet skill; keep Diff; LSP not TA; BL-007/008/004/013/015 decided; HTML companion |
| 2026-08-11 | Docs sync: mark cast+G3 done; refresh Current/shipped; decision groups; HTML companion |
| 2026-08-11 | G3: plan-mode/plan.txt hiring strategy; plan_exit hiring verbs; `.moks/plans` dual-path |
| 2026-08-11 | Locked cast: doer = `recruit` (was `ta`/`build`); `build` hidden; plan_exit → recruit |
| 2026-08-10 | Rewrote as implementation-grounded review: current OpenCode behavior, correct TA ports, wrong-port risks, semantic cheat-sheet |
