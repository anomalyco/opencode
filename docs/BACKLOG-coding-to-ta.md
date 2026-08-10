# Backlog: coding / OpenCode → recruiting / moks

Review doc for product molding. Companion HTML: `docs/backlog-coding-to-ta.html`.

**Principle:** mold the harness, don’t rebuild. Keep kernel; change prominence, defaults, copy, and plan/explore wiring.

**Legend**

| Tag | Meaning |
|-----|---------|
| PORT | Rewrite coding concept into TA equivalent |
| HIDE | Soft-remove from default TA UX; keep code |
| DROP | Quarantine from TA GTM / user-facing CLI |
| KEEP | Already correct or generic infra |
| IDENTITY | Paths, names, schemas still say OpenCode |
| V2 | Required when Session V2 product path ships |

**Priority bands**

| P | Band |
|---|------|
| P0 | Felt product path — TA loop must not feel like a coding agent |
| P1 | Front-doors and defaults that still advertise coding |
| P2 | Identity / config so moks doesn’t collide with installed OpenCode |
| P3 | Hard-fork polish; delete or rename only when deliberate |

---

## Already done (baseline — do not re-open)

| From (coding / OpenCode) | To (recruiting / moks) | Status |
|--------------------------|------------------------|--------|
| Default agent `build` | Default agent `ta` (product binary) | Done — monorepo `.opencode` still forces `build` for *building* moks |
| Generic SE system prompt only | `product/agents/ta.txt` hiring persona | Done — only when agent is `ta` |
| No hiring skills | `req-context`, `score-candidate`, `draft-outreach`, `propose-disposition` | Done |
| Raw ATS writes as hero | `propose` → receipt → `apply` (+ confirm-adverse) | Done |
| No fixtures | Local JD / resume / scorecard + Ashby mock MCP | Done |
| Bin / chrome `opencode` | User-facing `moks` | Done (internal packages still OpenCode-named) |

---

## P0 — Felt product path

### BL-001 · Plan exit targets implementer `build`

| | |
|--|--|
| **ID** | BL-001 |
| **Action** | PORT |
| **From** | `plan_exit` asks “switch to **build** and start implementing?” then sets `agent: "build"` (`tool/plan.ts`, `session/reminders.ts`, `session/prompt/plan*.txt`, `build-switch.txt`) |
| **To** | Plan exit offers TA next steps: score candidates / draft outreach / propose disposition; switch back to **`ta`** (or stay on a hiring-plan agent). No “implement code” language. |
| **Touches** | `packages/opencode/src/tool/plan.ts`, `tool/plan-enter.txt`, `session/reminders.ts`, `session/prompt/plan*.txt`, `session/prompt/build-switch.txt` |
| **Acceptance** | Completing plan mode never names `build` or “implement”; default agent after exit is `ta`. Coding users can still opt into `build` via agent switcher. |

### BL-002 · `plan` agent is a coding design mode

| | |
|--|--|
| **ID** | BL-002 |
| **Action** | PORT |
| **From** | Primary `plan`: deny edits except `.opencode/plans/**`; designed for software design-then-build; denies `task`→`general` |
| **To** | Hiring plan mode: plan req strategy, interview loop, scorecard criteria, outreach sequence. Allow edits under `.moks/plans/**` (or dual-path). Subagents may research candidates/req materials. |
| **Touches** | `packages/opencode/src/agent/agent.ts` (`plan` block), plan permission paths, plan prompt files |
| **Acceptance** | With default `ta` product path, entering plan mode reads as hiring strategy, not implementation design. |

### BL-003 · Home tips / onboarding still teach coding agent

| | |
|--|--|
| **ID** | BL-003 |
| **Action** | PORT |
| **From** | Tips push `/init` (AGENTS.md), `/review`, LSP/formatters, coding config pedagogy (`tui/.../home/tips-view.tsx`, status dialog) |
| **To** | Tips teach eng-TA loop: load fixtures or `.moks/req/`, `/req-context`, `/score-candidate`, `/draft-outreach`, `/propose-disposition`, `moks propose` / `apply`, Ashby read-only edge, `/decisions` |
| **Touches** | `packages/tui/src/feature-plugins/home/tips-view.tsx`, `component/dialog-status.tsx` (copy), any empty-state strings |
| **Acceptance** | Fresh TUI session tips never lead with AGENTS.md, git review, or LSP. |

