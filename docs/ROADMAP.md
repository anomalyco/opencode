# moks product roadmap (v0)

Strategy: `docs/gtm.html`. Fork facts: `docs/FORK.md`.  
**Metric:** weekly active eng-TA on a real req in the TUI. No WAU → no Cloud.

Mold the harness — do not rebuild the session runner.

## Locked ontology

| | |
|--|--|
| **cwd** | The requisition |
| **HIRING.md** | Constitution (hierarchical, like AGENTS.md) |
| **candidates/*.md** | Working copies (frontmatter: `stage` / `score` / `source` / `ats_id`) |
| **git commit** | Audit trail |
| **moks push** | ATS write (mock now) |
| **`.moks/`** | Cache only (`ats.json`, plans) — not the hiring book |

## Locked decisions

| Topic | Decision |
|--------|----------|
| Fork | **Hard fork (operational).** Do not merge `upstream/dev`. Cherry-pick only. Unused OpenCode company packages are being pruned. Keep `@opencode-ai/*` names until a later rename. |
| ATS | **Ashby preferred** (official MCP). Mock write via `moks push`. Remote later (not committed to Ashby). Greenhouse later. |
| Rebrand | **User-facing now** (`moks` bin, README, TUI copy). **Keep** inherited package names until deliberate divergence. |
| Audit | **git** is the book. Receipts-as-product (JSONL under `.moks/receipts/`) is **superseded**. |
| Write path | **`moks push`** applies ATS writes (mock). Agent MCP writes stay denied. Confirm-on-adverse. |
| Skills vs MCP | **MCP = edge tools.** **Skills = prompt packs.** Authority is git + push, not vendor tools. |
| CLI | Headless is a **mode of Open**, not a co-equal pillar. |
| Runner | **Do not rebuild** the session runner. |

## Do not confuse

- **moks** = this product
- **OpenCode upstream** = source lineage
- **OpenCode installed** = dev agent building moks

## v0 backlog

### 1. Identity (thin, early) — done

- [x] Ship user-facing name **`moks`** (bin / help / TUI chrome / README)
- [x] Install story aimed at eng-TA — source install in README; `./install` is moks-branded stub
- [x] MIT + upstream copyright kept; no official affiliation
- [x] Do **not** mass-rename internal packages yet

### 2. Receipts as product — superseded

- [x] Local JSONL receipts + dry-run / confirm verbs shipped (Aug 11)
- **Superseded:** git commit is the audit. `.moks/` is cache, not a receipt book. Do not invest further in receipts-as-product.

### 3. Hiring-native agent (felt product)

- [x] Default agents/skills for TA — native `recruit`; `build` hidden; monorepo `.opencode` keeps `default_agent: build`
- [x] Prompt packs v0: `req-context` · `score-candidate` · `draft-outreach` · `commit-disposition`
- [x] Fixture mode: HIRING.md + candidate cards (samples may still exist) — `packages/opencode/src/product/fixtures/hiring/`
- [x] One provider path E2E — `test/product/hiring-e2e.test.ts`
- [x] Treat cwd as the requisition: `HIRING.md` + `candidates/*.md`

### 4. Push as ATS write

- [x] Ashby MCP **read** + deny MCP **writes** on the agent — mock in `src/product/fixtures/mcp/`
- [x] **`moks push` applies ATS writes** via mock (not receipts-only)
- [ ] Deferred remote (not committed to Ashby)
- [ ] Optional notes read later — don’t block v0

### 5. Headless mode (not a pillar)

- [x] Same verbs via headless / `--json` (scriptable, exit codes)
- [x] No separate CLI product roadmap until kernel-on

### 6. Light success check

- [x] `moks activity --days 7` — light local signal. “Real req” vs fixtures is a human judgment. No phone-home.

## Explicitly defer

- Req rooms / multiplayer SoR
- Server kernel / policy cathedral
- CLI as co-equal GTM pillar
- Multi-ATS write matrix
- Full `@opencode-ai/*` package rename
- Own models catalog / hosting
- Cloud GTM
- Merging `upstream/dev`

## Sequencing

1. Identity — done
2. Receipts-as-product — superseded by git
3. Hiring prompt packs + fixtures — done
4. **Push as ATS write (mock)** — done
5. Stop and measure WAU before Cloud

## Architecture rules

- Edges are adapters, not identity.
- Do not rebuild the session runner.
- Writes: edit working copies → git commit (audit) → `moks push` (ATS, mock).
- Agent MCP writes stay denied.
