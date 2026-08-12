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
| Delete LSP/diff subsystems | **No** — hide/demote on `recruit`; keep code for rare `build` escape hatch (not our moks-dev loop) |

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
| **general** | Yes — `agent/prompt/general.txt` | Domain-neutral multi-step worker (done BL-016) |
| **explore** | Yes — `agent/prompt/explore.txt` | Req materials / fixtures / notes (done BL-005) |
| **compaction / title / summary** | Yes | Session-history / hiring brief / mixed titles (done BL-006) |

**Port implication:** doer + plan + subagents + tips + dual-load project identity are hiring-native. Residual: global app dir (BL-020 parked), req instruction attach (BL-023), provider catalog copy (BL-024).

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

**How we develop moks (locked):** we do **not** use the moks product binary to code this repo. Day-to-day engineering is **global installed OpenCode** (and monorepo `.opencode/` with `default_agent: build` is for *that* agent). moks product path is eng-TA only. Do not design tips, identity, or LSP/build chrome around “dogfooding moks by coding inside moks.”

**Locked product decisions (2026-08-11):**

- **Cast:** OpenCode Build doer → **`recruit`**; Plan stays; **`build` hidden** optional escape hatch for end users who need coding tools (not our internal moks-dev workflow).
- **G3 plan wave:** BL-001, BL-002, BL-022 **done** — exit/copy/path are hiring-native.
- **Domain ontology:** req = repo; ATS = GitHub/remote; `.moks/` = local working tree; diff = local candidate/req changes; **`moks commit` / `moks push`** (git metaphor); `/init` = new req; `/review` = packet review skill (not git/PR).
- **AGENTS.md:** keep as workspace instruction injection (hiring norms, same as coding constitution). Not the hero bootstrap; not removed.
- **LSP:** not a TA product surface (defaults off; chrome hidden when off; code kept only for optional `build` escape hatch).
- **Diff:** keep and lean into — real-time visibility of local hiring deltas (like code changes).
- **BL-020 global app dir:** **parked** — leave alone until we design migrate/coexistence with installed OpenCode more carefully.
- **Shipped 2026-08-11 (dictionary wave):** BL-004, BL-007, BL-008, BL-013, BL-015 + verb rename propose→**commit**, apply→**push**.
- **Shipped 2026-08-11 (helpers + front doors):** BL-005, BL-006, BL-009, BL-010, BL-011, BL-012, BL-014, BL-016.
- **Shipped 2026-08-11 (tips + dual-load):** BL-003, BL-018, BL-019, BL-021. **Parked:** BL-020. **Still open:** BL-023/024, bash residual.

---

## Legend

| Tag | Meaning |
|-----|---------|
| **PORT** | Rewrite coding *semantics* into TA equivalent; keep machinery |
| **DONE** | Shipped on product path; “Current” below is historical unless noted |
| **HIDE** | Soft-remove from default `recruit` UX; keep code for optional `build` escape hatch |
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
- Explore prompt ported (BL-005 done) — plan parallel research stays hiring-oriented

### Acceptance (met)

Default plan mode reads as **req strategy**, not implementation design.

---

## BL-003 · Home tips / onboarding teach coding agent

| | |
|--|--|
| **Action** | PORT → **DONE** |
| **Priority** | P2 |
| **Decision** | ☑ GO (shipped) |
| **Rec** | **GO** — shipped |

### Shipped (implementation)

`packages/tui/src/feature-plugins/home/tips-view.tsx`:

- **Heroes:** `/init` → new req under `.moks/`; `/review` packet review; req-context / score-candidate; `moks commit|status|push`; Plan → recruit; Diff of local req work; attach JD/resume
- **`NO_MODELS_TIP`:** start hiring + `/init` (not “start coding”)
- **AGENTS.md:** kept as **optional** tip for team hiring conventions (not codebase commit hero)
- **Demoted:** LSP/formatter tips, PR review wording, codebase init
- **Config paths:** prefer `moks.json` / `.moks/` with dual-load honesty (`or opencode.json`)