### BL-004 · Soft-hide coding chrome when agent is `ta`

| | |
|--|--|
| **ID** | BL-004 |
| **Action** | HIDE |
| **From** | Diff viewer (`/diff`), Modified Files sidebar, LSP sidebar always part of session chrome |
| **To** | When active agent is `ta` (and no pending file-edit permissions): hide or demote LSP sidebar; demote diff/modified-files unless session has actual file mutations. Keep full chrome for `build`. |
| **Touches** | `packages/tui/src/feature-plugins/system/diff-viewer*.tsx`, `sidebar/files.tsx`, `sidebar/lsp.tsx`, session layout |
| **Acceptance** | Default `ta` session looks like a hiring workplace, not an IDE. Switching to `build` restores coding chrome. |

### BL-005 · `explore` subagent assumes codebases

| | |
|--|--|
| **ID** | BL-005 |
| **Action** | PORT |
| **From** | `explore`: “codebase search”; prompt examples `*.tsx`, source trees (`agent/prompt/explore.txt`, agent description) |
| **To** | Research subagent for req materials, fixtures, notes, scorecards, local ATS dumps, public company/candidate pages (read tools + webfetch). Description: “Explore hiring materials and local files.” |
| **Touches** | `packages/opencode/src/agent/agent.ts`, `agent/prompt/explore.txt`, task tool copy if it hardcodes “explore agent” for code |
| **Acceptance** | Spawning explore from `ta` never instructs “search the codebase for implementations.” |

### BL-006 · Hidden prompts still say coding / PR

| | |
|--|--|
| **ID** | BL-006 |
| **Action** | PORT |
| **From** | `compaction.txt` (“coding sessions”), `summary.txt` (“like a pull request description”), `title.txt` examples are SE-heavy |
| **To** | Domain-neutral or TA-aware: compaction = “session history”; summary = “hiring session brief”; title examples include “Score Jordan Lee for SWE II”, “Outreach draft — Northline” |
| **Touches** | `packages/opencode/src/agent/prompt/{compaction,summary,title}.txt` |
| **Acceptance** | Auto titles/summaries on `ta` sessions don’t sound like PR bots. |

---

## P1 — Front-doors still advertising coding

### BL-007 · `/init` → AGENTS.md from repo

| | |
|--|--|
| **ID** | BL-007 |
| **Action** | PORT |
| **From** | `/init` template walks repo/build/test/CI and writes `AGENTS.md` (`command/template/initialize.txt`) |
| **To** | `/init` (or `/init-req`) scaffolds a moks hiring workspace: `.moks/`, sample or empty `req/` (jd, scorecard, notes), gitignore `.moks/`, optional Ashby MCP snippet, points at hiring skills. Optionally still support coding init behind `--agent build` or a separate `/init-code` for dogfooding. |
| **Touches** | `packages/opencode/src/command/template/initialize.txt`, command registry labels |
| **Acceptance** | Default `/init` in product never creates AGENTS.md-as-coding-bible as the hero path. |

### BL-008 · `/review` → git / PR code review

| | |
|--|--|
| **ID** | BL-008 |
| **Action** | PORT or DROP |
| **From** | `/review` reviews uncommitted/commit/branch/PR via git + `gh` (`command/template/review.txt`) |
| **To (PORT)** | `/review` reviews candidate packet: resume vs JD/scorecard, outreach draft quality, disposition rationale consistency. |
| **To (DROP)** | Remove from default command list; leave file only for `build` agent permission. |
| **Touches** | `command/template/review.txt`, command registration, tips |
| **Acceptance** | Default `ta` slash menu does not offer “review this PR.” |

### BL-009 · Skill `customize-opencode`

| | |
|--|--|
| **ID** | BL-009 |
| **Action** | PORT |
| **From** | Built-in skill teaches `opencode.json`, OpenCode agents/skills/MCP schemas |
| **To** | `customize-moks` (alias old name): moks workspace config, `ta` permissions, Ashby edge, hiring skills layout, dual-load of `moks.json` / `opencode.json` |
| **Touches** | `packages/opencode/src/skill/index.ts` (+ skill content source), any skill ID references |
| **Acceptance** | Skill picker shows moks-oriented customize skill; content doesn’t send users to opencode.ai docs as primary. |

### BL-010 · CLI `github` / `pr` as product surface

