# oclite — progress

## Tasks
| Phase | Task | Owner | Gate |
|---|---|---|---|
| 0 | Recon A (model/tools/agent) → docs/recon/A-model-tools-agent.md | cartographer | PASS (spot-checked: default.txt = 8528 chars) |
| 0 | Recon B (MCP/permission/session) → docs/recon/B-mcp-permission-session.md | cartographer | PASS |
| 0 | Path-import smoke test (lead) | lead | PASS: `bun run` + `bun typecheck` exit 0 importing `opencode/mcp/index` and `opencode/agent/subagent-permissions`, with tsconfig `paths {"@/*": ["../opencode/src/*"]}`, DOM lib, and `src/opencode-ambient.d.ts` referencing opencode's audio/sql/markdown d.ts. Typecheck ~5s. Without these: 30–561 errors. || 1 | ADR.md (103 lines) + ARCHITECTURE.md (861 lines) | architect | APPROVED by lead after full read. 42 files / ~6,640 lines planned vs 45 / 7,000. |
| 2 | Skeleton: contract, CLI tree, config layering, agents, redact, size-budget, agents/mcp commands | cli-engineer | PASS after 1 fix round (reviewer B1 secret leak in decode errors, B2 URL/arg redaction). Lead gate: `bun typecheck` exit 0; `bun test` 45 pass / 0 fail; size budget 10/45 files, 1297/7000 lines; verified a bad `mcp` entry with a Bearer token exits 2 and prints no secret. |
| 3 | Runtime + local profile: loop, context, compaction, JSONL store, LLM gateway + probe + think splitter + queue, profiles, tools, permission, hooks, rendering, -p, REPL, debug prompt/server | runtime-, tools-permissions-, perf-, cli-engineer; test-engineer (local-server, MCP fixture) | PASS after 2 fix rounds. Round 1 fixed 12 findings, incl. HIGH chained-bash deny bypass, read_only override by --allowed-tools, path traversal, secret redaction in sinks, probe timeouts, opt-in reasoning_effort. Round 2 fixed the slow-probe exit-2 blocker, bash wrappers, and `always` widening. Lead gate: typecheck exit 0; `bun test` 253 pass / 0 fail (×2); size budget 36/45 files, 4890/7000 lines (+168 forked). Fixed overhead vs fake (server-reported): **correction (Phase 4)**: the lead's first measurement (local 627 / local-min 362 / default 5449) was taken with the probe misdetecting text-protocol mode, so no tool schemas were sent. With native tools pinned: local 1123 (≤1200), local-min 473 (≤600), default 6383 (≤7300). Status line 144–174 ms; render latency ≤5 ms. Lead smoke: `-p "list files" --output-format json` does tool call → text, exit 0; stream-json has reasoning_delta before text_delta. |
| 4 | MCP client: SDK thin client (stdio, StreamableHTTP→SSE, OAuth via shared mcp-auth.json), `mcp__server__tool` naming, deferred `tool_search`, prompts as slash commands, `@server:uri` resources, `mcp auth`, `/mcp` | mcp-engineer | PASS after 1 fix round (B1: server instructions capped per profile; B2: readOnlyHint trust documented in ADR). Lead gate: typecheck exit 0; `bun test` 268 pass / 0 fail; size budget 5532/7000. Budgets with an MCP server: local 1187/1200, local-min 537/600, default 6750/7300. e2e uses the in-repo SDK fixture (Deviation: server-everything unavailable). |
| 5 | Sub-agents: task tool (fg/bg/resume/steer), manager (depth, 4-concurrency, lifecycle, cancel), isolation, opencode envelope, background reminders, built-in roles | runtime-engineer | PASS after 1 fix round (B1: escalation tests, plan/read_only parents force plan-mode children; B2: steer ownership check; B3: child denials count toward headless exit 3). Lead gate: typecheck exit 0; `bun test` 283 pass / 0 fail; size budget 41/45 files, 5874/7000 (+216 forked). Budget: default with task 7259/7300. |
| 6 | `oclite mcp serve` (7 control tools, stdio + HTTP bearer auth on 127.0.0.1, elicitation + `agent_permission_reply` fallback, progress/log notifications, prompts, scoped session resources) and `transport: mcp` children | mcp-engineer | PASS after 1 fix round (B1 parent rules/mode reach mcp children; B2 parent_id depth chaining; B3 forwarded-ask rejects count toward exit 3; plus cwd scoping, reply binding, caps, split-secret batching). Lead gate: typecheck exit 0; `bun test` 299 pass / 1 skip / 0 fail; size 43/45 files, 6422/7000. Lead manual check: HTTP 401 with no or wrong token; exit 2 without OCLITE_MCP_TOKEN; listens on 127.0.0.1 only. |

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

