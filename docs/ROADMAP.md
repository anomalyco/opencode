# moks product roadmap (v0)

Strategy: `docs/gtm.html`. Fork facts: `docs/FORK.md`.  
**Metric:** weekly active eng-TA on a real req in the TUI. No WAU → no Cloud.

We mold the OpenCode fork — we do not rebuild the harness from zero.

## Locked decisions

| Topic | Decision |
|--------|----------|
| ATS | **Ashby preferred** (official MCP). Sandbox when available; **fixtures/files until then**. Greenhouse later. |
| Rebrand | **User-facing now** (`moks` bin, README, TUI copy). **Keep** inherited package names (`packages/opencode`, `@opencode-ai/*`) until deliberate divergence. |
| Unused packages | **Leave them.** Don’t invest in desktop/console/web/SST unless asked. |
| Receipts | **Hybrid:** default user data dir; if cwd is a moks workspace (`.moks/`), use `.moks/receipts/`. Always gitignore `.moks/`. |
| Skills vs MCP | **MCP = edge tools** (vendor read). **Skills = prompt packs** (hiring loop). **Verbs + receipts = authority** (`commit` / `push` / confirm-adverse). |
| CLI | Headless is a **mode of Open**, not a co-equal pillar. |

## Do not confuse

- **moks** = this product  
- **OpenCode upstream** = source lineage  
- **OpenCode installed** = dev agent building moks  

## v0 backlog

### 1. Identity (thin, early)

- [x] Ship user-facing name **`moks`** (bin / help / TUI chrome / README)
- [x] Install story aimed at eng-TA (rough OK) — source install in README; `./install` is moks-branded stub (no upstream binary download)
- [x] MIT + upstream copyright kept; no official OpenCode affiliation — LICENSE + README
- [x] Do **not** mass-rename internal packages yet

### 2. Decision discipline (before any ATS write)

- [x] Local **decision receipts** (append-only JSONL; dry-run flag; no secrets in meta by default)
- [x] Receipt paths: user data dir default · `.moks/receipts/` in a moks workspace
- [x] Freeze shared write verbs: `commit` / `status` / `push` (+ `--json`)
- [x] TUI shells those verbs — no policy/push eligibility forked into the client
- [x] **Dry-run default**; **confirm-on-adverse** (reject / offer / hire)
- [x] Hero demo ≠ silent `advance_stage` (verbs record receipts only; no ATS write path)

### 3. Hiring-native agent (felt product)

- [x] Default agents/skills for TA (not coding defaults) — native `recruit` default; `build` hidden escape hatch; monorepo `.opencode` keeps `default_agent: build`
- [x] Prompt packs v0:
  - [x] `req-context`
  - [x] `score-candidate`
  - [x] `draft-outreach`
  - [x] `commit-disposition`
- [x] Fixture mode: JD / resume / scorecard as local files so loops work without ATS — `packages/opencode/src/product/fixtures/hiring/`
- [x] One provider path E2E in the moks-branded binary — `test/product/hiring-e2e.test.ts` (TestLLMServer / cli-process)

### 4. Edges (read-first)

- [x] Wire **Ashby MCP read** (config + allowlist) — sample `packages/opencode/src/product/fixtures/mcp/opencode.ashby-mock.json`; helpers `src/product/ashby-edge.ts`; `recruit` agent merges allow-reads/deny-writes (live Ashby sandbox still TBD)
- [x] Until sandbox: mock MCP + fixtures — `src/product/fixtures/mcp/ashby-mock.ts` + `ashby-data.json`
- [x] Deny MCP **writes** by default — `ashby_change_stage` / `ashby_create_note` deny on `recruit` + sample config; mock returns error pointing at commit/push
- [ ] Optional notes read later — don’t block v0

### 5. Headless mode (not a pillar)

- [x] Same verbs via headless / `--json` (scriptable, exit codes)
  - Decision: `commit|status|push --json` (push exit 2 = `needs_confirm`)
  - Agent: `run --json` ≡ `--format json` (NDJSON events); still reject mini+json
  - Docs: `packages/opencode/src/product/headless.md` + README / fixtures notes
  - Smoke: `test/product/headless.test.ts` + existing `test/decision/cli-smoke.test.ts`
- [x] No separate CLI product roadmap until kernel-on

### 6. Light success check

- [x] Know (even manually) whether an eng-TA ran a real req this week — `moks activity --days 7` summarizes local decision receipts (commit/push). Signal is light automation only; “real req” vs fixtures remains a human judgment in the TUI. No phone-home telemetry.

## Explicitly defer

- Req rooms / multiplayer SoR  
- Server kernel / policy cathedral  
- CLI as co-equal GTM pillar (`watch`, bulk CI)  
- Multi-ATS write matrix  
- Full package rename / monorepo prune  
- Desktop, console, web, SST investment  
- Own models catalog / hosting (keep third-party `models.opencode.ai` until post-WAU)  
- Cloud GTM  

## Sequencing

1. Identity (`moks` user-facing)  
2. Receipts + write verbs + adverse confirm  
3. Hiring prompt packs + fixtures  
4. Ashby MCP read (sandbox or fixtures)  
5. Headless verb parity  
6. Stop and measure WAU before Cloud  

## Architecture rules (from GTM)

- Edges are adapters, not identity.  
- Open may *feel* like an MCP host; it must not *become* a sovereign thin client we migrate off of.  
- Writes prefer commit → receipt → push (later: kernel), not raw vendor stage moves.  
- Money later is org control of how agents run — not locking the TUI.  