### Acceptance (met)

Fresh `recruit` session tips never lead with AGENTS.md, git PR review, or LSP as the primary lesson. AGENTS.md remains valid workspace inject for hiring norms.

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
| **Action** | PORT (prompt + description) → **DONE** |
| **Priority** | P0 |
| **Decision** | ☑ GO (shipped) |
| **Rec** | **GO** — shipped |

### Shipped (implementation)

1. Description (`agent/agent.ts`): hiring materials / local files; examples `**/jd.md`, scorecard, must-have, comp range, req trees / fixtures / ATS dumps / public pages; thoroughness levels kept
2. Prompt (`agent/prompt/explore.txt`): file-search specialist for **req/fixture trees and notes** — not codebases
3. V2 twin (`packages/core/src/plugin/agent.ts`): same description + PROMPT_EXPLORE
4. Permissions unchanged (read-only search allowlist)

### Acceptance (met)

Spawning explore from `recruit` never instructs “search the codebase for implementations.”

---

## BL-006 · Hidden prompts: compaction / summary / title

| | |
|--|--|
| **Action** | PORT → **DONE** |
| **Priority** | P0 |
| **Decision** | ☑ GO (shipped) |
| **Rec** | **GO** — shipped |

### Shipped (implementation)

| Agent | Change |
|-------|--------|
| compaction | “coding sessions” → domain-neutral **session history** |
| summary | Not PR copy → **hiring / neutral session brief** (scored, drafted, committed) |
| title | Mixed hiring + generic examples (e.g. Score Jordan Lee for SWE II, Outreach draft — Northline) |

V1 `.txt` files and V2 `PROMPT_*` in `packages/core/src/plugin/agent.ts` stay in sync.

### Acceptance (met)

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
| **Action** | PORT → **DONE** |
| **Priority** | P1 |
| **Decision** | ☑ GO (shipped) |
| **Rec** | **GO** — shipped |

### Shipped (implementation)

1. Skill id **`customize-moks`** in V1 (`skill/index.ts`) and V2 (`core/src/plugin/skill.ts`)
2. Body: `packages/core/src/plugin/skill/customize-moks.md` (removed `customize-opencode.md`)
3. Content: recruit default, `.moks/` workspace, hiring skills, commit/status/push, Ashby edge; honest dual-load notes for `opencode.json` / `.opencode/` today
4. No opencode.ai as primary moks config authority
5. Test: `packages/core/test/plugin/skill.test.ts`

### Acceptance (met)

Skill picker shows moks-oriented customize skill; content doesn’t make opencode.ai the primary moks config authority.

---

## BL-010 · CLI `github` / `pr`

| | |
|--|--|
| **Action** | HIDE from TA help → **DONE** |
| **Priority** | P1 |
| **Decision** | ☑ HIDE from help (keep code) |
| **Rec** | **HIDE** — shipped |

### Shipped (implementation)

- `GithubCommand` / `PrCommand`: `describe: false` (yargs hides from root help)
- Still registered in `index.ts`; callable for contributor dogfood
- Ontology: GitHub stays SWE remote — not ported to “GitHub recruiting”

### Acceptance (met)

TA-facing help does not feature GitHub coding agent.

---

## BL-011 · CLI `generate` / `console` (account)

| | |
|--|--|
| **Action** | HIDE from TA help → **DONE** |
| **Priority** | P1 |
| **Decision** | ☑ HIDE |
| **Rec** | **HIDE** — shipped |

### Shipped (implementation)

- `GenerateCommand`: `describe: false`
- `ConsoleCommand`: already `describe: false` (unchanged)
- Both still registered and runnable

### Acceptance (met)

TA-facing help is not SDK generate or upstream console.

---

## BL-012 · Provider / commercial upsells → OpenCode

| | |
|--|--|
| **Action** | PORT (copy + CTAs) → **DONE** |
| **Priority** | P1 |
| **Decision** | ☑ GO (shipped) |
| **Rec** | **GO** — shipped |