| | |
|--|--|
| **ID** | BL-010 |
| **Action** | DROP |
| **From** | `moks github`, `moks pr <n>` — GitHub Actions coding agent + PR checkout workflow |
| **To** | Hidden from help/GTM; keep code for monorepo dogfooding if needed; document only under “contributor” not “eng-TA” |
| **Touches** | `cli/cmd/github.ts`, `cli/cmd/pr.ts`, `index.ts` registration, README |
| **Acceptance** | `moks --help` for TA install does not feature GitHub coding agent. |

### BL-011 · CLI `generate`, `console` / account

| | |
|--|--|
| **ID** | BL-011 |
| **Action** | DROP |
| **From** | OpenAPI sample generator; OpenCode console/org login |
| **To** | Dev-only or removed from TA help; no console.opencode.ai as moks identity |
| **Touches** | `cli/cmd/generate.ts`, `cli/cmd/account.ts`, help text |
| **Acceptance** | TA-facing help list is run/TUI/verbs/MCP/providers/session — not SDK generate or upstream console. |

### BL-012 · Provider / commercial upsells to OpenCode

| | |
|--|--|
| **ID** | BL-012 |
| **Action** | PORT |
| **From** | TUI upsells `opencode.ai/go`, console.opencode.ai free models as primary CTA; referer headers / models host still opencode |
| **To** | Neutral “connect a provider”; optional third-party backends clearly labeled; no moks branding as OpenCode commercial |
| **Touches** | TUI session upsell, `dialog-retry-action.tsx`, provider dialogs, `core` opencode provider plugin copy |
| **Acceptance** | Failed-auth / empty-provider UX does not push users into OpenCode Go as *moks*. |

### BL-013 · Default product config: LSP + formatters on

| | |
|--|--|
| **ID** | BL-013 |
| **Action** | HIDE |
| **From** | Bootstrap starts broad LSP matrix + formatters (IDE-ish coding agent) |
| **To** | Shipped TA defaults: `lsp: false`, `formatter: false` (or lazy no-op). Power users / `build` can re-enable. |
| **Touches** | Config defaults, project bootstrap, sample configs, `dialog-status` sections |
| **Acceptance** | Fresh eng-TA install does not spawn typescript/gopls/etc. |

### BL-014 · Tools: `lsp`, `apply_patch` prominence

| | |
|--|--|
| **ID** | BL-014 |
| **Action** | HIDE |
| **From** | `lsp` experimental tool + `apply_patch` multi-file coding edit path in registry |
| **To** | Not on default `ta` tool list; remain available for `build`. Prefer `read`/`edit`/`write` lightly for notes. |
| **Touches** | `tool/registry.ts`, agent permission profiles for `ta` |
| **Acceptance** | `ta` agent tool list does not include LSP; apply_patch not primary. |

### BL-015 · `ta` permission profile still coding-wide

| | |
|--|--|
| **ID** | BL-015 |
| **Action** | PORT |
| **From** | Defaults: broad `edit`/`write`/`bash` allow (with some asks); only Ashby writes special-cased |
| **To** | `ta` profile: read/skill/MCP-read/question allow; `edit`/`write` ask (or allow only under `.moks/**` and fixtures); `bash` allow for `moks` verbs + light shell, ask for destructive; keep Ashby write deny |
| **Touches** | `agent/agent.ts` `ta` permissions, maybe sample `moks` permission block in docs |
| **Acceptance** | Scoring a resume doesn’t silently rewrite the repo; note drafts under `.moks/` stay easy. |

### BL-016 · `general` subagent has no TA bias

| | |
|--|--|
| **ID** | BL-016 |
| **Action** | PORT (light) |
| **From** | `general` multi-step subagent, no custom prompt → falls through to **coding** provider system prompts |
| **To** | Either give `general` a short domain-neutral prompt, or when parent is `ta`, inject TA-safe system text so spawned tasks don’t become “software engineer” |
| **Touches** | `agent/agent.ts`, `session/llm/request.ts` / system prompt selection |
| **Acceptance** | `task` from `ta` does not revive full coding persona mid-hiring loop. |

### BL-017 · UI theme names `v2-agent-build/plan/explore`

| | |
|--|--|
| **ID** | BL-017 |
| **Action** | PORT (cosmetic) |
| **From** | Theme IDs/names centered on build/plan/explore coding cast |
| **To** | Neutral or TA-flavored display names; keep IDs if needed for compat |
| **Touches** | `packages/ui/src/theme/*` |
| **Acceptance** | Theme picker doesn’t read as “pick your coding agent skin” only. |