- Phase 3 accepted follow-ups (not blocking):
  - F4: parentheses mark a command `<complex>`, so read_only denies `git log --grep="fix(x)"`. Conservative.
  - F6: a plan-mode parent's `bash *` deny, inherited through deriveSubagentSessionPermission, also blocks git reads in read_only children. This is opencode's own semantics; revisit in Phase 5.
- Phase 3 probe caveat: the probe's tool-call canary depends on the model actually calling the tool. A model that ignores it records `tools_native=false`, so oclite falls back to the text protocol. Pin `servers.<url>.capabilities.tools_native` to override.

- Phase 6 (lead): a client-supplied `permission_mode` on `agent_spawn` may only **tighten** the serve-time mode (plan < default < acceptEdits < bypassPermissions), over stdio as well as HTTP. Only the launcher can loosen it (`oclite mcp serve --permission-mode …`; HTTP bypass also needs `--i-understand-remote-bypass`). This is stricter than SPEC §5, so that a prompt-injected MCP client can't turn off every ask.

## Assumptions (UNATTENDED=true)
- Original prompt text is garbled in places. Reconstructed in `docs/SPEC.md`; every guess is marked **[R]** there. Key guessed values: default-profile budget 2500 tok, `permission_timeout_ms` 300000, reasoning-model min `max_tokens` 8192, tool-output stubbing 6/6/3 turns, size budget excludes forked files, `.oclite/agents/*.md` path, hooks "other exit = warn and continue".
- Package `oclite`, no npm publish, default model `anthropic/claude-sonnet-5`, HTTP port 4096, commit locally, never push, no PRs.
- Extraction into `packages/core` needs human approval → blocked this run; use import/path-import/copy and record why.
- New external dependencies need approval → blocked; use only deps already in the workspace lockfile.

## Deviations
- Denials a `transport: mcp` child makes under its own rules, without asking the parent, don't count toward the parent's headless exit 3. Forwarded-ask rejects do count.
- The Claude Code end-to-end test (`claude -p --mcp-config <tmp> --strict-mcp-config`) is opt-in via `OCLITE_E2E_CLAUDE=1`; it wasn't run unattended because it sends prompts on the user's account. Stdio MCP control is covered by SDK-client and oclite↔oclite tests.
- Split-secret redaction across deltas is done in `mcp serve` notifications (50 ms batch) but not in stream-json, which stays one line per delta for the latency guarantee.
- In local profiles, `task` is opt-in per agent. With it enabled the fixed overhead is 1318 tok, over the 1200 local budget; without it, 1123 (1187 with MCP).
- opencode's background paragraph is left out of the default task description (7337 → 7259 tok) to stay under the 7300 default budget.
- SPEC §1 says an unreachable MCP target → exit 2. oclite continues with a notice instead (ADR: Unreachable MCP server), as the Phase 4 reviewer recommended.
- MCP stdio descendants (e.g. a `docker run` container without `--rm`) aren't killed; only the direct child is. `npx`/`uvx` grandchildren exit on stdin EOF. Documented follow-up.
- Default-profile fixed-overhead budget is ≤ 7,300 tok instead of ≤ 2,500 (see Decisions).
- `@modelcontextprotocol/server-everything` isn't installed and new deps are blocked. Phase 4 e2e uses `test/fixture/mcp-everything.ts`, a real SDK stdio server.
- No local model server at `http://127.0.0.1:8000/v1` (curl returned connection refused, 2026-09-28). Live PERF numbers and live smoke tests fall back to `test/lib/local-server.ts` plus chars/4 estimates until a real server is available.
- Bun on this machine is 1.3.10; repo pins `bun@1.3.14`.