### Shipped (implementation)

| Location | Change |
|----------|--------|
| `dialog-retry-action.tsx` | Removed `GO_URL` / OpenCode Go special treatment; neutral dialog |
| `session/index.tsx` | Provider-limit naming; KV string keys kept for prefs |
| `session/retry.ts` | `PROVIDER_LIMIT_MESSAGE`; free/rate-limit actions dismiss + connect another provider (no Go link) |
| `cli/cmd/providers.ts` | OpenCode auth framed as **optional third-party** hosted provider |

**Keep residual:** multi-provider machinery; `console.opencode.ai` URL for hidden console command; schema URL identity deferred to BL-018/024.

### Acceptance (met)

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
| **Action** | HIDE for `recruit` → **DONE** |
| **Priority** | P1 |
| **Decision** | ☑ GO (shipped) |
| **Rec** | **GO** — shipped |

### Shipped (implementation)

1. `recruit` permissions: `lsp: "deny"`
2. `tool/registry.ts`: when `agent.name === "recruit"`, force edit/write (never prefer apply_patch); exclude LspTool even if experimental flag on
3. **`build`** unchanged (gpt-* can still prefer apply_patch)

### Residual

Bash still broadly allow on recruit (decision verbs via shell) — not this card.

### Acceptance (met)

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
- BL-014 tool prominence **done** (lsp deny + no apply_patch prefer for recruit).

### Acceptance (edit path — met)

Note drafts under `.moks/` stay easy; edits outside ask first. Remote ATS still only via **push** authority (receipts today).

---

## BL-016 · `general` subagent has no TA bias

| | |
|--|--|
| **Action** | PORT (light) → **DONE** |
| **Priority** | P1 |
| **Decision** | ☑ Domain-neutral prompt (shipped) |
| **Rec** | **Domain-neutral** — shipped |

### Shipped (implementation)

1. V1: `prompt: PROMPT_GENERAL` from `agent/prompt/general.txt` — domain-neutral multi-step worker; light hiring vocabulary when materials look like hiring work
2. Description no longer coding-biased
3. V2 twin: `item.system = PROMPT_GENERAL` in `packages/core/src/plugin/agent.ts`
4. Not a full copy of `recruit.txt`

### Acceptance (met)

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
| **Action** | IDENTITY → **DONE** (dual-load) |
| **Priority** | P2 |
| **Decision** | ☑ Dual-load; prefer moks (shipped) |
| **Rec** | **Dual-load; prefer moks** — shipped |

### Shipped (implementation)

- Dual-load `moks.json(c)` + `opencode.json(c)` project + global + nested dirs (`config/config.ts`, `ConfigPaths.projectConfigFiles`)
- Prefer moks when both present (merge after opencode)
- New global seed prefers **`moks.jsonc`** (still under `~/.config/opencode/` until BL-020)
- Schema URL still `https://opencode.ai/config.json` (catalog identity later)
- Tests in `test/config/config.test.ts`

### Acceptance (met)

Documented TA setup uses `moks.json`; `opencode.json` still works.

---

## BL-019 · Project dir `.opencode/` only

| | |
|--|--|
| **Action** | IDENTITY → **DONE** (dual-discover) |
| **Priority** | P2 |
| **Decision** | ☑ Dual-discover `.moks/` + `.opencode/` (shipped) |
| **Rec** | **Dual-discover** — shipped |

### Shipped (implementation)

- `ConfigPaths.directories`: targets `.opencode` then `.moks` (moks wins name conflicts)
- `isProjectConfigDir` basename-safe for both
- TUI config + theme discovery dual-scan `.moks` + `.opencode`
- Monorepo `.opencode/` for **installed OpenCode** unchanged and still loads

### Acceptance (met)

User can put hiring skills under `.moks/skill` and they load.

---

## BL-020 · Global app dir name `opencode`