---

## P2 — Identity & paths (OpenCode → moks)

### BL-018 · Config filename `opencode.json` only

| | |
|--|--|
| **ID** | BL-018 |
| **Action** | IDENTITY |
| **From** | Loads `opencode.json(c)`; writes `$schema: https://opencode.ai/config.json` |
| **To** | Dual-load `moks.json(c)` + `opencode.json(c)`; prefer moks when both; schema URL moks-hosted or local; tips/errors say moks |
| **Touches** | `packages/opencode/src/config/config.ts`, TUI error strings, provider dialogs |
| **Acceptance** | Documented TA setup uses `moks.json` or `.moks/`; old file still works. |

### BL-019 · Project dir `.opencode/` only

| | |
|--|--|
| **ID** | BL-019 |
| **Action** | IDENTITY |
| **From** | Agents/skills/commands/tools discovered under `.opencode/` |
| **To** | Dual-discover `.moks/` + `.opencode/`; product docs teach `.moks/`. Monorepo keeps `.opencode/` for *installed* dev agent (unchanged). |
| **Touches** | Config path discovery, skill/agent loaders, FORK/AGENTS docs clarity |
| **Acceptance** | User can put hiring skills under `.moks/skill` and they load. |

### BL-020 · Global app dir name `opencode`

| | |
|--|--|
| **ID** | BL-020 |
| **Action** | IDENTITY |
| **From** | `Global` app = `"opencode"` → `~/.config/opencode`, `~/.local/share/opencode`, DB, logs — **collides with installed OpenCode** |
| **To** | App name `moks` with one-time migrate/read-fallback from opencode paths where safe; never clobber unrelated OpenCode install data blindly |
| **Touches** | `packages/core/src/global.ts`, path helpers, install docs |
| **Acceptance** | Running moks and OpenCode on same machine uses different config/data dirs. |

### BL-021 · Env vars `OPENCODE_*`

| | |
|--|--|
| **ID** | BL-021 |
| **Action** | IDENTITY |
| **From** | Feature flags and paths via `OPENCODE_*` |
| **To** | Accept `MOKS_*` primary; fall back `OPENCODE_*` for fork compat |
| **Touches** | Env reads across opencode package |
| **Acceptance** | Docs show `MOKS_`; old env still works. |

### BL-022 · Plans path `.opencode/plans`

| | |
|--|--|
| **ID** | BL-022 |
| **Action** | IDENTITY + PORT |
| **From** | Plan files under `.opencode/plans` |
| **To** | `.moks/plans` (dual-write/read during transition) |
| **Touches** | session plan paths, plan agent permissions |
| **Acceptance** | Hiring plans land in moks workspace dir. |

### BL-023 · Instruction files = AGENTS.md / CLAUDE.md only

| | |
|--|--|
| **ID** | BL-023 |
| **Action** | PORT |
| **From** | Project instruction discovery oriented to coding agent markdown |
| **To** | Also load `.moks/req/` brief, scorecard, notes as first-class session context for `ta` (without requiring AGENTS.md) |
| **Touches** | `session/instruction.ts`, system context assembly |
| **Acceptance** | Opening a req folder gives hiring context without a coding AGENTS.md. |

### BL-024 · Models / provider host defaults

| | |
|--|--|
| **ID** | BL-024 |
| **Action** | IDENTITY |
| **From** | Default catalog `models.opencode.ai`, OpenCode provider plugin, referers `opencode.ai` |
| **To** | Neutral defaults or moks-operated catalog when ready; OpenCode Zen remains optional labeled backend |
| **Touches** | `core/src/models-dev.ts`, `plugin/provider/opencode.ts`, headers |
| **Acceptance** | Product doesn’t imply moks *is* OpenCode’s model service. |

---

## P3 — Defer / hard-fork only

### BL-025 · Mass rename packages / `OPENCODE_*` internals

| | |
|--|--|
| **ID** | BL-025 |
| **Action** | DROP (defer) |
| **From** | `packages/opencode`, `@opencode-ai/*`, dual bin `opencode` |
| **To** | Deliberate hard fork rename later per ROADMAP |
| **Note** | Do not start until identity dual-load (P2) is done and upstream merge strategy is chosen. |

### BL-026 · Prune desktop / console / web / SST

