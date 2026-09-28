# oclite — progress

## Tasks
| Phase | Task | Owner | Gate |
|---|---|---|---|
| 0 | Recon A (model/tools/agent) → docs/recon/A-model-tools-agent.md | cartographer | PASS (spot-checked: default.txt = 8528 chars) |
| 0 | Recon B (MCP/permission/session) → docs/recon/B-mcp-permission-session.md | cartographer | PASS |
| 0 | Path-import smoke test (lead) | lead | PASS: `bun run` + `bun typecheck` exit 0 importing `opencode/mcp/index` and `opencode/agent/subagent-permissions`, with tsconfig `paths {"@/*": ["../opencode/src/*"]}`, DOM lib, and `src/opencode-ambient.d.ts` referencing opencode's audio/sql/markdown d.ts. Typecheck ~5s. Without these: 30–561 errors. || 1 | ADR.md (103 lines) + ARCHITECTURE.md (861 lines) | architect | APPROVED by lead after full read. 42 files / ~6,640 lines planned vs 45 / 7,000. |
| 2 | Skeleton: contract, CLI tree, config layering, agents, redact, size-budget, agents/mcp commands | cli-engineer | PASS after 1 fix round (reviewer B1 secret leak in decode errors, B2 URL/arg redaction). Lead gate: `bun typecheck` exit 0; `bun test` 45 pass / 0 fail; size budget 10/45 files, 1297/7000 lines; verified a bad `mcp` entry with a Bearer token exits 2 and prints no secret. |

## Decisions
- Repo: `~/code/opencode-dev` (1.18.33 copy without `.git`). Ran `git init -b dev`, baseline commit `ab6c8a6`, branch `oclite-harness`. Upstream SHA `b471c2b44` can't be checked against this copy.
- Orchestrator is Claude Code; the Part B roster runs as Claude Code sub-agents briefed with the role text, not saved as `.opencode/agent/*.md` files.

- Phase 0 finding: `packages/cli` framework is not importable (no exports; Daemon pulls server/sdk). CLI will use yargs 18 (already in lockfile via packages/opencode) or `effect/unstable/cli`; architect decides.
- Phase 0 finding: `Tool.define`, truncate and built-in tools are not cleanly importable (InstanceState/bus/LSP; 1.3k–3.1k module graphs) → copy or use core v2 tools; architect decides.
- Phase 1 [LEAD] 1: default-profile budget. The spec is self-contradictory (≤2500 tok, but opencode's own prompt and .txt descriptions ≈ 6,900 tok). Default keeps opencode fidelity with budget ≤ 7,300 (the opencode baseline); the savings target lives in local/local-min (1200/600). See Deviations.
- Phase 1 [LEAD] 2: share `~/.local/share/opencode/mcp-auth.json` via path-imported McpAuth, loaded lazily on the OAuth path only (reuse policy prefers import; `opencode mcp auth` tokens work unchanged). Side effect: opencode data dirs get created on that path.
- Phase 1 [LEAD] 3: headless denial continues the run, and exits 3 at the end if any denial happened (SPEC §1 exit codes). This differs from Claude Code, which exits 0.
- Phase 1 [LEAD] 4: `apply_patch` is omitted from all profiles for v1.
- CLI framework: `effect/unstable/cli` (no new manifest dep; ~30 ms). MCP client: own thin client on the SDK (MCP.Service import costs 0.43–0.52 s).

- Phase 2 M1: `.claude/agents` `tools:` lists only restrict (listed = not denied, falls through to ask; others denied), matching Claude Code semantics. This differs from ARCHITECTURE §8's "allow rules" wording.

## Assumptions (UNATTENDED=true)
- Original prompt text is garbled in places. Reconstructed in `docs/SPEC.md`; every guess is marked **[R]** there. Key guessed values: default-profile budget 2500 tok, `permission_timeout_ms` 300000, reasoning-model min `max_tokens` 8192, tool-output stubbing 6/6/3 turns, size budget excludes forked files, `.oclite/agents/*.md` path, hooks "other exit = warn and continue".
- Package `oclite`, no npm publish, default model `anthropic/claude-sonnet-5`, HTTP port 4096, commit locally, never push, no PRs.
- Extraction into `packages/core` needs human approval → blocked this run; use import/path-import/copy and record why.
- New external dependencies need approval → blocked; use only deps already in the workspace lockfile.

## Deviations
- Default-profile fixed-overhead budget is ≤ 7,300 tok instead of ≤ 2,500 (see Decisions).
- `@modelcontextprotocol/server-everything` isn't installed and new deps are blocked. Phase 4 e2e uses `test/fixture/mcp-everything.ts`, a real SDK stdio server.
- No local model server at `http://127.0.0.1:8000/v1` (curl returned connection refused, 2026-09-28). Live PERF numbers and live smoke tests fall back to `test/lib/local-server.ts` plus chars/4 estimates until a real server is available.
- Bun on this machine is 1.3.10; repo pins `bun@1.3.14`.
