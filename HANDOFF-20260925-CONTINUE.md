# HANDOFF — 2026-09-25 (continue)

Self-contained. Paste into a fresh session.

## Environment invariants

- opencode **1.18.32** pinned; binary `C:/Users/Zephyrus/.local/bin/opencode-patched.exe`
- Pin mechanism = **`OPENCODE_BINARY` User env var**, NOT settings.json `opencodeBinary`.
  OpenChamber drops that settings key on every rewrite. Resolver: `process.env.OPENCODE_BINARY || searchPathFor('opencode')`.
- Verify pin: `C:/Users/Zephyrus/.config/openchamber/managed-opencode/<pid>.json` → `binary` must show `opencode-patched.exe`, not `resources/opencode-cli/opencode.exe`.
- squeez `auto_compress_md` is **DISABLED** (it was rewriting AGENTS.md/CLAUDE.md on every session start).
- Corpus `C:/Users/Zephyrus/corpus` is a private git repo (`github.com/mradwankhalil/env-canon`), `core.autocrlf=false` (bundle hashes byte-exact). `sync.mjs --apply` commits+pushes as its final step.
- Shell policy: Git Bash for POSIX, pwsh 7 for Windows-native, WSL only for genuinely Linux-y. Never pipe scripts into `bash -s`.
- `opencode models` is **authoritative** (259 entries). Both `/v1/models` endpoints UNDER-REPORT — trusted them twice, wrong twice.

## DONE — verified, do not redo

1. **opencode compaction fix** — `prompt.ts` passes `parentID: task.messageID` instead of `lastUser.id`. One cause, two symptoms: prompts landing in the marker→summary window orphaned the summary (infinite refire loop) AND discarded the OMO model pin. Live-verified 2026-09-25 11:39 compaction (summary anchored, `tail_start_id` written, `finish: stop`). Committed `b855924e87`; PR draft `d49d138607`. 59 pass / 1 skip / 0 fail; typecheck clean 30 packages.
2. **Pin mechanism** — `OPENCODE_BINARY` set, `pin-opencode.ps1` rewritten, `verify.mjs [6]` checks the env var, `manifest.json` documents it.
3. **Hindsight recall timeout** — `gateways/registry.json` hindsight `upstreamTimeoutMs` 30000→120000 (mirrors `lsp` precedent; exactly one field changed). Real duration measured 23–25 s = 77–82% of the old budget. Verified: the exact failing call now returns 12 results. Gateway restarted.
4. **squeez** — `auto_compress_md` disabled; scope established via `.original.md` backups: only AGENTS.md + CLAUDE.md were ever touched; corpus untouched. `squeez doctor` 7 ok / 0 fail.
5. **4 instruction blocks** canonical + in sync across all 4 files (AGENTS.md, CLAUDE.md, .codex, .gemini): `background-workers` (was damaged AND never synced), `shell-policy`, `mcp-directives`, `corpus-repo`.
6. **Corpus per-incident split** — branch `redesign/per-incident-split` @ `65ea7b6`. **NOT MERGED.** Ledger 392,359 → 85,711 B (now an index); 116 files in `corpus/incidents/`. Conservation verified: 3165 content lines checked, 0 missing. Fixed 3 silent-loss slicing bugs (preamble dropped, container claiming a hosted id, slice stopping at heading instead of next entry).
7. **Corpus git repo + autocommit** — private remote, `sync.mjs` auto-commit/push, Windows task `Canon Corpus Autocommit` daily 03:30. Both paths tested (commit+push PASS, mid-merge refusal PASS). Its test caught a real bug: `git rev-parse --git-dir` is relative → now `--absolute-git-dir`.
8. **Skills** — `mk-opencode-promote` created; `mk-omo-promote` corrected (env-var pin replaces a false settings.json claim). Both hardlinked across 3 harness roots.
9. **Models** — `cpa-gui` 35→40 definitions with thinking levels + context; OMO `omo.jsonc` 46 refs renamed + 18 stale category descriptions rewritten; `opencode-claude` Opus 5.5. 39/39 refs resolve, 0 dangling.
10. **3.9 GB freed** (2694 MB stale archive + 57 MB verified dup + 1195 MB Sept-12 backup).

## RESOLVED — `kimi-for-coding` was NOT broken (verified 2026-09-25)