| | |
|--|--|
| **ID** | BL-026 |
| **Action** | DROP (defer) |
| **From** | Full monorepo upstream packages |
| **To** | Leave unmaintained; no investment (ROADMAP locked) |

### BL-027 · Delete `build` agent entirely

| | |
|--|--|
| **ID** | BL-027 |
| **Action** | HIDE (not delete) |
| **From** | Native `build` coding agent always registered |
| **To** | Remain for dogfooding + escape hatch; optional compile/flag to omit in “TA-only” dist later |
| **Note** | Monorepo `.opencode` needs `build`. |

### BL-028 · Delete LSP / formatter codebases

| | |
|--|--|
| **ID** | BL-028 |
| **Action** | HIDE (not delete) |
| **From** | Large `src/lsp`, `src/format` trees |
| **To** | Defaults off (BL-013); delete only at hard fork if weight matters |

### BL-029 · V2 agent plugin still coding-default

| | |
|--|--|
| **ID** | BL-029 |
| **Action** | V2 |
| **From** | `packages/core` AgentV2 `defaultID = "build"`; plugin seeds build/plan/general/explore — **no `ta`** |
| **To** | V2 product path: default `ta`, seed hiring agent + skills parity, plan→ta wiring |
| **Touches** | `packages/core/src/agent.ts`, `plugin/agent.ts`, migrations default `'build'`, specs `specs/v2/*` |
| **Acceptance** | When V2 is the runtime, product default is still hiring-native. |

### BL-030 · Web docs `agents.mdx` still OpenCode Build/Plan/Scout

| | |
|--|--|
| **ID** | BL-030 |
| **Action** | DROP (defer) |
| **From** | `packages/web` upstream docs |
| **To** | Ignore until web is in scope; README + product headless.md are source of truth |

---

## Explicit non-goals (leave alone)

| Item | Why |
|------|-----|
| Session runner, permission engine, MCP host, skill loader, multi-provider | Kernel — KEEP |
| Decision verbs + receipts | Already TA authority layer |
| Monorepo `.opencode/` (`default_agent: build`, triage, Effect skill) | Configures *installed* agent building moks — not product |
| `packages/opencode` folder name | Inherited; rename is hard-fork |
| Desktop / console / web / SST investment | ROADMAP defer |

---

## Suggested implementation order

| Wave | Issues | Outcome |
|------|--------|---------|
| **W1 — Feel** | BL-003, BL-004, BL-006, BL-013 | Fresh `ta` session doesn’t look/teach IDE |
| **W2 — Personas** | BL-001, BL-002, BL-005, BL-016 | plan/explore/general don’t pull back to coding |
| **W3 — Front doors** | BL-007, BL-008, BL-009, BL-010, BL-011, BL-012 | Slash/CLI/skills/CTAs are hiring-shaped |
| **W4 — Guardrails** | BL-014, BL-015 | `ta` tools + permissions safer for recruiters |
| **W5 — Identity** | BL-018–BL-024 | moks paths don’t fight installed OpenCode |
| **W6 — Later** | BL-017, BL-025–BL-030 | Cosmetic, V2, hard-fork |

---

## Traceability (hot files)

```
packages/opencode/src/agent/agent.ts
packages/opencode/src/agent/prompt/*
packages/opencode/src/product/agents/ta.txt
packages/opencode/src/product/skills/**
packages/opencode/src/command/template/{initialize,review}.txt
packages/opencode/src/tool/{plan,registry,lsp,apply_patch}.ts
packages/opencode/src/session/{system,reminders,instruction}.ts
packages/opencode/src/session/prompt/*
packages/opencode/src/skill/index.ts
packages/opencode/src/cli/cmd/{github,pr,generate,account}.ts
packages/opencode/src/config/config.ts
packages/core/src/global.ts
packages/core/src/plugin/agent.ts
packages/tui/src/feature-plugins/home/tips-view.tsx
packages/tui/src/feature-plugins/system/diff-viewer*
packages/tui/src/feature-plugins/sidebar/{files,lsp}.tsx
```

---

## Review checklist (for you)

- [ ] Agree P0 plan→`ta` (BL-001/002) vs kill plan mode for v0
- [ ] `/review`: PORT vs DROP (BL-008)
- [ ] How aggressive on `ta` edit permissions (BL-015)
- [ ] Global dir migrate now vs after WAU (BL-020)
- [ ] Keep `build` forever as escape hatch (BL-027) — recommended yes