| | |
|--|--|
| **Action** | IDENTITY |
| **Priority** | P2 — **PARKED** |
| **Decision** | ☑ **Leave alone for now** (2026-08-11). Needs more design before flip. |
| **Rec** | **Do not ship** with 018/019/021; revisit after dual-load + clear migrate/coexistence story |

### Why parked

moks and **installed OpenCode** both run on the same laptop. Global dirs today:

```ts
// packages/core/src/global.ts
const app = "opencode"
// → ~/.config/opencode, ~/.local/share/opencode, cache, state, tmp
```

That **collides** with the coding agent we use to build moks. Flipping `app` without a deliberate migrate/read-fallback plan risks auth/session/config corruption. Dual-load of project config (018/019) and env (021) does **not** require changing the global app dir first.

### When we reopen

| From | To |
|------|-----|
| App name `opencode` | App name **`moks`** |
| Existing data | One-time **migrate or read-fallback**; never blindly clobber OpenCode install data |
| DB / logs / auth | Live under moks paths after switch |

### Wrong-port risks

- Pointing moks at same dir forever → config/auth/session corruption across products.
- Auto-move without backup → data loss.
- Shipping app rename in the same wave as dual-load before coexistence is designed.

### Touches (later)

`packages/core/src/global.ts`, path helpers, install docs

### Acceptance (when unparked)

Running moks and OpenCode on the same machine uses different config/data dirs.

---

## BL-021 · Env vars `OPENCODE_*`

| | |
|--|--|
| **Action** | IDENTITY → **DONE** (dual-accept) |
| **Priority** | P2 |
| **Decision** | ☑ Dual-accept (shipped) |
| **Rec** | **GO** — shipped |

### Shipped (implementation)

- `packages/core/src/flag/flag.ts`: `env` / `truthyDual` — `MOKS_*` primary, `OPENCODE_*` fallback; Flag property names stay `OPENCODE_*`
- Logging + `MOKS_TEST_HOME` dual-read
- `MOKS_*` false does not fall through to OPENCODE true

### Residual

Some non-Flag `process.env.OPENCODE_*` reads elsewhere; CLI may still *set* OPENCODE_ vars (works via fallback).

### Acceptance (met)

`MOKS_CONFIG` / `MOKS_PURE` work; old env still works.

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

- Replacing AGENTS.md entirely → users lose workspace-level hiring (or SE) constitution injection.
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
| **To** | `hidden: true`; unhide via `default_agent: build` or config only if a user wants coding tools |
| **Note** | Not deleted; product cast is recruit + plan. **We** build moks with installed OpenCode, not with product `build`. |

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
| Monorepo `.opencode/` (`default_agent: build`, …) | Configures *installed OpenCode* building moks — not product moks |
| Using moks to code moks | **Non-goal** — global OpenCode is the dev tool |
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
| **G2 Chrome & defaults** | BL-004, BL-013, BL-014 | **Done** |
| **G5 Front doors** | BL-007–012 | **Done** (init/review + customize-moks + hide GH/console/generate + neutral CTAs) |
| **G6 Guardrails** | BL-015 path-scoped edit | **Done** (bash residual only) |
| **G4 Subagents** | BL-005 explore, BL-016 general | **Done** |
| **G1 Session helpers** | BL-003 tips, BL-006 title/summary/compaction | **Done** |
| **G7 Identity + first impression** | BL-003, BL-018/019/021 | **Done** (BL-020 parked) |
| **G7 residual** | BL-023, BL-024 | Open |
| **G8 Later** | BL-017, BL-020, BL-025–030 | Defer / parked |

---

## Suggested implementation order