**Actual status**: the provider block IS present and correct — `npm: @ai-sdk/openai-compatible`, `options.baseURL: https://api.kimi.com/coding/v1`, 4 models.
Live probes both **200**: `kimi-for-coding/k3-256k` 7.4s · `kimi-for-coding/kimi-for-coding` 1.9s.
The earlier `"undefined/chat/completions"` error was from a *previous* config state. The kimi line in the failing-subagent log was the **fallback being announced**, not a kimi failure.
**Working reference**: `~/.kimi-code/config.toml` (Kimi Code CLI — works, K2.8 Preview, 10 MCPs connected):
```toml
[providers."managed:kimi-code"]
type     = "kimi"
base_url = "https://api.kimi.com/coding/v1"
```
**Auth verified**: `~/.local/share/opencode/auth.json` → `kimi-for-coding: {type:"api", key:"sk-kim…"}` (72 ch).
Probe `GET https://api.kimi.com/coding/v1/models` with that key → **HTTP 200**, returns `kimi-for-coding` = K2.8 Preview, ctx 1048576, reasoning + image_in + video_in + dynamic_tools.

**Canonical definition** (already in `opencode.json` — keep for reference / restore):
```json
"kimi-for-coding": {
  "npm": "@ai-sdk/openai-compatible",
  "name": "Kimi For Coding",
  "options": { "baseURL": "https://api.kimi.com/coding/v1" },
  "models": {
    "kimi-for-coding":           { "name": "K2.8 Preview",        "limit": { "context": 1048576, "output": 131072 } },
    "kimi-for-coding-highspeed": { "name": "K2.7 Code Highspeed", "limit": { "context": 262144,  "output": 131072 } },
    "k3":                        { "name": "K3",                  "limit": { "context": 1048576, "output": 131072 } },
    "k3-256k":                   { "name": "K3-256k",             "limit": { "context": 262144,  "output": 131072 } }
  }
}
```
Then: `opencode models | grep -i kimi` → expect 4 entries; then one live call.

## RESOLVED — `anthropic/claude-opus-5-5` (Meridian vendored-CLI mismatch)

**Real cause**: Meridian's resolution order (`dist/cli-9e5cxp89.js:369` `resolveClaudeExecutableWithSource`) is:
1. `MERIDIAN_CLAUDE_PATH` env → **was unset**
2. **`@anthropic-ai/claude-code` inside Meridian's own `node_modules`** → **won** → resolved to **v2.1.276**
3. platform package
4. `where claude` → `~/.local/bin/claude.exe` **2.1.282** → **never reached**

Meridian 1.71.1 declares `"@anthropic-ai/claude-code": "^2.1.257"` and vendors it. `claude-opus-5-5` needs ≥2.1.280, so it always 400'd. The PATH binary is irrelevant to Meridian.

**Fix applied**: `MERIDIAN_CLAUDE_PATH = C:\Users\Zephyrus\.local\bin\claude.exe` (User scope), then restart scheduled task `Meridian Claude Max Proxy`.
Restart detail: `Stop-ScheduledTask` does NOT kill the tree → also `taskkill /PID <pid> /T /F`; then `Start-ScheduledTask`.
`cachedClaudeInfo` is module-level → a restart is mandatory after any change.

**Verified**: `anthropic/claude-opus-5-5` → 200 (8.5s). PID 28044 → 54104, `:3456` up in 5s.

**Also applied**: `claude-code/claude-opus-5-5` is now FIRST and Meridian SECOND in all 9 opus-5-5 chains in `omo.jsonc` (sisyphus + metis primary switched to claude-code; premium-deep prepended; 6 `claude-code/opus` aliases normalized to the explicit pin). Parse OK, 39 refs resolve, 0 unresolved. Live: `claude-code/claude-opus-5-5` PASS with and without `--variant xhigh` (13.3s). Backup: `~/.omo/omo.jsonc.bak-opusfallback-20260925192931Z`. Subagent dispatch verified working (11s, `SUBAGENT_OK`).

Note: `artistry` still lists `kimi-for-coding/k3-256k` ahead of claude-code (pre-existing, not introduced here).

## OPEN — corpus redesign (BLOCKED — must not merge yet)

`build_bundle.mjs` reads only root-level `.md` (line 41). Merging `redesign/per-incident-split` without updating it makes the next canon publish **succeed while silently dropping all 116 incident records from Hindsight** (the ledger is now an index).

Spec: `C:/Users/Zephyrus/Documents/ai/opencode-core-fix/specs/corpus-incident-redesign-design.md`
Remaining:
- (a) `build_bundle.mjs` — walk `incidents/`, emit one record per incident, id `env-canon:v1:15:<filename-stem>`, doc 15, surface `incidents`; **digest must include normalized relative paths** (a rename must change the digest); reject duplicate generated ids; deterministic sorted order; extract into fixture-testable logic with **no write-on-import**.
- (b) `corpus-add.mjs` — allocate ids via `fs.openSync(path,'wx')` with EEXIST retry.
- (c) update `mk-canon-update` skill.
- (d) then merge. Do not publish/delete/merge during migration.

