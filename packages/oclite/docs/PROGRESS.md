# oclite — progress

## Tasks
| Phase | Task | Owner | Gate |
|---|---|---|---|
| 0 | Recon A (model/tools/agent) → docs/recon/A-model-tools-agent.md | cartographer | PASS (spot-checked: default.txt = 8528 chars) |
| 0 | Recon B (MCP/permission/session) → docs/recon/B-mcp-permission-session.md | cartographer | PASS |
| 0 | Path-import smoke test (lead) | lead | PASS: `bun run` + `bun typecheck` exit 0 importing `opencode/mcp/index` and `opencode/agent/subagent-permissions`, with tsconfig `paths {"@/*": ["../opencode/src/*"]}`, DOM lib, and `src/opencode-ambient.d.ts` referencing opencode's audio/sql/markdown d.ts. Typecheck ~5s. Without these: 30–561 errors. |

## Decisions
- Repo: `~/code/opencode-dev` (1.18.33 copy without `.git`). Ran `git init -b dev`, baseline commit `ab6c8a6`, branch `oclite-harness`. Upstream SHA `b471c2b44` can't be checked against this copy.
- Orchestrator is Claude Code; the Part B roster runs as Claude Code sub-agents briefed with the role text, not saved as `.opencode/agent/*.md` files.

- Phase 0 finding: `packages/cli` framework is not importable (no exports; Daemon pulls server/sdk). CLI will use yargs 18 (already in lockfile via packages/opencode) or `effect/unstable/cli`; architect decides.
- Phase 0 finding: `Tool.define`, truncate and built-in tools are not cleanly importable (InstanceState/bus/LSP; 1.3k–3.1k module graphs) → copy or use core v2 tools; architect decides.

## Assumptions (UNATTENDED=true)
- Original prompt text is garbled in places. Reconstructed in `docs/SPEC.md`; every guess is marked **[R]** there. Key guessed values: default-profile budget 2500 tok, `permission_timeout_ms` 300000, reasoning-model min `max_tokens` 8192, tool-output stubbing 6/6/3 turns, size budget excludes forked files, `.oclite/agents/*.md` path, hooks "other exit = warn and continue".
- Package `oclite`, no npm publish, default model `anthropic/claude-sonnet-5`, HTTP port 4096, commit locally, never push, no PRs.
- Extraction into `packages/core` needs human approval → blocked this run; use import/path-import/copy and record why.
- New external dependencies need approval → blocked; use only deps already in the workspace lockfile.

## Deviations
- No local model server at `http://127.0.0.1:8000/v1` (curl returned connection refused, 2026-09-28). Live PERF numbers and live smoke tests fall back to `test/lib/local-server.ts` plus chars/4 estimates until a real server is available.
- Bun on this machine is 1.3.10; repo pins `bun@1.3.14`.