| Wave | Issues | Outcome | Status |
|------|--------|---------|--------|
| **Cast + G3** | recruit doer, BL-001/002/022, BL-027 hide | Plan→recruit hiring-native | **Done** |
| **Ontology lock** | Thesis + cheat-sheet + 004/007/008/013/015 decisions | Shared SWE↔TA map | **Done (docs)** |
| **Ontology ship** | BL-004/007/008/013/015 + verb rename commit/push | Front doors, chrome, guardrails | **Done** |
| **G4 — Subagents** | BL-005, BL-016 | explore/general don’t pull back to coding | **Done** |
| **G1 helpers** | BL-006 | Titles/summaries/compaction not PR bots | **Done** |
| **G5 remainder** | BL-009–012 | customize-moks; hide GH/console/generate; neutral CTAs | **Done** |
| **G6 residual** | BL-014 | recruit: no lsp; no apply_patch prefer | **Done** |
| **G7 — Identity + tips** | BL-003, BL-018/019/021 | Tips + dual-load paths/env | **Done** |
| **Parked** | BL-020 global app dir | Coexist with installed OpenCode — design later | **Parked** |
| **G7 residual** | BL-023, BL-024 | Req instruction attach; provider catalog copy | Open |
| **G8 — Later** | BL-017, BL-025–030; bash patterns | Cosmetic, V2, hard-fork, tighter shell | Defer / residual |

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
packages/core/src/plugin/skill/customize-moks.md
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
- [x] **BL-005 shipped** — explore prompt/description = hiring materials recon
- [x] **BL-006 shipped** — compaction/summary/title not PR/coding-only
- [x] **BL-016 shipped** — general domain-neutral system prompt
- [x] **BL-009 shipped** — `customize-moks` skill
- [x] **BL-010/011 shipped** — hide github/pr/generate from root help (console already hidden)
- [x] **BL-012 shipped** — neutral provider-limit UX; no OpenCode Go as moks
- [x] **BL-014 shipped** — recruit: lsp deny; no apply_patch prefer
- [x] **BL-003 shipped** — hiring-first tips; AGENTS.md optional hiring norms
- [x] **BL-018 shipped** — dual-load moks.json + opencode.json (prefer moks)
- [x] **BL-019 shipped** — dual-discover `.moks/` + `.opencode/`
- [x] **BL-021 shipped** — `MOKS_*` primary, `OPENCODE_*` fallback

### Open
- [ ] **BL-023 / BL-024** — req instruction discovery; provider identity copy
- [ ] **Bash residual** — tighter destructive patterns on recruit (not a numbered BL; residual of BL-015)
- [ ] **BL-002 residual** — optional delete/port unused `plan-reminder-anthropic.txt`

### Parked
- [x] **BL-020** — Global app dir rename **left alone** until migrate/coexistence design (2026-08-11)
- [x] **Dev tool split** — build moks with **installed OpenCode**, not product moks (2026-08-11)

---

## Change log

| Date | Note |
|------|------|
| 2026-08-11 | **Tips + dual-load:** BL-003/018/019/021 shipped; customize-moks honesty; BL-020 still parked |
| 2026-08-11 | **Locks:** BL-020 parked; do not dogfood moks-for-coding-moks (use global OpenCode); keep AGENTS.md as workspace inject |
| 2026-08-11 | **Helpers + front doors:** BL-005/006/009/010/011/012/014/016 shipped; BL-003 tips deferred to P2; HTML companion synced |
| 2026-08-11 | **Ontology ship:** BL-004/007/008/013/015 implemented; verbs `commit`/`push` (was propose/apply); skill `commit-disposition`; `/init-code` escape hatch; LSP chrome hidden when off |
| 2026-08-11 | **Ontology lock:** thesis moks:TA::OpenCode:SWE; apply=push metaphor; `/init`=new req; `/review`=packet skill; keep Diff; LSP not TA; BL-007/008/004/013/015 decided; HTML companion |
| 2026-08-11 | Docs sync: mark cast+G3 done; refresh Current/shipped; decision groups; HTML companion |
| 2026-08-11 | G3: plan-mode/plan.txt hiring strategy; plan_exit hiring verbs; `.moks/plans` dual-path |
| 2026-08-11 | Locked cast: doer = `recruit` (was `ta`/`build`); `build` hidden; plan_exit → recruit |
| 2026-08-10 | Rewrote as implementation-grounded review: current OpenCode behavior, correct TA ports, wrong-port risks, semantic cheat-sheet |