## OPEN — Stage 1 MCP tool-selection test

Neutral prompt, `--format json` (**the only capture that carries `tool_use` events** — plain stdout lost all evidence, 57-byte banners).
Result so far: **8/9 models chose the MCP unprompted; no fabrication observed.** Tool-call count 1–6 (minimax/glm 1, google 1, sonnet 2, mimo 2, luna 3, qwen 3, deepseek 6 — deepseek's 6 were thorough verification, not confusion). kimi + anthropic produced nothing (the two config failures above).
Remaining: batch2 (8 tasks × minimax/glm/deepseek). Artifacts: `C:/Users/Zephyrus/.local/share/opencode/tool-output/inline1/`.
**Do NOT name the MCP in the prompt** — that tests instruction-following, not tool selection. User: *"why does a model never use the tools provided by the mcps and revert to bullshit like playwright or fetch the git repo."*
MCP enforcement needs tool-boundary hooks, not prompt text (see X-85/X-96).

## TRAPS THAT COST REAL TIME

- `Stop-ScheduledTask` does **not** kill the process tree → `taskkill /PID <pid> /T /F`; the task reports "Running" while the process is detached.
- `git rev-parse --git-dir` returns a **relative** path → use `--absolute-git-dir`.
- squeez swallows stdout on long output → redirect to file, then read the file.
- Git Bash eats `$` inside single quotes → write a script file, don't inline.
- `gateways/registry.json` is read **once at gateway startup** → restart after editing.
- PS 5.1 writes **UTF-16LE** (`ff fe` + NULs) → use pwsh 7 or Git Bash.
- WSL `/mnt/c` recursion is slow; WSL cannot read `opencode.db` (WAL over drvfs → disk I/O error).

## CONSTRAINTS (verbatim)

- "we will stay on 18.32"
- "i want 3 and 4 to be seamless. i dont want to do anything other than have maybe a skill that says mk-omo-promote and another one that says opencode-promote and have everything applied with our local fixes all of them please. also takes into account updating openchamber setting.json file to pin to new version"
- "next time split this script few models at a time. a script that runs for over 15 or 30 minutes is not a script it is a circus"
- "well we know it will work if i tell u use the grep_app mcp to read github repo u will. what is that proving really. the problem is why does a model never use the tools provided by the mcps and revert to bullshit like playwrite or fetch the git repo etc"
- "please just report after task is completed with brief details"
- "do not stop just report after each task completion"
- "do it inline yourself"
- New skills MUST match `^mk-[a-z0-9]+(-[a-z0-9]+)*$`; background workers `run_in_background=true` only, report to `<project-root>/sub-agents-reports/<slug>-YYYYMMDD-HHMMSSZ.md`.
- LSP `diagnostics` mandatory on every file edited.

## Relevant files

| Path | Role |
|---|---|
| `C:/Users/Zephyrus/.config/opencode/opencode.json` | **kimi-for-coding fix target**; also cpa-gui (40 models), anthropic (:3456), `mcp.*.timeout: 120000` |
| `C:/Users/Zephyrus/.kimi-code/config.toml` | working Kimi reference (endpoint + model metadata) |
| `C:/Users/Zephyrus/corpus/` | `redesign/per-incident-split` @ `65ea7b6`; `incidents/` (116 files) |
| `C:/Users/Zephyrus/Documents/ai/tools/env-canon/` | `corpus-split.mjs`, `build_bundle.mjs` (needs incidents walk), `sync.mjs`, `corpus-autocommit.mjs` |
| `C:/Users/Zephyrus/Documents/ai/opencode-core-fix/specs/corpus-incident-redesign-design.md` | agreed redesign spec |
| `C:/Users/Zephyrus/Documents/ai/gateways/registry.json` | hindsight `upstreamTimeoutMs: 120000` |
| `C:/Users/Zephyrus/.local/share/opencode/tool-output/inline1/` | Stage 1 artifacts + `inline-batch*.sh` |
| `C:/Users/Zephyrus/.claude/skills/mk-opencode-promote/`, `mk-omo-promote/` | promotion skills |

**Do not modify**: `C:/Users/Zephyrus/.omo/omo.jsonc`, `C:/Users/Zephyrus/Documents/ai/oh-my-openagent-fix`.
